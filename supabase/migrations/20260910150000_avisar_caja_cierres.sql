-- =========================================================================
-- Avisos a la Caja en los cierres de entrega (entregado / no_entregado /
-- cancelado). Proyecto: Taxi-PE. Idempotente. Corré esto DESPUÉS de
-- 20260910140000_avisar_caja_min.sql.
-- =========================================================================

-- Finalizar con PIN (solo desde en_ruta).
create or replace function public.rpc_entrega_finalizar(p_entrega_id uuid, p_conductor_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
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

-- No-show (admin, solo desde en_ruta).
create or replace function public.rpc_entrega_no_entregado(p_entrega_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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

-- Cancelar por token (cajero/cliente, solo buscando/aceptado).
create or replace function public.rpc_entrega_cancelar(p_session_token uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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

grant execute on function
  public.rpc_entrega_finalizar(uuid, uuid, text),
  public.rpc_entrega_no_entregado(uuid, text),
  public.rpc_entrega_cancelar(uuid, text)
to anon, authenticated;

notify pgrst, 'reload schema';
