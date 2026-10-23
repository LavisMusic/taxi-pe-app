-- =========================================================================
-- El repartidor lleva hasta 3 pedidos a la vez (antes 5). El límite vive
-- en taxi_max_repartos(): ofrecer (Caja) y aceptar (conductor) lo usan.
-- Si alguien ya tenía 4 o 5 en curso, los termina normal; recién puede
-- aceptar otro cuando baje de 3.
--
-- Requiere 20261014170000. Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.taxi_max_repartos()
returns integer
language sql
immutable
as $$ select 3 $$;
grant execute on function public.taxi_max_repartos() to anon, authenticated;

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

  if public.taxi_conductor_en_carrera(p_conductor_id) then
    return jsonb_build_object('status', 'conductor_en_carrera');
  end if;
  if public.taxi_conductor_repartos_activos(p_conductor_id) >= public.taxi_max_repartos() then
    return jsonb_build_object('status', 'limite_repartos');
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
grant execute on function public.rpc_entrega_ofertar(uuid, uuid, numeric) to anon, authenticated;

create or replace function public.rpc_entrega_aceptar(p_oferta_id uuid, p_conductor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entrega_id uuid;
  v_taken      uuid;
  v_nombre     text;
  v_total      numeric;
begin
  if public.taxi_conductor_en_carrera(p_conductor_id) then
    return jsonb_build_object('status', 'conductor_en_carrera');
  end if;
  -- Cuenta con el conductor bloqueado: dos "Aceptar" a la vez no pasan del límite.
  perform 1 from public.conductores where id = p_conductor_id for update;
  if public.taxi_conductor_repartos_activos(p_conductor_id) >= public.taxi_max_repartos() then
    return jsonb_build_object('status', 'limite_repartos');
  end if;

  select entrega_id into v_entrega_id
  from public.entrega_ofertas
  where id = p_oferta_id and conductor_id = p_conductor_id and estado = 'pendiente';
  if v_entrega_id is null then return jsonb_build_object('status', 'oferta_invalida'); end if;

  select conductor_id, total into v_taken, v_total from public.entregas where id = v_entrega_id for update;
  if v_taken is not null then
    update public.entrega_ofertas set estado = 'cerrada', resuelta_at = now() where id = p_oferta_id;
    return jsonb_build_object('status', 'ya_tomada');
  end if;

  update public.entregas
    set conductor_id = p_conductor_id, estado = 'aceptado',
        aceptado_at = now(), actualizado_at = now()
    where id = v_entrega_id;

  update public.entrega_ofertas set estado = 'aceptada', resuelta_at = now() where id = p_oferta_id;
  update public.entrega_ofertas set estado = 'cerrada',  resuelta_at = now()
    where entrega_id = v_entrega_id and id <> p_oferta_id and estado = 'pendiente';

  -- Repartiendo: deja de recibir pasajeros hasta entregar todo.
  update public.conductores set estado = 'desconectado'
    where id = p_conductor_id and estado in ('activo', 'ocupado');

  select nullif(trim(nombre), '') into v_nombre from public.conductores where id = p_conductor_id;

  -- (horas escalonadas: en el chat aparecen en este orden)
  insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje, created_at) values
    (v_entrega_id, 'cajero_conductor', 'conductor',
     '🛵 Hola, ' || coalesce('soy ' || v_nombre || ' y ', '') ||
     'voy en camino a la tienda a recoger el pedido. Por favor, tenlo listo.', now()),
    (v_entrega_id, 'cajero_conductor', 'cajero',
     '🏪 ¡Perfecto! Estamos pendientes de tu llegada. Recuerda que para retirar el pedido tienes que pagar su valor' ||
     coalesce(': S/ ' || to_char(v_total, 'FM999990.00'), '') || '.', now() + interval '2 seconds'),
    (v_entrega_id, 'cliente_conductor', 'conductor',
     '🛵 Hola, ' || coalesce('soy ' || v_nombre || ', ', '') ||
     'ya voy en camino a recoger tu pedido. Mantente atento y activa tus notificaciones para saber cuándo llego.', now()),
    (v_entrega_id, 'cliente_cajero', 'cajero',
     '🏪 El conductor está en camino a recoger tu pedido. Activa tus notificaciones y mantente atento.', now());

  return jsonb_build_object('status', 'ok', 'entrega_id', v_entrega_id);
end;
$$;

notify pgrst, 'reload schema';
