-- =========================================================================
-- Delivery Caja Tonazo ↔ Taxi-PE — Fase 1: núcleo de sesión.
--   Proyecto: Taxi-PE (silfhbdmfdryjdzpwzvh)
--   Diseño completo: DELIVERY.md en la raíz del repo.
--
-- Trae:
--   0) Baja de las piezas del webhook 3.2 (caja.pedido_delivery), que este
--      diseño reemplaza. Los eventos 3.1 y 3.3 (fiado) NO se tocan.
--   1) Tablas: entregas, entrega_ofertas, entrega_mensajes (RLS ON, sin
--      políticas anon → sólo se tocan por los RPCs security definer de abajo)
--   2) RPCs de dominio para todas las transiciones y el chat
--   3) RPC de ranking semanal de repartidores
--
-- Modelo de acceso (SIN JWT — el proyecto usa llaves asimétricas y no se
-- puede autofirmar un token confiable):
--   - Cajero / cliente (app Caja): la Edge Function `entrega-crear` devuelve
--     un `session_token` (uuid). La app de Caja llama a los RPCs
--     `rpc_entrega_*` pasando ese token; el RPC valida token → entrega.
--   - Repartidor (app Taxi-PE, anon key, identidad a nivel app): llama a los
--     RPCs `rpc_entrega_*_conductor` pasando su `conductor_id`.
--   - Chat y estado en vivo: además de estos RPCs (persistencia + carga de
--     historial), la capa realtime va por Broadcast en el canal
--     `entrega-<id>` (igual que los viajes: useChatMensajes / useGpsBroadcaster).
--
-- Idempotente.
-- =========================================================================

-- =========================================================================
-- 0) BAJA DEL WEBHOOK 3.2
-- =========================================================================

drop function if exists public.rpc_webhook_caja_pedido_delivery(uuid, jsonb);
drop table if exists public.pedidos_delivery_entrantes cascade;  -- sale sola de supabase_realtime

-- =========================================================================
-- 1) TABLAS
-- =========================================================================

create table if not exists public.entregas (
  id                uuid primary key default gen_random_uuid(),
  session_token     uuid not null unique default gen_random_uuid(),

  caja_sucursal     text,
  caja_pedido_ref   text,

  cliente_nombre    text,
  cliente_telefono  text,
  direccion_entrega text,
  entrega_lat       numeric,
  entrega_lng       numeric,

  items             jsonb not null default '[]'::jsonb,
  total             numeric,

  conductor_id      uuid references public.conductores(id),
  pin               text not null,

  estado text not null default 'buscando' check (estado in (
    'buscando', 'aceptado', 'retirado', 'en_ruta', 'entregado',
    'cancelado', 'no_entregado'
  )),

  creado_at         timestamptz not null default now(),
  actualizado_at    timestamptz not null default now(),
  aceptado_at       timestamptz,
  retirado_at       timestamptz,
  entregado_at      timestamptz,
  cerrado_at        timestamptz
);

create index if not exists entregas_estado_idx    on public.entregas (estado);
create index if not exists entregas_conductor_idx on public.entregas (conductor_id);
create index if not exists entregas_entregado_idx on public.entregas (entregado_at) where estado = 'entregado';

create table if not exists public.entrega_ofertas (
  id           uuid primary key default gen_random_uuid(),
  entrega_id   uuid not null references public.entregas(id) on delete cascade,
  conductor_id uuid not null references public.conductores(id),
  estado       text not null default 'pendiente'
               check (estado in ('pendiente', 'aceptada', 'rechazada', 'cerrada')),
  created_at   timestamptz not null default now(),
  resuelta_at  timestamptz,
  unique (entrega_id, conductor_id)
);

create index if not exists entrega_ofertas_conductor_pend_idx
  on public.entrega_ofertas (conductor_id) where estado = 'pendiente';

create table if not exists public.entrega_mensajes (
  id          uuid primary key default gen_random_uuid(),
  entrega_id  uuid not null references public.entregas(id) on delete cascade,
  hilo        text not null check (hilo in ('cliente_cajero', 'cliente_conductor', 'cajero_conductor')),
  emisor_rol  text not null check (emisor_rol in ('cliente', 'cajero', 'conductor', 'sistema')),
  mensaje     text not null,
  leido       boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists entrega_mensajes_entrega_idx on public.entrega_mensajes (entrega_id, created_at);

-- RLS ON en las 3, SIN políticas: nadie las toca directo con la anon key.
-- Todo pasa por los RPCs security definer de la sección 2.
alter table public.entregas         enable row level security;
alter table public.entrega_ofertas  enable row level security;
alter table public.entrega_mensajes enable row level security;

-- Limpieza de una versión previa de esta migración (que usaba JWT + claims):
-- políticas por claim y funciones con otra firma. `drop ... if exists` — no-op
-- si es la primera vez.
drop policy if exists "entregas_token_select"        on public.entregas;
drop policy if exists "entrega_mensajes_token_select" on public.entrega_mensajes;
drop policy if exists "entrega_mensajes_token_insert" on public.entrega_mensajes;

drop function if exists public.fn_entrega_token_ok(uuid);
drop function if exists public.fn_entrega_por_token(uuid);
drop function if exists public.rpc_entrega_estado(uuid);
drop function if exists public.rpc_entrega_ofertar(uuid, uuid);
drop function if exists public.rpc_entrega_cancelar(uuid, text);
drop function if exists public.rpc_entrega_ofertas_conductor(uuid);
drop function if exists public.rpc_entrega_aceptar(uuid, uuid);
drop function if exists public.rpc_entrega_rechazar(uuid, uuid);
drop function if exists public.rpc_entrega_avanzar(uuid, uuid, text);
drop function if exists public.rpc_entrega_finalizar(uuid, uuid, text);
drop function if exists public.rpc_entrega_activa_conductor(uuid);
drop function if exists public.rpc_entrega_no_entregado(uuid, text);
drop function if exists public.rpc_entrega_mensajes(uuid, uuid, uuid, timestamptz);
drop function if exists public.rpc_entrega_mensaje_nuevo(text, text, text, uuid, uuid, uuid);
drop function if exists public.rpc_ranking_repartidores();

-- =========================================================================
-- 2) RPCs DE DOMINIO
-- =========================================================================

-- Resuelve el id de entrega a partir del session_token; NULL si no existe.
create or replace function public.fn_entrega_por_token(p_token uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.entregas where session_token = p_token;
$$;

-- --- Cajero / cliente: leer el estado completo de su entrega ---
create or replace function public.rpc_entrega_estado(p_session_token uuid)
returns table (
  id uuid, estado text, conductor_id uuid, conductor_nombre text, conductor_placa text,
  cliente_nombre text, direccion_entrega text, caja_sucursal text,
  items jsonb, total numeric, pin text,
  aceptado_at timestamptz, retirado_at timestamptz, entregado_at timestamptz, actualizado_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select e.id, e.estado, e.conductor_id, c.nombre, c.placa,
         e.cliente_nombre, e.direccion_entrega, e.caja_sucursal,
         e.items, e.total, e.pin,
         e.aceptado_at, e.retirado_at, e.entregado_at, e.actualizado_at
  from public.entregas e
  left join public.conductores c on c.id = e.conductor_id
  where e.session_token = p_session_token;
$$;

-- --- Cajero: ofrecer la entrega a un conductor (uno o varios) ---
create or replace function public.rpc_entrega_ofertar(p_session_token uuid, p_conductor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_estado text;
begin
  v_id := public.fn_entrega_por_token(p_session_token);
  if v_id is null then return jsonb_build_object('status', 'token_invalido'); end if;

  select estado into v_estado from public.entregas where id = v_id;
  if v_estado is distinct from 'buscando' then
    return jsonb_build_object('status', 'estado_invalido', 'estado', v_estado);
  end if;

  insert into public.entrega_ofertas (entrega_id, conductor_id)
  values (v_id, p_conductor_id)
  on conflict (entrega_id, conductor_id) do update
    set estado = 'pendiente', resuelta_at = null
    where public.entrega_ofertas.estado in ('rechazada', 'cerrada');

  return jsonb_build_object('status', 'ok');
end;
$$;

-- --- Cajero / cliente: cancelar (solo antes de retirar) ---
create or replace function public.rpc_entrega_cancelar(p_session_token uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_estado text;
begin
  v_id := public.fn_entrega_por_token(p_session_token);
  if v_id is null then return jsonb_build_object('status', 'token_invalido'); end if;

  select estado into v_estado from public.entregas where id = v_id for update;
  if v_estado not in ('buscando', 'aceptado') then
    return jsonb_build_object('status', 'ya_no_cancelable', 'estado', v_estado);
  end if;

  update public.entregas
    set estado = 'cancelado', cerrado_at = now(), actualizado_at = now()
    where id = v_id;
  update public.entrega_ofertas set estado = 'cerrada', resuelta_at = now()
    where entrega_id = v_id and estado = 'pendiente';

  insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
  values (v_id, 'cliente_conductor', 'sistema',
          coalesce('Pedido cancelado: ' || p_motivo, 'Pedido cancelado.'));

  return jsonb_build_object('status', 'ok');
end;
$$;

-- --- Repartidor: ver sus ofertas pendientes (con datos de la entrega) ---
create or replace function public.rpc_entrega_ofertas_conductor(p_conductor_id uuid)
returns table (
  oferta_id uuid, entrega_id uuid, cliente_nombre text, direccion_entrega text,
  caja_sucursal text, total numeric, items jsonb, creado_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select o.id, e.id, e.cliente_nombre, e.direccion_entrega,
         e.caja_sucursal, e.total, e.items, e.creado_at
  from public.entrega_ofertas o
  join public.entregas e on e.id = o.entrega_id
  where o.conductor_id = p_conductor_id
    and o.estado = 'pendiente'
    and e.estado = 'buscando'
  order by e.creado_at;
$$;

-- --- Repartidor: aceptar (el primero gana) ---
create or replace function public.rpc_entrega_aceptar(p_oferta_id uuid, p_conductor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_entrega_id uuid; v_taken uuid;
begin
  select entrega_id into v_entrega_id
  from public.entrega_ofertas
  where id = p_oferta_id and conductor_id = p_conductor_id and estado = 'pendiente';
  if v_entrega_id is null then return jsonb_build_object('status', 'oferta_invalida'); end if;

  select conductor_id into v_taken from public.entregas where id = v_entrega_id for update;
  if v_taken is not null then
    update public.entrega_ofertas set estado = 'cerrada', resuelta_at = now() where id = p_oferta_id;
    return jsonb_build_object('status', 'ya_tomada');
  end if;

  update public.entregas
    set conductor_id = p_conductor_id, estado = 'aceptado',
        aceptado_at = now(), actualizado_at = now()
    where id = v_entrega_id;

  update public.entrega_ofertas set estado = 'aceptada', resuelta_at = now() where id = p_oferta_id;
  update public.entrega_ofertas set estado = 'cerrada',  resuelta_at = now()
    where entrega_id = v_entrega_id and id <> p_oferta_id and estado = 'pendiente';

  insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
  values (v_entrega_id, 'cliente_conductor', 'sistema', 'El repartidor aceptó y va en camino a retirar el pedido.');

  return jsonb_build_object('status', 'ok', 'entrega_id', v_entrega_id);
end;
$$;

-- --- Repartidor: rechazar ---
create or replace function public.rpc_entrega_rechazar(p_oferta_id uuid, p_conductor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.entrega_ofertas
    set estado = 'rechazada', resuelta_at = now()
    where id = p_oferta_id and conductor_id = p_conductor_id and estado = 'pendiente';
  return jsonb_build_object('status', case when found then 'ok' else 'oferta_invalida' end);
end;
$$;

-- --- Repartidor: avanzar estado (aceptado→retirado→en_ruta) ---
create or replace function public.rpc_entrega_avanzar(p_entrega_id uuid, p_conductor_id uuid, p_nuevo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_estado text;
begin
  select estado into v_estado from public.entregas
  where id = p_entrega_id and conductor_id = p_conductor_id;
  if v_estado is null then return jsonb_build_object('status', 'no_encontrada'); end if;

  if (v_estado, p_nuevo) not in (('aceptado','retirado'), ('retirado','en_ruta')) then
    return jsonb_build_object('status', 'transicion_invalida', 'de', v_estado, 'a', p_nuevo);
  end if;

  update public.entregas
    set estado = p_nuevo, actualizado_at = now(),
        retirado_at = case when p_nuevo = 'retirado' then now() else retirado_at end
    where id = p_entrega_id;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- --- Repartidor: finalizar con PIN (el QR codifica el mismo PIN) ---
create or replace function public.rpc_entrega_finalizar(p_entrega_id uuid, p_conductor_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_estado text; v_pin text;
begin
  select estado, pin into v_estado, v_pin from public.entregas
  where id = p_entrega_id and conductor_id = p_conductor_id;
  if v_estado is null then return jsonb_build_object('status', 'no_encontrada'); end if;
  if v_estado not in ('retirado', 'en_ruta') then
    return jsonb_build_object('status', 'estado_invalido', 'estado', v_estado);
  end if;
  if p_pin is null or btrim(p_pin) <> v_pin then
    return jsonb_build_object('status', 'pin_incorrecto');
  end if;

  update public.entregas
    set estado = 'entregado', entregado_at = now(), cerrado_at = now(), actualizado_at = now()
    where id = p_entrega_id;

  insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
  values (p_entrega_id, 'cliente_conductor', 'sistema', 'Entrega confirmada. ¡Gracias!');

  return jsonb_build_object('status', 'ok');
end;
$$;

-- --- Repartidor: leer su entrega activa ---
create or replace function public.rpc_entrega_activa_conductor(p_conductor_id uuid)
returns setof public.entregas
language sql
security definer
set search_path = public
as $$
  select * from public.entregas
  where conductor_id = p_conductor_id
    and estado in ('aceptado', 'retirado', 'en_ruta')
  order by aceptado_at desc
  limit 1;
$$;

-- --- Admin (app-gated): cerrar por no-show ---
create or replace function public.rpc_entrega_no_entregado(p_entrega_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_estado text;
begin
  select estado into v_estado from public.entregas where id = p_entrega_id;
  if v_estado not in ('retirado', 'en_ruta') then
    return jsonb_build_object('status', 'estado_invalido', 'estado', v_estado);
  end if;
  update public.entregas
    set estado = 'no_entregado', cerrado_at = now(), actualizado_at = now()
    where id = p_entrega_id;
  return jsonb_build_object('status', 'ok');
end;
$$;

-- --- Chat: cargar historial ---
--   Cajero/cliente pasan session_token; repartidor pasa entrega_id + conductor_id.
create or replace function public.rpc_entrega_mensajes(
  p_session_token uuid default null,
  p_entrega_id    uuid default null,
  p_conductor_id  uuid default null,
  p_desde         timestamptz default '-infinity'
)
returns setof public.entrega_mensajes
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_session_token is not null then
    v_id := public.fn_entrega_por_token(p_session_token);
  elsif p_entrega_id is not null and p_conductor_id is not null then
    select id into v_id from public.entregas
    where id = p_entrega_id and conductor_id = p_conductor_id;
  end if;
  if v_id is null then return; end if;

  return query
    select * from public.entrega_mensajes
    where entrega_id = v_id and created_at > p_desde
    order by created_at;
end;
$$;

-- --- Chat: enviar mensaje ---
create or replace function public.rpc_entrega_mensaje_nuevo(
  p_hilo         text,
  p_emisor_rol   text,
  p_mensaje      text,
  p_session_token uuid default null,
  p_entrega_id    uuid default null,
  p_conductor_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_session_token is not null then
    v_id := public.fn_entrega_por_token(p_session_token);
  elsif p_entrega_id is not null and p_conductor_id is not null then
    select id into v_id from public.entregas
    where id = p_entrega_id and conductor_id = p_conductor_id;
  end if;
  if v_id is null then return jsonb_build_object('status', 'no_autorizado'); end if;

  if p_hilo not in ('cliente_cajero', 'cliente_conductor', 'cajero_conductor')
     or p_emisor_rol not in ('cliente', 'cajero', 'conductor')
     or btrim(coalesce(p_mensaje, '')) = '' then
    return jsonb_build_object('status', 'datos_invalidos');
  end if;

  insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
  values (v_id, p_hilo, p_emisor_rol, btrim(p_mensaje));
  return jsonb_build_object('status', 'ok');
end;
$$;

-- =========================================================================
-- 3) RANKING SEMANAL DE REPARTIDORES (últimos 7 días corridos)
-- =========================================================================

create or replace function public.rpc_ranking_repartidores()
returns table (conductor_id uuid, nombre text, entregas bigint)
language sql
stable
security definer
set search_path = public
as $$
  select e.conductor_id,
         coalesce(c.nombre, 'Conductor eliminado') as nombre,
         count(*)::bigint as entregas
  from public.entregas e
  left join public.conductores c on c.id = e.conductor_id
  where e.estado = 'entregado'
    and e.entregado_at >= now() - interval '7 days'
    and e.conductor_id is not null
  group by e.conductor_id, c.nombre
  order by entregas desc;
$$;

grant execute on function
  public.rpc_entrega_estado(uuid),
  public.rpc_entrega_ofertar(uuid, uuid),
  public.rpc_entrega_cancelar(uuid, text),
  public.rpc_entrega_ofertas_conductor(uuid),
  public.rpc_entrega_aceptar(uuid, uuid),
  public.rpc_entrega_rechazar(uuid, uuid),
  public.rpc_entrega_avanzar(uuid, uuid, text),
  public.rpc_entrega_finalizar(uuid, uuid, text),
  public.rpc_entrega_activa_conductor(uuid),
  public.rpc_entrega_no_entregado(uuid, text),
  public.rpc_entrega_mensajes(uuid, uuid, uuid, timestamptz),
  public.rpc_entrega_mensaje_nuevo(text, text, text, uuid, uuid, uuid),
  public.rpc_ranking_repartidores()
to anon, authenticated;
