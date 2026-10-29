-- =========================================================================
-- Puntos rojos del repartidor: cuántos mensajes de la tienda y del cliente
-- no leyó todavía en cada una de sus entregas en curso, por hilo
-- (cajero_conductor / cliente_conductor). Guardado en la base (antes solo
-- se marcaba si el aviso en vivo llegaba con la app abierta). Se marcan
-- leídos al abrir ese chat (rpc_entrega_marcar_leido, sin cambios).
-- Mismo criterio de acceso que rpc_entrega_activa_conductor.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.rpc_entrega_no_leidos_conductor(p_conductor_id uuid)
returns table (entrega_id uuid, hilo text, no_leidos integer)
language sql
stable
security definer
set search_path = public
as $$
  select m.entrega_id, m.hilo, count(*)::integer
  from public.entregas e
  join public.entrega_mensajes m on m.entrega_id = e.id
  where e.conductor_id = p_conductor_id
    and e.estado in ('aceptado', 'en_ruta')
    and m.hilo in ('cliente_conductor', 'cajero_conductor')
    and m.emisor_rol not in ('conductor', 'sistema')
    and not coalesce(m.leido, false)
  group by m.entrega_id, m.hilo;
$$;
grant execute on function public.rpc_entrega_no_leidos_conductor(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
