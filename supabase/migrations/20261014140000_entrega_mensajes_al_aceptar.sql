-- =========================================================================
-- Mensajes automáticos cuando el repartidor acepta un delivery.
--
--   * Repartidor → tienda: va en camino a recoger el pedido, que lo alisten.
--   * Tienda → repartidor: está pendiente de su llegada; para retirar el
--     pedido tiene que pagar su valor (S/ total).
--   * Repartidor → cliente: va en camino a recoger su pedido; que esté
--     atento y active sus notificaciones.
-- Reemplazan el aviso de sistema de antes. Misma función de
-- 20260911100000_entrega_multi_oferta.sql + los mensajes.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================
create or replace function public.rpc_entrega_aceptar(p_oferta_id uuid, p_conductor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entrega_id uuid;
  v_taken      uuid;
  v_en_ruta    int;
  v_nombre     text;
  v_total      numeric;
begin
  select count(*) into v_en_ruta from public.entregas
  where conductor_id = p_conductor_id and estado = 'en_ruta';
  if v_en_ruta > 0 then
    return jsonb_build_object('status', 'conductor_en_ruta');
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
     'ya voy en camino a recoger tu pedido. Mantente atento y activa tus notificaciones para saber cuándo llego.', now());

  return jsonb_build_object('status', 'ok', 'entrega_id', v_entrega_id);
end;
$$;
