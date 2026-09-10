-- =========================================================================
-- Cancelación de una entrega FORZADA desde la Caja (el cliente o el cajero
-- canceló el pedido). A diferencia de rpc_entrega_cancelar (solo
-- buscando/aceptado), esta cierra desde CUALQUIER estado no terminal,
-- incluido en_ruta — el conductor deja de tener la entrega activa en su
-- próximo poll (rpc_entrega_activa_conductor solo devuelve estados vivos).
--
-- La llama la Edge Function webhook-caja-entrega-cancelar. Idempotente.
-- Proyecto: Taxi-PE (silfhbdmfdryjdzpwzvh).
-- =========================================================================

create or replace function public.rpc_entrega_forzar_cancelacion(p_entrega_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_estado text;
begin
  select estado into v_estado from public.entregas where id = p_entrega_id for update;
  if v_estado is null then
    return jsonb_build_object('status', 'no_encontrada');
  end if;
  if v_estado in ('entregado', 'cancelado', 'no_entregado') then
    -- Ya está cerrada; idempotente.
    return jsonb_build_object('status', 'ok', 'nota', 'ya_cerrada', 'estado', v_estado);
  end if;

  update public.entregas
    set estado = 'cancelado', cerrado_at = now(), actualizado_at = now()
    where id = p_entrega_id;

  update public.entrega_ofertas set estado = 'cerrada', resuelta_at = now()
    where entrega_id = p_entrega_id and estado = 'pendiente';

  insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
  values (p_entrega_id, 'cliente_conductor', 'sistema',
          coalesce('Pedido cancelado desde la tienda: ' || p_motivo, 'Pedido cancelado desde la tienda.'));

  -- NO se llama fn_entrega_avisar_caja: la Caja originó esta cancelación.
  return jsonb_build_object('status', 'ok');
end;
$$;

grant execute on function public.rpc_entrega_forzar_cancelacion(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
