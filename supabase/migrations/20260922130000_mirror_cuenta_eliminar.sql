-- =========================================================================
-- Espejo de BORRADO de cuentas (unificación pasajero/cliente, ver
-- 20260918140000_mirror_cuenta_caja.sql): hasta ahora el espejo solo
-- cubría alta/cambio de PIN — al eliminar la cuenta desde CUALQUIERA de
-- las dos apps, la otra la seguía teniendo intacta.
--
-- Taxi-PE -> Caja (este archivo, dirección EMISORA): un DELETE sobre
-- 'usuarios' (rol 'pasajero') dispara un webhook por la infra outbox ya
-- existente (fn_webhook_emitir/despachar/reconciliar, con reintentos) —
-- a diferencia del espejo de alta/PIN (que sale del navegador del propio
-- pasajero sin sesión), este SÍ puede ser server-side porque ya no hay
-- nada que re-verificar: el borrado ya ocurrió.
--
-- Caja -> Taxi-PE (dirección RECEPTORA de este archivo): nuevo RPC
-- receptor de 'caja.mirror_cliente_eliminado', que emite
-- webhook-taxi-eliminar-cuenta del lado Caja (ver manage-usuario/delete +
-- _shared/mirrorTaxi.ts en ese repo).
--
-- Anti-bucle: la GUC local 'app.skip_mirror_caja' evita que un borrado
-- que LLEGÓ por webhook desde Caja dispare a su vez un webhook DE VUELTA
-- hacia Caja (mismo patrón de "origen" que ya usa
-- fiados_conductores/fn_emitir_pago_fiado_conductor, adaptado a DELETE
-- donde no hay una columna que marcar).
--
-- Requiere en el Vault de Taxi-PE (correr una sola vez, SQL Editor):
--   select vault.create_secret(
--     'https://xaerfywydzwifohjsvwa.supabase.co/functions/v1/webhook-taxi-mirror-cuenta',
--     'webhook_url_caja_eliminar_cuenta');
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- 1) Routing del nuevo evento en fn_webhook_emitir (reemplaza la función
--    completa — case + evento nuevo, preserva los 2 casos existentes).
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
    when 'taxi.pago_fiado_conductor'      then public.fn_webhook_secret('webhook_url_caja_pago_fiado')
    when 'taxi.entrega_estado'            then public.fn_webhook_secret('webhook_url_caja_entrega_estado')
    when 'taxi.mirror_pasajero_eliminado' then public.fn_webhook_secret('webhook_url_caja_eliminar_cuenta')
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

-- 2) EMISOR: al eliminar un pasajero desde Taxi-PE, avisar a Caja.
create or replace function public.fn_emitir_eliminar_pasajero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.rol <> 'pasajero' or old.telefono is null then
    return old;
  end if;
  -- Este borrado llegó por el receptor de Caja más abajo -> no rebotar.
  if current_setting('app.skip_mirror_caja', true) = 'true' then
    return old;
  end if;
  begin
    perform public.fn_webhook_emitir(
      'taxi.mirror_pasajero_eliminado', 'caja',
      jsonb_build_object('telefono', old.telefono)
    );
  exception when others then
    raise warning 'fn_emitir_eliminar_pasajero: webhook no emitido: %', sqlerrm;
  end;
  return old;
end;
$$;

drop trigger if exists trg_emitir_eliminar_pasajero on public.usuarios;
create trigger trg_emitir_eliminar_pasajero
  after delete on public.usuarios
  for each row execute function public.fn_emitir_eliminar_pasajero();

-- 3) RECEPTOR: 'caja.mirror_cliente_eliminado' (Caja borró un cliente).
create or replace function public.rpc_webhook_caja_eliminar_cliente(p_event_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nuevo    integer;
  v_telefono text := p_payload -> 'data' ->> 'telefono';
begin
  insert into public.webhook_inbox (event_id, event_type, payload)
  values (p_event_id, p_payload ->> 'event_type', p_payload)
  on conflict (event_id) do nothing;
  get diagnostics v_nuevo = row_count;
  if v_nuevo = 0 then
    return jsonb_build_object('status', 'duplicado');
  end if;

  if v_telefono is null then
    update public.webhook_inbox
      set estado = 'error', nota = 'falta telefono', procesado_at = now()
      where event_id = p_event_id;
    return jsonb_build_object('status', 'payload_invalido');
  end if;

  -- No re-emitir hacia Caja: este mismo DELETE dispara
  -- trg_emitir_eliminar_pasajero.
  perform set_config('app.skip_mirror_caja', 'true', true);
  delete from public.usuarios where telefono = v_telefono and rol = 'pasajero';

  update public.webhook_inbox
    set estado = 'procesado', procesado_at = now()
    where event_id = p_event_id;

  return jsonb_build_object('status', 'ok');
end;
$$;
