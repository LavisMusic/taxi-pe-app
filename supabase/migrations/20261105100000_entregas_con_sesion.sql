-- =========================================================================
-- Entregas: avanzar y posición solo con la sesión del propio conductor
-- (revisión de seguridad 2026-11-05, P1-C).
--
-- rpc_entrega_avanzar y rpc_entrega_pos se podían usar sin sesión: con el
-- id de una entrega y el de su conductor, cualquiera la pasaba a "en ruta"
-- o falseaba la posición del repartidor que ve la tienda. Las dos las usa
-- solo la app del conductor (useEntregasRepartidor.js /
-- useEntregaGpsBroadcaster.js), que ya tiene sesión: ahora exigen que
-- quien llama sea ese conductor.
--
-- rpc_entrega_oferta_expirar queda como estaba: solo vence ofertas
-- pendientes de más de 25 s (que vencerían igual) y Caja la usa sin sesión
-- de Taxi-PE.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.rpc_entrega_avanzar(p_entrega_id uuid, p_conductor_id uuid, p_nuevo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
  if p_conductor_id is distinct from public.taxi_mi_conductor_id() then
    return jsonb_build_object('status', 'sin_permiso');
  end if;

  select estado into v_estado from public.entregas
  where id = p_entrega_id and conductor_id = p_conductor_id;
  if v_estado is null then return jsonb_build_object('status', 'no_encontrada'); end if;

  if not (v_estado = 'aceptado' and p_nuevo = 'en_ruta') then
    return jsonb_build_object('status', 'transicion_invalida', 'de', v_estado, 'a', p_nuevo);
  end if;

  update public.entregas
    set estado = 'en_ruta', retirado_at = now(), actualizado_at = now()
    where id = p_entrega_id;

  perform public.fn_entrega_avisar_caja(p_entrega_id, 'en_ruta');
  return jsonb_build_object('status', 'ok');
end;
$$;
revoke execute on function public.rpc_entrega_avanzar(uuid, uuid, text) from public, anon;
grant execute on function public.rpc_entrega_avanzar(uuid, uuid, text) to authenticated;

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
    and p_conductor_id = public.taxi_mi_conductor_id()
    and estado in ('aceptado', 'en_ruta');
$$;
revoke execute on function public.rpc_entrega_pos(uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.rpc_entrega_pos(uuid, uuid, numeric, numeric) to authenticated;

notify pgrst, 'reload schema';
