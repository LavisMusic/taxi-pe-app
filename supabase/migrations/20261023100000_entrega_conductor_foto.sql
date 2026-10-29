-- =========================================================================
-- Fase 4 (Caja → Mensajes): nombre y foto del repartidor de una entrega,
-- para la fila "Repartidor" del pedido en Mensajes del cliente de Caja.
-- Igual que el resto de rpc_entrega_*: se pide con el session_token de la
-- entrega (lo tiene solo quien hizo el pedido / la caja). No devuelve DNI
-- ni fotos de verificación, solo la foto de perfil.
-- =========================================================================

create or replace function public.rpc_entrega_conductor(p_session_token uuid)
returns table (conductor_id uuid, nombre text, foto_url text, placa text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.nombre, c.foto_url, c.placa
  from public.entregas e
  join public.conductores c on c.id = e.conductor_id
  where e.session_token = p_session_token;
$$;
revoke all on function public.rpc_entrega_conductor(uuid) from public;
grant execute on function public.rpc_entrega_conductor(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
