-- =========================================================================
-- Perfil (foto y nombre de usuario) de la misma persona en las dos apps:
-- el pasajero de Taxi-PE y el cliente de Caja Tonazo son la misma cuenta
-- (espejo por teléfono). Taxi-PE es el dueño del nombre de usuario (aquí
-- vive la regla de único).
--
--   * Taxi -> Caja: al cambiar foto_url o nombre_usuario de un pasajero se
--     emite 'taxi.perfil_pasajero' (mismo receptor que el saldo,
--     webhook-taxi-mirror-cuenta), que lo copia a sus filas de
--     clientes_fiado.
--   * Caja -> Taxi: 'caja.perfil_cliente' (webhook-caja-mirror-cuenta ->
--     rpc_webhook_caja_perfil_cliente) aplica lo que el cliente cambió en
--     Caja y devuelve cómo quedó. Sin cambios en el payload, solo devuelve
--     el perfil (Caja lo lee así al abrir "Editar perfil"). El nombre de
--     usuario se valida igual que en taxi_nombre_usuario_libre.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Routing del evento nuevo (misma función, un caso más) ---------
create or replace function public.fn_webhook_emitir(p_event_type text, p_destino text, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid := gen_random_uuid();
  v_url      text;
  v_sobre    jsonb;
begin
  v_url := case p_event_type
    when 'taxi.pago_fiado_conductor'      then public.fn_webhook_secret('webhook_url_caja_pago_fiado')
    when 'taxi.entrega_estado'            then public.fn_webhook_secret('webhook_url_caja_entrega_estado')
    when 'taxi.mirror_pasajero_eliminado' then public.fn_webhook_secret('webhook_url_caja_eliminar_cuenta')
    -- Mismo receptor de Caja (webhook-taxi-mirror-cuenta).
    when 'taxi.cuenta_bloqueo'            then public.fn_webhook_secret('webhook_url_caja_eliminar_cuenta')
    when 'taxi.saldo_pasajero'            then public.fn_webhook_secret('webhook_url_caja_saldo_pasajero')
    when 'taxi.perfil_pasajero'           then public.fn_webhook_secret('webhook_url_caja_saldo_pasajero')
    else null
  end;
  if v_url is null then
    raise exception 'fn_webhook_emitir: sin URL para event_type %', p_event_type;
  end if;

  v_sobre := jsonb_build_object(
    'event_id', v_event_id,
    'event_type', p_event_type,
    'occurred_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'source', 'taxi',
    'data', p_data
  );

  insert into public.webhook_outbox (event_id, event_type, destino, url, payload)
  values (v_event_id, p_event_type, p_destino, v_url, v_sobre);

  perform public.fn_webhook_despachar(
    (select id from public.webhook_outbox where event_id = v_event_id)
  );
  return v_event_id;
end;
$$;
revoke execute on function public.fn_webhook_emitir(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.fn_webhook_emitir(text, text, jsonb) to service_role;

-- ---------- Taxi -> Caja: el pasajero cambió su foto o su usuario ---------
create or replace function public.fn_emitir_perfil_pasajero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rol <> 'pasajero' or new.telefono is null then
    return new;
  end if;
  if new.foto_url is not distinct from old.foto_url
     and new.nombre_usuario is not distinct from old.nombre_usuario then
    return new;
  end if;
  begin
    perform public.fn_webhook_emitir(
      'taxi.perfil_pasajero', 'caja',
      jsonb_build_object('telefono', new.telefono, 'foto_url', new.foto_url, 'nombre_usuario', new.nombre_usuario)
    );
  exception when others then
    raise warning 'fn_emitir_perfil_pasajero: webhook no emitido: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_emitir_perfil_pasajero on public.usuarios;
create trigger trg_emitir_perfil_pasajero
  after update of foto_url, nombre_usuario on public.usuarios
  for each row execute function public.fn_emitir_perfil_pasajero();

-- ---------- Caja -> Taxi: el cliente cambió (o lee) su perfil -------------
create or replace function public.rpc_webhook_caja_perfil_cliente(p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data     jsonb := p_payload -> 'data';
  v_telefono text  := trim(coalesce(v_data ->> 'telefono', ''));
  v_usuario  text  := lower(trim(coalesce(v_data ->> 'nombre_usuario', '')));
  v_u        public.usuarios;
begin
  if v_telefono = '' then
    return jsonb_build_object('status', 'payload_invalido');
  end if;
  select * into v_u from public.usuarios where telefono = v_telefono and rol = 'pasajero' limit 1;
  if v_u.id is null then
    return jsonb_build_object('status', 'sin_cuenta');
  end if;

  if v_data ? 'nombre_usuario' and v_usuario <> coalesce(lower(v_u.nombre_usuario), '') then
    if v_usuario !~ '^[a-z0-9._]{3,20}$' then
      return jsonb_build_object('status', 'usuario_invalido');
    end if;
    if exists (select 1 from public.usuarios where lower(nombre_usuario) = v_usuario and id <> v_u.id) then
      return jsonb_build_object('status', 'usuario_tomado');
    end if;
    update public.usuarios set nombre_usuario = v_usuario where id = v_u.id;
  end if;

  if v_data ? 'foto_url' and nullif(v_data ->> 'foto_url', '') is not null
     and (v_data ->> 'foto_url') is distinct from v_u.foto_url then
    update public.usuarios set foto_url = v_data ->> 'foto_url' where id = v_u.id;
  end if;

  select * into v_u from public.usuarios where id = v_u.id;
  return jsonb_build_object(
    'status', 'ok',
    'nombre', v_u.nombre,
    'nombre_usuario', v_u.nombre_usuario,
    'foto_url', v_u.foto_url
  );
end;
$$;
revoke execute on function public.rpc_webhook_caja_perfil_cliente(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.rpc_webhook_caja_perfil_cliente(uuid, jsonb) to service_role;

notify pgrst, 'reload schema';
