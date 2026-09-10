-- =========================================================================
-- Delivery — ajustes de flujo (sobre 20260908150000_delivery_core.sql).
--   Proyecto: Taxi-PE (silfhbdmfdryjdzpwzvh). Ver DELIVERY.md §4.
--
-- Cambio: se elimina el paso manual "en camino". El repartidor solo marca
-- "Pedido recogido" y la entrega pasa DIRECTO a 'en_ruta' (el estado sigue
-- existiendo para que cliente/cajero vean "va en camino", pero se setea
-- solo). Queda: buscando → aceptado → en_ruta → entregado
--                                            ↘ (no-show, cierra admin) → no_entregado
--
-- Idempotente.
-- =========================================================================

-- Normaliza filas viejas que hubieran quedado en 'retirado' (solo datos
-- de prueba) y saca ese valor del check.
update public.entregas set estado = 'en_ruta' where estado = 'retirado';

alter table public.entregas drop constraint if exists entregas_estado_check;
alter table public.entregas add constraint entregas_estado_check check (estado in (
  'buscando', 'aceptado', 'en_ruta', 'entregado', 'cancelado', 'no_entregado'
));

-- "Pedido recogido": aceptado → en_ruta, y estampa retirado_at.
create or replace function public.rpc_entrega_avanzar(p_entrega_id uuid, p_conductor_id uuid, p_nuevo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Finalizar: ahora solo desde 'en_ruta'.
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

  return jsonb_build_object('status', 'ok');
end;
$$;

-- No-show: ahora solo desde 'en_ruta'.
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
  return jsonb_build_object('status', 'ok');
end;
$$;
