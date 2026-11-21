-- =========================================================================
-- Ofertas de reparto con el logo del negocio (caja_logo_url): la vista
-- previa del trayecto muestra la sucursal con su logo en un círculo
-- (lib/marcadorTienda.js). Misma función que 20260914110000 + esa columna.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

drop function if exists public.rpc_entrega_ofertas_conductor(uuid);
create function public.rpc_entrega_ofertas_conductor(p_conductor_id uuid)
returns table (
  oferta_id uuid, entrega_id uuid, cliente_nombre text, direccion_entrega text,
  caja_sucursal text, total numeric, tarifa numeric, items jsonb, creado_at timestamptz,
  oferta_creada_at timestamptz,
  entrega_lat numeric, entrega_lng numeric, origen_lat numeric, origen_lng numeric,
  caja_logo_url text
)
language sql
security definer
set search_path = public
as $$
  select o.id, e.id, e.cliente_nombre, e.direccion_entrega,
         e.caja_sucursal, e.total, e.tarifa, e.items, e.creado_at,
         o.created_at,
         e.entrega_lat, e.entrega_lng, e.origen_lat, e.origen_lng,
         e.caja_logo_url
  from public.entrega_ofertas o
  join public.entregas e on e.id = o.entrega_id
  where o.conductor_id = p_conductor_id
    and o.estado = 'pendiente'
    and e.estado = 'buscando'
  order by e.creado_at;
$$;

grant execute on function public.rpc_entrega_ofertas_conductor(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
