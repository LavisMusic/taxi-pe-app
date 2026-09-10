-- =========================================================================
-- Cuando una entrega se cierra (entregado / cancelado / no_entregado),
-- avisar a la Caja para que actualice SU pedido — son dos bases
-- distintas, así que va por webhook firmado (misma infra que 3.1/3.3).
-- Ver DELIVERY.md §7 / WEBHOOKS.md.
--
-- Requiere en el Vault de Taxi-PE:
--   select vault.create_secret(
--     'https://xaerfywydzwifohjsvwa.supabase.co/functions/v1/webhook-taxi-entrega-estado',
--     'webhook_url_caja_entrega_estado');
--
-- Idempotente.
-- =========================================================================

-- 1) Routing del nuevo evento en fn_webhook_emitir.
create or replace function public.fn_webhook_emitir(
  p_event_type text,
  p_destino    text,
  p_data       jsonb
)
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
    when 'taxi.pago_fiado_conductor' then public.fn_webhook_secret('webhook_url_caja_pago_fiado')
    when 'taxi.entrega_estado'       then public.fn_webhook_secret('webhook_url_caja_entrega_estado')
    else null
  end;
  if v_url is null then
    raise exception 'fn_webhook_emitir: sin URL para event_type %', p_event_type;
  end if;

  v_sobre := jsonb_build_object(
    'event_id',    v_event_id,
    'event_type',  p_event_type,
    'occurred_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'source',      'taxi',
    'data',        p_data
  );

  insert into public.webhook_outbox (event_id, event_type, destino, url, payload)
  values (v_event_id, p_event_type, p_destino, v_url, v_sobre);

  perform public.fn_webhook_despachar(
    (select id from public.webhook_outbox where event_id = v_event_id)
  );
  return v_event_id;
end;
$$;

-- 2) Helper: emite el aviso si la entrega tiene un pedido de la Caja.
create or replace function public.fn_entrega_avisar_caja(p_entrega_id uuid, p_estado text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_ref text;
begin
  select caja_pedido_ref into v_ref from public.entregas where id = p_entrega_id;
  if v_ref is null or btrim(v_ref) = '' then return; end if;
  perform public.fn_webhook_emitir(
    'taxi.entrega_estado', 'caja',
    jsonb_build_object('caja_pedido_ref', v_ref, 'entrega_id', p_entrega_id, 'estado', p_estado)
  );
end;
$$;

-- 3) Las 3 transiciones terminales llaman al helper.
create or replace function public.rpc_entrega_finalizar(p_entrega_id uuid, p_conductor_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_estado text; v_pin text;
begin
  select estado, pin into v_estado, v_pin from public.entregas
  where id = p_entrega_id and conductor_id = p_conductor_id;
  if v_estado is null then return jsonb_build_object('status', 'no_encontrada'); end if;
  if v_estado <> 'en_ruta' then
    return jsonb_build_object('status', 'estado_invalido', 'estado', v_estado);
  end if;
  if p_pin is null or btrim(p_pin) <> v_pin then
    return jsonb_build_object('status', 'pin_incorrecto');
  end if;

  update public.entregas
    set estado = 'entregado', entregado_at = now(), cerrado_at = now(), actualizado_at = now()
    where id = p_entrega_id;

  insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
  values (p_entrega_id, 'cliente_conductor', 'sistema', 'Entrega confirmada. ¡Gracias!');

  perform public.fn_entrega_avisar_caja(p_entrega_id, 'entregado');
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.rpc_entrega_cancelar(p_session_token uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_estado text;
begin
  v_id := public.fn_entrega_por_token(p_session_token);
  if v_id is null then return jsonb_build_object('status', 'token_invalido'); end if;

  select estado into v_estado from public.entregas where id = v_id for update;
  if v_estado not in ('buscando', 'aceptado') then
    return jsonb_build_object('status', 'ya_no_cancelable', 'estado', v_estado);
  end if;

  update public.entregas
    set estado = 'cancelado', cerrado_at = now(), actualizado_at = now()
    where id = v_id;
  update public.entrega_ofertas set estado = 'cerrada', resuelta_at = now()
    where entrega_id = v_id and estado = 'pendiente';

  insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
  values (v_id, 'cliente_conductor', 'sistema',
          coalesce('Pedido cancelado: ' || p_motivo, 'Pedido cancelado.'));

  perform public.fn_entrega_avisar_caja(v_id, 'cancelado');
  return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.rpc_entrega_no_entregado(p_entrega_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_estado text;
begin
  select estado into v_estado from public.entregas where id = p_entrega_id;
  if v_estado <> 'en_ruta' then
    return jsonb_build_object('status', 'estado_invalido', 'estado', v_estado);
  end if;
  update public.entregas
    set estado = 'no_entregado', cerrado_at = now(), actualizado_at = now()
    where id = p_entrega_id;

  perform public.fn_entrega_avisar_caja(p_entrega_id, 'no_entregado');
  return jsonb_build_object('status', 'ok');
end;
$$;
