-- =========================================================================
-- Delivery — marcador del repartidor en el mapa. Proyecto: Taxi-PE.
-- Ver DELIVERY.md §7.
--
-- rpc_conductor_marcador(): devuelve el ícono de categoría (si el Admin
-- le asignó uno) y el nivel de servicio de un conductor, para pintar su
-- pin en el mapa de la entrega igual que en el Radar — pero SIN el badge
-- de asientos disponibles (esto es recolección de productos, no pasajeros).
--
-- Idempotente.
-- =========================================================================

drop function if exists public.rpc_conductor_marcador(uuid);
create or replace function public.rpc_conductor_marcador(p_conductor_id uuid)
returns table (icono_url text, nivel_servicio text, estado text)
language sql
stable
security definer
set search_path = public
as $$
  select cat.icono_url, c.nivel_servicio, c.estado
  from public.conductores c
  left join public.categorias cat on cat.id = c.categoria_id
  where c.id = p_conductor_id;
$$;

grant execute on function public.rpc_conductor_marcador(uuid) to anon, authenticated;
