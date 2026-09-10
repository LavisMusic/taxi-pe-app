-- =========================================================================
-- Delivery — persistencia de la última posición del repartidor.
-- Proyecto: Taxi-PE. Ver DELIVERY.md §7 (mitigaciones de GPS).
--
-- El GPS en vivo va por Broadcast (canal `entrega-<id>`), pero si al
-- repartidor se le bloquea la pantalla el broadcast se corta. Guardar la
-- última posición (con throttle desde el front) permite que:
--   - el mapa del otro lado siembre un punto al abrir, y
--   - se muestre "ubicación de hace X min" en vez de un pin congelado
--     que parece en vivo.
--
-- Idempotente.
-- =========================================================================

alter table public.entregas
  add column if not exists repartidor_lat    numeric,
  add column if not exists repartidor_lng    numeric,
  add column if not exists repartidor_pos_at timestamptz;

-- Escribe la posición (solo el repartidor asignado, entrega activa).
create or replace function public.rpc_entrega_pos(
  p_entrega_id uuid, p_conductor_id uuid, p_lat numeric, p_lng numeric
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.entregas
    set repartidor_lat = p_lat, repartidor_lng = p_lng, repartidor_pos_at = now()
  where id = p_entrega_id
    and conductor_id = p_conductor_id
    and estado in ('aceptado', 'en_ruta');
$$;

grant execute on function public.rpc_entrega_pos(uuid, uuid, numeric, numeric) to anon, authenticated;

-- rpc_entrega_estado: devolver también la última posición guardada.
drop function if exists public.rpc_entrega_estado(uuid);
create or replace function public.rpc_entrega_estado(p_session_token uuid)
returns table (
  id uuid, estado text, conductor_id uuid, conductor_nombre text, conductor_placa text,
  cliente_nombre text, direccion_entrega text, caja_sucursal text,
  items jsonb, total numeric, pin text,
  entrega_lat numeric, entrega_lng numeric,
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
         e.repartidor_lat, e.repartidor_lng, e.repartidor_pos_at,
         e.aceptado_at, e.retirado_at, e.entregado_at, e.actualizado_at
  from public.entregas e
  left join public.conductores c on c.id = e.conductor_id
  where e.session_token = p_session_token;
$$;

grant execute on function public.rpc_entrega_estado(uuid) to anon, authenticated;
