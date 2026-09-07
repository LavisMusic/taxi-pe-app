-- =========================================================================
-- Importa el esquema completo de "caja-registradora-tonazo" al proyecto
-- de Taxi-PE, para unificar ambas apps en un solo backend Supabase.
--
-- CONTEXTO: caja-registradora-tonazo y taxi-pe-app corrían hasta ahora en
-- dos proyectos Supabase DISTINTOS. Se decidió unificar todo acá (el
-- proyecto de Taxi-PE) para poder construir chat/mapa/pedidos
-- compartidos entre ambas apps. Este script solo crea ESTRUCTURA (tablas
-- vacías, RLS, funciones, buckets) — la copia de los DATOS reales
-- (productos, sucursales, clientes fiado, historial) es un paso aparte,
-- ver MIGRACION_CAJA_A_TAXIPE.md en la raíz de este repo.
--
-- CÓMO APLICAR:
--   Supabase Dashboard (proyecto Taxi-PE, silfhbdmfdryjdzpwzvh) → SQL
--   Editor → pega TODO este archivo → Run. Es idempotente (create table
--   if not exists / create or replace / drop policy if exists) — correrlo
--   dos veces no rompe nada.
--
-- IMPORTANTE — reconstrucción, no una copia exacta: las migraciones 0041
-- a 0053 de caja-registradora-tonazo (que definieron RUC/boletas,
-- descuentos, Realtime, y TODA la arquitectura multi-sucursal) nunca se
-- comitearon al repo — se aplicaron directo en el SQL Editor del
-- proyecto viejo. Este script se reconstruyó leyendo el código real de
-- `caja-app/src` (nombres de columnas, tipos, y uso de cada tabla) más
-- las migraciones 0001-0040 que sí están en el repo. Antes de dar esto
-- por definitivo, es buena idea comparar contra el esquema real del
-- proyecto viejo — el bloque "registrar_venta" más abajo (la función más
-- crítica, mueve dinero y stock) trae instrucciones para extraer la
-- versión REAL desde el proyecto viejo en vez de confiar en la
-- reconstrucción de acá.
-- =========================================================================

create extension if not exists pgcrypto;

-- =========================================================================
-- 1) profiles — identidad de la TIENDA (admin/cajero/cliente), separada
--    por completo de la tabla `usuarios` propia de Taxi-PE (login por
--    DNI+PIN). Ambas coexisten en la misma base sin conflicto: la tienda
--    sigue usando Supabase Auth (auth.users + profiles), Taxi-PE sigue
--    con su propia tabla. Si este proyecto Taxi-PE ya tuviera una tabla
--    `profiles` de otro uso, avisa antes de correr esto.
--
--    Va ANTES que is_admin()/is_staff() (sección 2): una función
--    `language sql` valida en su CREATE que las tablas que referencia ya
--    existan, así que 'profiles' tiene que existir primero.
-- =========================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'cliente' check (role in ('admin', 'cliente', 'cajero')),
  nombre text,
  pin_configurado boolean not null default true,
  sucursal_id uuid,
  caja_id uuid,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- =========================================================================
-- 2) Funciones helper de rol (RLS) — is_admin() / is_staff()
--    Idénticas a las de caja-registradora-tonazo (migraciones 0001/0017).
-- =========================================================================

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'cajero')
  );
$$;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_admin_select_all" on public.profiles;
create policy "profiles_admin_select_all" on public.profiles
  for select using (public.is_admin());

-- Igual que en el proyecto viejo: sin política de insert/update/delete
-- para anon/authenticated — solo las Edge Functions (service_role) o el
-- SQL Editor escriben acá.

-- Borrar un profile arrastra su cuenta de auth.users (evita "usuarios
-- fantasma" — migración 0039 del proyecto viejo).
create or replace function public.handle_deleted_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.users where id = old.id;
  return old;
end;
$$;

drop trigger if exists on_profile_deleted on public.profiles;
create trigger on_profile_deleted
  after delete on public.profiles
  for each row
  execute function public.handle_deleted_profile();

-- =========================================================================
-- 3) Jerarquía de sucursales: localidades -> sucursales -> cajas.
-- =========================================================================

create table if not exists public.localidades (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default true
);

create table if not exists public.sucursales (
  id uuid primary key default gen_random_uuid(),
  localidad_id uuid references public.localidades(id),
  nombre text not null,
  activo boolean not null default true
);

create table if not exists public.cajas (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid references public.sucursales(id),
  nombre text not null,
  estado text not null default 'cerrada' check (estado in ('abierta', 'cerrada')),
  monto_inicial numeric,
  abierta_por text,
  abierta_en bigint,
  cerrada_en bigint
);

-- Ahora que existen, las FKs de profiles.sucursal_id/caja_id declaradas
-- arriba pueden apuntar de verdad (se agregan acá, no en la creación de
-- profiles, por el orden de dependencias).
alter table public.profiles
  drop constraint if exists profiles_sucursal_id_fkey,
  add constraint profiles_sucursal_id_fkey foreign key (sucursal_id) references public.sucursales(id);
alter table public.profiles
  drop constraint if exists profiles_caja_id_fkey,
  add constraint profiles_caja_id_fkey foreign key (caja_id) references public.cajas(id);

alter table public.localidades enable row level security;
alter table public.sucursales enable row level security;
alter table public.cajas enable row level security;

drop policy if exists "localidades_public_read" on public.localidades;
create policy "localidades_public_read" on public.localidades for select using (true);
drop policy if exists "localidades_admin_write" on public.localidades;
create policy "localidades_admin_write" on public.localidades
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "sucursales_public_read" on public.sucursales;
create policy "sucursales_public_read" on public.sucursales for select using (true);
drop policy if exists "sucursales_admin_write" on public.sucursales;
create policy "sucursales_admin_write" on public.sucursales
  for all using (public.is_admin()) with check (public.is_admin());

-- cajas: lectura de staff (cajero necesita ver/abrir/cerrar la suya,
-- admin las ve todas); is_staff() también en UPDATE porque el cajero
-- abre/cierra su propia caja (App.jsx: abrirCaja/ejecutarCierre).
drop policy if exists "cajas_staff_select" on public.cajas;
create policy "cajas_staff_select" on public.cajas
  for select using (public.is_staff());
drop policy if exists "cajas_admin_insert" on public.cajas;
create policy "cajas_admin_insert" on public.cajas
  for insert with check (public.is_admin());
drop policy if exists "cajas_staff_update" on public.cajas;
create policy "cajas_staff_update" on public.cajas
  for update using (public.is_staff()) with check (public.is_staff());

-- =========================================================================
-- 4) Catálogo: categorias, productos, stock, inventario_sucursales.
-- =========================================================================

create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  orden integer not null default 0,
  activo boolean not null default true
);

create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  nombre_base text,
  variante text,
  presentacion text,
  color_variante text,
  descripcion text,
  etiqueta text,
  categoria text,
  subgrupo text,
  orden integer not null default 0,
  precio numeric not null default 0,
  costo numeric,
  consumos jsonb not null default '[]'::jsonb,
  activo boolean not null default true,
  visible_publico boolean not null default true,
  valor_descuento numeric not null default 0,
  tipo_descuento text not null default 'fijo' check (tipo_descuento in ('porcentaje', 'fijo')),
  es_combo boolean not null default false,
  combo_items jsonb,
  imagen_url text,
  venta_por_peso boolean not null default false,
  codigo_barras text
);

create table if not exists public.stock (
  nombre text primary key,
  cantidad numeric not null default 0,
  etiqueta text,
  precio_costo numeric,
  ultimo_costo_compra numeric
);

create table if not exists public.inventario_sucursales (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid references public.productos(id) on delete cascade,
  sucursal_id uuid references public.sucursales(id) on delete cascade,
  stock numeric not null default 0,
  precio_costo numeric,
  ultimo_costo_compra numeric,
  unique (producto_id, sucursal_id)
);

alter table public.categorias enable row level security;
alter table public.productos enable row level security;
alter table public.stock enable row level security;
alter table public.inventario_sucursales enable row level security;

drop policy if exists "categorias_public_read" on public.categorias;
create policy "categorias_public_read" on public.categorias for select using (true);
drop policy if exists "categorias_staff_insert" on public.categorias;
create policy "categorias_staff_insert" on public.categorias for insert with check (public.is_staff());
drop policy if exists "categorias_admin_update" on public.categorias;
create policy "categorias_admin_update" on public.categorias for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "categorias_admin_delete" on public.categorias;
create policy "categorias_admin_delete" on public.categorias for delete using (public.is_admin());

drop policy if exists "productos_public_read" on public.productos;
create policy "productos_public_read" on public.productos for select using (true);
drop policy if exists "productos_staff_insert" on public.productos;
create policy "productos_staff_insert" on public.productos for insert with check (public.is_staff());
drop policy if exists "productos_admin_update" on public.productos;
create policy "productos_admin_update" on public.productos for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "stock_public_read" on public.stock;
create policy "stock_public_read" on public.stock for select using (true);
drop policy if exists "stock_staff_insert" on public.stock;
create policy "stock_staff_insert" on public.stock for insert with check (public.is_staff());
drop policy if exists "stock_staff_update" on public.stock;
create policy "stock_staff_update" on public.stock for update using (public.is_staff()) with check (public.is_staff());

drop policy if exists "inventario_sucursales_public_read" on public.inventario_sucursales;
create policy "inventario_sucursales_public_read" on public.inventario_sucursales for select using (true);
drop policy if exists "inventario_sucursales_staff_write" on public.inventario_sucursales;
create policy "inventario_sucursales_staff_write" on public.inventario_sucursales
  for all using (public.is_staff()) with check (public.is_staff());

-- Storage: fotos de producto (pública).
insert into storage.buckets (id, name, public)
values ('productos-imagenes', 'productos-imagenes', true)
on conflict (id) do nothing;

drop policy if exists "productos_imagenes_admin_insert" on storage.objects;
create policy "productos_imagenes_admin_insert" on storage.objects
  for insert with check (bucket_id = 'productos-imagenes' and public.is_admin());
drop policy if exists "productos_imagenes_admin_update" on storage.objects;
create policy "productos_imagenes_admin_update" on storage.objects
  for update using (bucket_id = 'productos-imagenes' and public.is_admin())
  with check (bucket_id = 'productos-imagenes' and public.is_admin());
drop policy if exists "productos_imagenes_admin_delete" on storage.objects;
create policy "productos_imagenes_admin_delete" on storage.objects
  for delete using (bucket_id = 'productos-imagenes' and public.is_admin());
drop policy if exists "productos_imagenes_public_select" on storage.objects;
create policy "productos_imagenes_public_select" on storage.objects
  for select using (bucket_id = 'productos-imagenes');

-- =========================================================================
-- 5) Ventas, fiado, gastos, cierres de caja.
-- =========================================================================

create table if not exists public.historial (
  id uuid primary key default gen_random_uuid(),
  purchase_id text not null,
  producto_id uuid references public.productos(id),
  producto text not null,
  detalle text,
  cantidad numeric not null,
  precio numeric not null,
  total numeric not null,
  costo_unitario numeric,
  costo_total numeric,
  metodo_pago text not null check (metodo_pago in ('YAPE', 'PLIN', 'OTROS', 'FIADO', 'EFECTIVO')),
  vendedor text,
  fecha bigint not null,
  monto_recibido numeric,
  vuelto numeric,
  ruc text,
  venta_por_peso boolean not null default false,
  caja_id uuid references public.cajas(id),
  sucursal_id uuid references public.sucursales(id)
);

create table if not exists public.clientes_fiado (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  whatsapp text,
  ruc text,
  fecha bigint not null,
  auth_user_id uuid references auth.users(id) on delete set null,
  sucursal_id uuid references public.sucursales(id),
  caja_id uuid references public.cajas(id)
);

create index if not exists clientes_fiado_auth_user_id_idx on public.clientes_fiado (auth_user_id);

create table if not exists public.fiado_items (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes_fiado(id) on delete cascade,
  purchase_id text,
  producto_nombre text not null,
  detalle text,
  cantidad numeric not null,
  precio_unitario numeric not null,
  monto numeric not null,
  saldo_restante numeric not null,
  fecha bigint not null,
  venta_por_peso boolean not null default false,
  caja_id uuid references public.cajas(id),
  sucursal_id uuid references public.sucursales(id)
);

create table if not exists public.movimientos_fiado (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes_fiado(id) on delete cascade,
  tipo text not null,
  monto numeric not null,
  descripcion text,
  foto_url text,
  metodo_pago text check (metodo_pago is null or metodo_pago in ('EFECTIVO', 'DIGITAL')),
  fecha bigint not null,
  caja_id uuid references public.cajas(id),
  sucursal_id uuid references public.sucursales(id)
);

create table if not exists public.pagos_pendientes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes_fiado(id) on delete cascade,
  monto numeric(10,2) not null check (monto > 0),
  tipo text not null check (tipo in ('restar', 'cancelar')),
  url_comprobante text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  sucursal_id uuid references public.sucursales(id),
  caja_id uuid references public.cajas(id)
);

create index if not exists pagos_pendientes_cliente_id_idx on public.pagos_pendientes (cliente_id);
create index if not exists pagos_pendientes_estado_idx on public.pagos_pendientes (estado);

create table if not exists public.comprobantes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid,
  product_name text,
  metodo text,
  monto numeric,
  comprobante_id text,
  foto_url text,
  purchase_id text,
  caja_id uuid references public.cajas(id),
  sucursal_id uuid references public.sucursales(id),
  fecha bigint not null
);

create table if not exists public.proveedores (
  id uuid primary key default gen_random_uuid(),
  ruc text,
  razon_social text
);

create table if not exists public.gastos (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid references public.proveedores(id),
  tipo_comprobante text,
  numero_comprobante text,
  origen text,
  metodo_pago text check (metodo_pago is null or metodo_pago in ('EFECTIVO', 'DIGITAL', 'MIXTO')),
  monto_efectivo numeric,
  monto_digital numeric,
  total numeric not null,
  fecha bigint not null
);

create table if not exists public.gasto_items (
  id uuid primary key default gen_random_uuid(),
  gasto_id uuid references public.gastos(id) on delete cascade,
  descripcion text not null,
  cantidad numeric not null,
  precio_unitario numeric,
  subtotal numeric not null
);

create table if not exists public.cierres_caja (
  id uuid primary key default gen_random_uuid(),
  turno_inicio bigint,
  recaudado_total numeric,
  productos_vendidos numeric,
  ventas_registradas numeric,
  gastos_total numeric,
  ganancia_neta numeric,
  ganancia_ventas numeric,
  ganancia_fiados numeric,
  ticket_general numeric,
  efectivo_real numeric,
  diferencia numeric,
  ingreso_efectivo numeric,
  ingreso_digital numeric,
  cajero_nombre text,
  fondo_inicial numeric,
  abierta_en bigint,
  caja_id uuid references public.cajas(id),
  sucursal_id uuid references public.sucursales(id),
  fecha bigint not null
);

create table if not exists public.estado_caja (
  id integer primary key default 1,
  estado text not null default 'cerrada' check (estado in ('abierta', 'cerrada')),
  fondo_inicial numeric,
  abierta_por text,
  abierta_en bigint,
  cerrada_en bigint,
  constraint estado_caja_singleton check (id = 1)
);
insert into public.estado_caja (id, estado) values (1, 'cerrada') on conflict (id) do nothing;

-- ---- RLS ----

alter table public.historial enable row level security;
alter table public.clientes_fiado enable row level security;
alter table public.fiado_items enable row level security;
alter table public.movimientos_fiado enable row level security;
alter table public.pagos_pendientes enable row level security;
alter table public.comprobantes enable row level security;
alter table public.proveedores enable row level security;
alter table public.gastos enable row level security;
alter table public.gasto_items enable row level security;
alter table public.cierres_caja enable row level security;
alter table public.estado_caja enable row level security;

drop policy if exists "historial_staff_all" on public.historial;
create policy "historial_staff_all" on public.historial
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "clientes_fiado_select" on public.clientes_fiado;
create policy "clientes_fiado_select" on public.clientes_fiado
  for select using (public.is_staff() or auth_user_id = auth.uid());
drop policy if exists "clientes_fiado_staff_write" on public.clientes_fiado;
create policy "clientes_fiado_staff_write" on public.clientes_fiado
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "fiado_items_select" on public.fiado_items;
create policy "fiado_items_select" on public.fiado_items
  for select using (
    public.is_staff() or exists (
      select 1 from public.clientes_fiado c
      where c.id = fiado_items.cliente_id and c.auth_user_id = auth.uid()
    )
  );
drop policy if exists "fiado_items_staff_write" on public.fiado_items;
create policy "fiado_items_staff_write" on public.fiado_items
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "movimientos_fiado_select" on public.movimientos_fiado;
create policy "movimientos_fiado_select" on public.movimientos_fiado
  for select using (
    public.is_staff() or exists (
      select 1 from public.clientes_fiado c
      where c.id = movimientos_fiado.cliente_id and c.auth_user_id = auth.uid()
    )
  );
drop policy if exists "movimientos_fiado_staff_write" on public.movimientos_fiado;
create policy "movimientos_fiado_staff_write" on public.movimientos_fiado
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "pagos_pendientes_cliente_insert" on public.pagos_pendientes;
create policy "pagos_pendientes_cliente_insert" on public.pagos_pendientes
  for insert
  with check (
    estado = 'pendiente' and resolved_at is null and resolved_by is null
    and exists (
      select 1 from public.clientes_fiado c
      where c.id = pagos_pendientes.cliente_id and c.auth_user_id = auth.uid()
    )
  );
drop policy if exists "pagos_pendientes_cliente_select_own" on public.pagos_pendientes;
create policy "pagos_pendientes_cliente_select_own" on public.pagos_pendientes
  for select using (
    exists (
      select 1 from public.clientes_fiado c
      where c.id = pagos_pendientes.cliente_id and c.auth_user_id = auth.uid()
    )
  );
drop policy if exists "pagos_pendientes_admin_select" on public.pagos_pendientes;
create policy "pagos_pendientes_admin_select" on public.pagos_pendientes
  for select using (public.is_admin());
drop policy if exists "pagos_pendientes_admin_update" on public.pagos_pendientes;
create policy "pagos_pendientes_admin_update" on public.pagos_pendientes
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "comprobantes_tabla_staff_all" on public.comprobantes;
create policy "comprobantes_tabla_staff_all" on public.comprobantes
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "proveedores_staff_all" on public.proveedores;
create policy "proveedores_staff_all" on public.proveedores
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "gastos_staff_all" on public.gastos;
create policy "gastos_staff_all" on public.gastos
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "gasto_items_staff_all" on public.gasto_items;
create policy "gasto_items_staff_all" on public.gasto_items
  for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists "cierres_caja_staff_all" on public.cierres_caja;
create policy "cierres_caja_staff_all" on public.cierres_caja
  for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists "estado_caja_select" on public.estado_caja;
create policy "estado_caja_select" on public.estado_caja for select using (public.is_staff());
drop policy if exists "estado_caja_insert" on public.estado_caja;
create policy "estado_caja_insert" on public.estado_caja for insert with check (public.is_staff());
drop policy if exists "estado_caja_update" on public.estado_caja;
create policy "estado_caja_update" on public.estado_caja for update using (public.is_staff()) with check (public.is_staff());

-- ---- Storage buckets de esta sección ----

insert into storage.buckets (id, name, public) values ('comprobantes', 'comprobantes', false) on conflict (id) do nothing;
drop policy if exists "comprobantes_cliente_insert" on storage.objects;
create policy "comprobantes_cliente_insert" on storage.objects
  for insert with check (bucket_id = 'comprobantes' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "comprobantes_admin_select" on storage.objects;
create policy "comprobantes_admin_select" on storage.objects
  for select using (bucket_id = 'comprobantes' and public.is_admin());

insert into storage.buckets (id, name, public) values ('comprobantes-fotos', 'comprobantes-fotos', true) on conflict (id) do nothing;
drop policy if exists "comprobantes_fotos_staff_insert" on storage.objects;
create policy "comprobantes_fotos_staff_insert" on storage.objects
  for insert with check (bucket_id = 'comprobantes-fotos' and public.is_staff());
drop policy if exists "comprobantes_fotos_public_select" on storage.objects;
create policy "comprobantes_fotos_public_select" on storage.objects
  for select using (bucket_id = 'comprobantes-fotos');

insert into storage.buckets (id, name, public) values ('boletas-imagenes', 'boletas-imagenes', true) on conflict (id) do nothing;
drop policy if exists "boletas_imagenes_staff_insert" on storage.objects;
create policy "boletas_imagenes_staff_insert" on storage.objects
  for insert with check (bucket_id = 'boletas-imagenes' and public.is_staff());
drop policy if exists "boletas_imagenes_public_select" on storage.objects;
create policy "boletas_imagenes_public_select" on storage.objects
  for select using (bucket_id = 'boletas-imagenes');

-- =========================================================================
-- 6) registrar_venta(...) — INSERT a 'historial' (una fila por línea) +
--    descuento de stock en 'inventario_sucursales', resolviendo combos
--    contra sus ingredientes, todo en una sola transacción.
--
--    ¡OJO! Esta es la función más crítica de todas (mueve dinero y
--    stock real) y NO está en ningún archivo del repo — se reconstruyó
--    leyendo cómo la LLAMA App.jsx (mismos p_* de acá) y la descripción
--    en comentarios del código ("resuelve combos contra consumos ACTUAL
--    de cada ingrediente"). ANTES de confiar en esta versión, intenta
--    conseguir la función REAL corriendo esto en el SQL Editor del
--    proyecto VIEJO (xaerfywydzwifohjsvwa) y comparando:
--
--      select pg_get_functiondef(oid)
--      from pg_proc
--      where proname = 'registrar_venta';
--
--    Si la real es distinta, reemplaza este bloque completo por esa
--    definición antes de usar la app en producción.
-- =========================================================================

create or replace function public.registrar_venta(
  p_purchase_id text,
  p_items jsonb,
  p_metodo_pago text,
  p_vendedor text,
  p_fecha bigint,
  p_monto_recibido numeric,
  p_vuelto numeric,
  p_ruc text,
  p_caja_id uuid,
  p_sucursal_id uuid
)
returns setof public.historial
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  producto_row public.productos%rowtype;
  consumo jsonb;
  combo_item jsonb;
  ingrediente_row public.productos%rowtype;
  ingrediente_consumo jsonb;
  cantidad_a_descontar numeric;
begin
  for item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.historial (
      purchase_id, producto_id, producto, detalle, cantidad, precio, total,
      costo_unitario, costo_total, metodo_pago, vendedor, fecha,
      monto_recibido, vuelto, ruc, venta_por_peso, caja_id, sucursal_id
    ) values (
      p_purchase_id,
      nullif(item->>'producto_id', '')::uuid,
      item->>'nombre',
      item->>'detalle',
      (item->>'cantidad')::numeric,
      (item->>'precio')::numeric,
      (item->>'total')::numeric,
      nullif(item->>'costo_unitario', '')::numeric,
      nullif(item->>'costo_total', '')::numeric,
      p_metodo_pago,
      p_vendedor,
      p_fecha,
      p_monto_recibido,
      p_vuelto,
      p_ruc,
      coalesce((item->>'venta_por_peso')::boolean, false),
      p_caja_id,
      p_sucursal_id
    );

    select * into producto_row from public.productos where id = nullif(item->>'producto_id', '')::uuid;
    if found and p_sucursal_id is not null then
      if producto_row.es_combo and producto_row.combo_items is not null then
        for combo_item in select * from jsonb_array_elements(producto_row.combo_items)
        loop
          select * into ingrediente_row from public.productos where id = (combo_item->>'productoId')::uuid;
          if found and ingrediente_row.consumos is not null then
            for ingrediente_consumo in select * from jsonb_array_elements(ingrediente_row.consumos)
            loop
              cantidad_a_descontar := (item->>'cantidad')::numeric
                * (combo_item->>'cantidad')::numeric
                * (ingrediente_consumo->>'qty')::numeric;
              update public.inventario_sucursales
                set stock = stock - cantidad_a_descontar
                where producto_id = ingrediente_row.id and sucursal_id = p_sucursal_id;
            end loop;
          end if;
        end loop;
      elsif producto_row.consumos is not null then
        for consumo in select * from jsonb_array_elements(producto_row.consumos)
        loop
          cantidad_a_descontar := (item->>'cantidad')::numeric * (consumo->>'qty')::numeric;
          update public.inventario_sucursales
            set stock = stock - cantidad_a_descontar
            where producto_id = producto_row.id and sucursal_id = p_sucursal_id;
        end loop;
      end if;
    end if;
  end loop;

  return query
    select * from public.historial h where h.purchase_id = p_purchase_id;
end;
$$;

grant execute on function public.registrar_venta(text, jsonb, text, text, bigint, numeric, numeric, text, uuid, uuid) to authenticated;

-- =========================================================================
-- 7) Fase 1 (nueva funcionalidad): pedidos delivery — carrito de cliente,
--    Gestor de Pedidos de admin/cajero, chat de texto básico.
-- =========================================================================

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references auth.users(id),
  sucursal_id uuid references public.sucursales(id) not null,
  estado text not null default 'nuevo' check (estado in ('nuevo', 'en_atencion', 'confirmado', 'cancelado')),
  metodo_pago text not null check (metodo_pago in ('YAPE', 'PLIN', 'OTROS', 'EFECTIVO', 'FIADO')),
  monto_recibido numeric,
  vuelto numeric,
  total numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pedido_items (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos(id) on delete cascade,
  producto_id uuid references public.productos(id),
  nombre text not null,
  cantidad numeric not null,
  precio_unitario numeric not null,
  subtotal numeric not null,
  venta_por_peso boolean not null default false
);

create table if not exists public.pedido_mensajes (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid references public.pedidos(id) on delete cascade,
  remitente text not null check (remitente in ('cliente', 'cajero', 'sistema')),
  mensaje text not null,
  leido boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.pedidos enable row level security;
alter table public.pedido_items enable row level security;
alter table public.pedido_mensajes enable row level security;

-- Cliente: solo sus propios pedidos. Cajero: solo los de su sucursal
-- asignada (profiles.sucursal_id). Admin: todos.
drop policy if exists "pedidos_select" on public.pedidos;
create policy "pedidos_select" on public.pedidos
  for select using (
    cliente_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'cajero' and p.sucursal_id = pedidos.sucursal_id
    )
  );

drop policy if exists "pedidos_cliente_insert" on public.pedidos;
create policy "pedidos_cliente_insert" on public.pedidos
  for insert with check (cliente_id = auth.uid());

drop policy if exists "pedidos_update" on public.pedidos;
create policy "pedidos_update" on public.pedidos
  for update using (
    cliente_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'cajero' and p.sucursal_id = pedidos.sucursal_id
    )
  );

drop policy if exists "pedido_items_select" on public.pedido_items;
create policy "pedido_items_select" on public.pedido_items
  for select using (
    exists (
      select 1 from public.pedidos ped
      where ped.id = pedido_items.pedido_id
        and (
          ped.cliente_id = auth.uid()
          or public.is_admin()
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'cajero' and p.sucursal_id = ped.sucursal_id
          )
        )
    )
  );
drop policy if exists "pedido_items_insert" on public.pedido_items;
create policy "pedido_items_insert" on public.pedido_items
  for insert with check (
    exists (
      select 1 from public.pedidos ped
      where ped.id = pedido_items.pedido_id and ped.cliente_id = auth.uid()
    )
  );

drop policy if exists "pedido_mensajes_select" on public.pedido_mensajes;
create policy "pedido_mensajes_select" on public.pedido_mensajes
  for select using (
    exists (
      select 1 from public.pedidos ped
      where ped.id = pedido_mensajes.pedido_id
        and (
          ped.cliente_id = auth.uid()
          or public.is_admin()
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'cajero' and p.sucursal_id = ped.sucursal_id
          )
        )
    )
  );
drop policy if exists "pedido_mensajes_insert" on public.pedido_mensajes;
create policy "pedido_mensajes_insert" on public.pedido_mensajes
  for insert with check (
    exists (
      select 1 from public.pedidos ped
      where ped.id = pedido_mensajes.pedido_id
        and (
          ped.cliente_id = auth.uid()
          or public.is_admin()
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'cajero' and p.sucursal_id = ped.sucursal_id
          )
        )
    )
  );

-- =========================================================================
-- 8) Realtime — agregar las tablas que el frontend necesita escuchar en
--    vivo (useCatalog.js se suscribe a productos/stock/categorias/
--    inventario_sucursales; pagos_pendientes ya lo necesitaba desde 0007).
--    Va AL FINAL: necesita que 'pedidos'/'pedido_items'/'pedido_mensajes'
--    (sección 7) ya existan.
-- =========================================================================

do $$
declare
  t text;
begin
  foreach t in array array['productos', 'stock', 'categorias', 'inventario_sucursales', 'pagos_pendientes', 'pedidos', 'pedido_items', 'pedido_mensajes']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
