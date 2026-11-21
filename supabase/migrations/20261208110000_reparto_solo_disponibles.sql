-- =========================================================================
-- Repartidores: solo se ofrece a quien está disponible de verdad.
--
--   * rpc_entrega_ofertar: si el conductor ya no está en
--     rpc_conductores_para_reparto() (apagó el modo delivery, se quedó sin
--     membresía o sin GPS reciente) devuelve 'conductor_no_disponible'.
--     Misma función que 20261127100000, solo agrega esa revisión.
--   * Al apagar el modo delivery, sus ofertas pendientes pasan a
--     'expirada' (el negocio puede ofrecer a otro al toque).
--
-- La app del conductor además avisa por Broadcast (radar_publico,
-- evento 'reparto_disponible') para que la lista de Caja lo saque en vivo.
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
  v_nivel jsonb;
begin
  v_id := public.fn_entrega_por_token(p_session_token);
  if v_id is null then return jsonb_build_object('status', 'token_invalido'); end if;

  select estado, tarifa, direccion_entrega, caja_sucursal, total
    into v_estado, v_tarifa_previa, v_direccion, v_sucursal, v_total
  from public.entregas where id = v_id;
  if v_estado is distinct from 'buscando' then
    return jsonb_build_object('status', 'estado_invalido', 'estado', v_estado);
  end if;

  -- Solo a quien está en la lista de repartidores ahora mismo (modo
  -- delivery encendido, aprobado, con membresía y GPS reciente): si lo
  -- apagó mientras el cajero miraba la lista, no se le puede ofrecer.
  if not exists (select 1 from public.rpc_conductores_para_reparto() r where r.id = p_conductor_id) then
    return jsonb_build_object('status', 'conductor_no_disponible');
  end if;

  if public.taxi_conductor_en_carrera(p_conductor_id) then
    return jsonb_build_object('status', 'conductor_en_carrera');
  end if;
  if public.taxi_conductor_repartos_activos(p_conductor_id) >= public.taxi_max_repartos() then
    return jsonb_build_object('status', 'limite_repartos');
  end if;
  -- Nivel de confianza: el pedido no puede superar su límite, salvo que el
  -- negocio lo haya autorizado para este pedido.
  v_nivel := public.taxi__nivel_repartidor(p_conductor_id);
  if coalesce(v_total, 0) > (v_nivel->>'limite')::numeric
     and not exists (select 1 from public.taxi_entrega_autorizaciones a
                      where a.entrega_id = v_id and a.conductor_id = p_conductor_id) then
    return jsonb_build_object('status', 'limite_nivel', 'nivel', v_nivel->>'nivel', 'limite', (v_nivel->>'limite')::numeric);
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
    set estado = 'pendiente', resuelta_at = null, created_at = now()
    where public.entrega_ofertas.estado in ('rechazada', 'cerrada', 'expirada');

  return jsonb_build_object('status', 'ok');
end;
$$;

-- ---------- Al apagar el modo delivery: sus ofertas pendientes vencen ------
create or replace function public.fn_conductor_delivery_apagado_ofertas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.modo_delivery, false) and not coalesce(new.modo_delivery, false) then
    update public.entrega_ofertas
       set estado = 'expirada', resuelta_at = now()
     where conductor_id = new.id
       and estado = 'pendiente';
  end if;
  return null;
end;
$$;
revoke execute on function public.fn_conductor_delivery_apagado_ofertas() from public, anon, authenticated;

drop trigger if exists trg_conductor_delivery_apagado_ofertas on public.conductores;
create trigger trg_conductor_delivery_apagado_ofertas
  after update of modo_delivery on public.conductores
  for each row execute function public.fn_conductor_delivery_apagado_ofertas();

notify pgrst, 'reload schema';
