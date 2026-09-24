-- =========================================================================
-- Recarga Rápida también para CLIENTES (unificación pasajero/cliente):
-- el repartidor ya puede recargar créditos/membresía a un conductor
-- cobrándole directo (Recarga Rápida) — ahora puede hacer lo mismo con
-- un cliente, buscándolo por teléfono. Mismo patrón ya usado para
-- separar catálogos por audiencia (`paquetes` = conductores,
-- `paquetes_recolectores` = recolectores): tabla nueva
-- `paquetes_clientes`, misma forma exacta que las otras dos.
--
-- El saldo del cliente vive en `usuarios.creditos_disponibles` /
-- `usuarios.membresia_vencimiento` / `usuarios.membresia_paquete_id`
-- (mismas columnas que ya usa el propio recolector para su
-- autorecarga) — no hace falta ninguna columna nueva ahí.
--
-- La venta se registra en `ventas` igual que las de conductor
-- (`conductor_id`), con una columna hermana `cliente_id` (nullable, SET
-- NULL si el cliente se borra — nunca se pierde el historial de ventas
-- real, mismo criterio que el resto de esta tabla).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create table if not exists public.paquetes_clientes (
  id             uuid primary key default gen_random_uuid(),
  tipo_item      text not null,
  nombre         text not null,
  precio         numeric not null,
  dias_membresia integer,
  creditos       integer,
  descripcion    text,
  activo         boolean not null default true,
  orden          integer not null default 0,
  created_at     timestamptz not null default now()
);

alter table public.paquetes_clientes enable row level security;

drop policy if exists "paquetes_clientes_all" on public.paquetes_clientes;
create policy "paquetes_clientes_all" on public.paquetes_clientes
  for all using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'paquetes_clientes'
  ) then
    execute 'alter publication supabase_realtime add table public.paquetes_clientes';
  end if;
end $$;

alter table public.ventas
  add column if not exists cliente_id uuid references public.usuarios(id) on delete set null;
