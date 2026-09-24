-- =========================================================================
-- Saldo de cliente EN VIVO de verdad (unificación pasajero/cliente): la
-- primera versión (Edge Function saldo-pasajero, consultada por Caja al
-- montar la tienda) resultó no ser "tiempo real" — solo se leía una vez,
-- nunca se enteraba si el repartidor recargaba al cliente MIENTRAS este
-- ya tenía la tienda abierta. Caja no puede suscribirse por Realtime a
-- ESTA base (son proyectos de Supabase distintos), así que la única
-- forma de que sea instantáneo de verdad es que Taxi-PE EMPUJE el
-- cambio hacia Caja (mismo patrón ya usado para el espejo de
-- cuenta/borrado) y Caja lo guarde localmente — ahí sí puede usar su
-- propio Realtime nativo.
--
-- Emisor: trigger en 'usuarios' (rol 'pasajero') que dispara cuando
-- cambian creditos_disponibles o membresia_vencimiento — cubre
-- CUALQUIER camino que los toque (hoy solo Recarga Rápida del
-- repartidor, pero no hace falta acordarse de esto si mañana aparece
-- otro).
--
-- Requiere en el Vault de Taxi-PE (correr una sola vez, SQL Editor):
--   select vault.create_secret(
--     'https://xaerfywydzwifohjsvwa.supabase.co/functions/v1/webhook-taxi-mirror-cuenta',
--     'webhook_url_caja_saldo_pasajero');
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- 1) Routing del nuevo evento en fn_webhook_emitir (reemplaza la función
--    completa — case + evento nuevo, preserva los 3 casos existentes).
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
    when 'taxi.saldo_pasajero'            then public.fn_webhook_secret('webhook_url_caja_saldo_pasajero')
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

-- 2) EMISOR: créditos o vencimiento de membresía de un pasajero cambian.
create or replace function public.fn_emitir_saldo_pasajero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rol <> 'pasajero' or new.telefono is null then
    return new;
  end if;
  if new.creditos_disponibles is not distinct from old.creditos_disponibles
     and new.membresia_vencimiento is not distinct from old.membresia_vencimiento then
    return new;
  end if;
  begin
    perform public.fn_webhook_emitir(
      'taxi.saldo_pasajero', 'caja',
      jsonb_build_object(
        'telefono', new.telefono,
        'creditos_disponibles', new.creditos_disponibles,
        'membresia_vencimiento', new.membresia_vencimiento
      )
    );
  exception when others then
    raise warning 'fn_emitir_saldo_pasajero: webhook no emitido: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_emitir_saldo_pasajero on public.usuarios;
create trigger trg_emitir_saldo_pasajero
  after update on public.usuarios
  for each row execute function public.fn_emitir_saldo_pasajero();
