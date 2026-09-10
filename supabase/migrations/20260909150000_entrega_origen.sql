-- =========================================================================
-- Delivery — punto de ORIGEN de la entrega (la sucursal). Proyecto: Taxi-PE.
-- Ver DELIVERY.md §7 (punto A).
--
-- Las coords de la sucursal las manda la app de Caja en el handshake
-- (`entrega-iniciar` → `entrega-crear`), sacadas de `sucursales.lat/lng`.
-- Se guardan acá para pintar el marcador 🏪 en el mapa.
--
-- Idempotente.
-- =========================================================================

alter table public.entregas
  add column if not exists origen_lat numeric,
  add column if not exists origen_lng numeric;

-- rpc_entrega_estado: devolver también el origen.
drop function if exists public.rpc_entrega_estado(uuid);
create or replace function public.rpc_entrega_estado(p_session_token uuid)
returns table (
  id uuid, estado text, conductor_id uuid, conductor_nombre text, conductor_placa text,
  cliente_nombre text, direccion_entrega text, caja_sucursal text,
  items jsonb, total numeric, pin text,
  entrega_lat numeric, entrega_lng numeric,
  origen_lat numeric, origen_lng numeric,
  repartidor_lat numeric, repartidor_lng numeric, repartidor_pos_at timestamptz,
  aceptado_at timestamptz, retirado_at timestamptz, entregado_at timestamptz, actualizado_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select e.id, e.estado, e.conductor_id, c.nombre, c.placa,
         e.cliente_nombre, e.direccion_entrega, e.caja_sucursal,
         e.items, e.total, e.pin,
         e.entrega_lat, e.entrega_lng,
         e.origen_lat, e.origen_lng,
         e.repartidor_lat, e.repartidor_lng, e.repartidor_pos_at,
         e.aceptado_at, e.retirado_at, e.entregado_at, e.actualizado_at
  from public.entregas e
  left join public.conductores c on c.id = e.conductor_id
  where e.session_token = p_session_token;
$$;

grant execute on function public.rpc_entrega_estado(uuid) to anon, authenticated;
