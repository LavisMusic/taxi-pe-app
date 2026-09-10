-- =========================================================================
-- MÍNIMO para que "Pedido recogido y pagado" avise a la Caja.
--   Proyecto: Taxi-PE (silfhbdmfdryjdzpwzvh). Idempotente.
--   Reemplaza a 20260910120000 / 20260910130000 (que se truncaban al pegar).
-- Requiere el secreto del Vault: webhook_url_caja_entrega_estado.
-- =========================================================================

-- 1) Routing del evento taxi.entrega_estado.
create or replace function public.fn_webhook_emitir(
  p_event_type text, p_destino text, p_data jsonb
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid := gen_random_uuid();
  v_url text;
  v_sobre jsonb;
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

-- 2) Helper tolerante a fallos: si el webhook falla, NO tumba la transición.
create or replace function public.fn_entrega_avisar_caja(p_entrega_id uuid, p_estado text)
returns void language plpgsql security definer set search_path = public as $$
declare v_ref text;
begin
  select caja_pedido_ref into v_ref from public.entregas where id = p_entrega_id;
  if v_ref is null or btrim(v_ref) = '' then return; end if;
  begin
    perform public.fn_webhook_emitir(
      'taxi.entrega_estado', 'caja',
      jsonb_build_object('caja_pedido_ref', v_ref, 'entrega_id', p_entrega_id, 'estado', p_estado)
    );
  exception when others then
    raise warning 'fn_entrega_avisar_caja: webhook % no emitido: %', p_estado, sqlerrm;
  end;
end;
$$;

-- 3) "Pedido recogido y pagado": aceptado -> en_ruta + aviso a la Caja.
create or replace function public.rpc_entrega_avanzar(p_entrega_id uuid, p_conductor_id uuid, p_nuevo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_estado text;
begin
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

grant execute on function public.rpc_entrega_avanzar(uuid, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
