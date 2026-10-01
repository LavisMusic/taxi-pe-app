-- =========================================================================
-- Fix: reofertar a un conductor cuya oferta anterior venció (30s,
-- 'expirada') no hacía nada — el INSERT ... ON CONFLICT ... DO UPDATE
-- ... WHERE de rpc_entrega_ofertar solo reseteaba a 'pendiente' si el
-- estado previo era 'rechazada'/'cerrada'; 'expirada' (agregado en
-- 20260914110000) se quedó afuera de esa lista por descuido, así que la
-- fila quedaba trabada — el botón "Ofertar" parecía no hacer nada.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.rpc_entrega_ofertar(
  p_session_token uuid,
  p_conductor_id  uuid,
  p_tarifa        numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid; v_estado text;
  v_tarifa_previa numeric; v_direccion text; v_sucursal text; v_total numeric;
begin
  v_id := public.fn_entrega_por_token(p_session_token);
  if v_id is null then return jsonb_build_object('status', 'token_invalido'); end if;

  select estado, tarifa, direccion_entrega, caja_sucursal, total
    into v_estado, v_tarifa_previa, v_direccion, v_sucursal, v_total
  from public.entregas where id = v_id;
  if v_estado is distinct from 'buscando' then
    return jsonb_build_object('status', 'estado_invalido', 'estado', v_estado);
  end if;

  if p_tarifa is not null and p_tarifa is distinct from v_tarifa_previa then
    update public.entregas set tarifa = p_tarifa, actualizado_at = now() where id = v_id;
    insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
    values (
      v_id, 'cajero_conductor', 'sistema',
      format(
        '📦 Nueva oferta de reparto: %s · Sucursal %s · Monto del pedido S/ %s · Tarifa de envío S/ %s',
        coalesce(v_direccion, 'sin dirección'),
        coalesce(v_sucursal, '-'),
        trim(to_char(coalesce(v_total, 0), '999999990.00')),
        trim(to_char(p_tarifa, '999999990.00'))
      )
    );
  end if;

  insert into public.entrega_ofertas (entrega_id, conductor_id)
  values (v_id, p_conductor_id)
  on conflict (entrega_id, conductor_id) do update
    set estado = 'pendiente', resuelta_at = null
    where public.entrega_ofertas.estado in ('rechazada', 'cerrada', 'expirada');

  return jsonb_build_object('status', 'ok');
end;
$$;

grant execute on function public.rpc_entrega_ofertar(uuid, uuid, numeric) to anon, authenticated;

notify pgrst, 'reload schema';
