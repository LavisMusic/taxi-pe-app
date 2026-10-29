-- =========================================================================
-- Punto rojo en la tarjeta del pedido (Caja Tonazo): cuántos mensajes del
-- repartidor todavía no leyó el cajero o el cliente en cada entrega.
-- Caja pasa los session_token de sus entregas (los mismos con los que ya
-- abre el chat) y su rol; se cuentan los mensajes del conductor sin leer en
-- el hilo de ese rol (cajero_conductor o cliente_conductor). Se marcan
-- leídos al abrir ese chat (rpc_entrega_marcar_leido, sin cambios).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.rpc_entrega_no_leidos_repartidor(p_tokens uuid[], p_rol text)
returns table (session_token uuid, no_leidos integer)
language sql
stable
security definer
set search_path = public
as $$
  select e.session_token, count(m.id)::integer
  from public.entregas e
  join public.entrega_mensajes m on m.entrega_id = e.id
  where e.session_token = any(p_tokens)
    and p_rol in ('cajero', 'cliente')
    and m.emisor_rol = 'conductor'
    and not coalesce(m.leido, false)
    and m.hilo = case when p_rol = 'cajero' then 'cajero_conductor' else 'cliente_conductor' end
  group by e.session_token;
$$;
grant execute on function public.rpc_entrega_no_leidos_repartidor(uuid[], text) to anon, authenticated;

notify pgrst, 'reload schema';
