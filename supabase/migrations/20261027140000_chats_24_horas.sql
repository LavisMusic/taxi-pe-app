-- =========================================================================
-- Regla de las 24 horas: todo chat de Mensajes vive 24 horas.
--
--   Se borra cada hora lo que pasó las 24 h:
--     * chat_mensajes (chats de viaje). Se GUARDA la fila de la oferta de
--       un viaje en curso (pendiente / aceptada / en tránsito) y la del
--       viaje finalizado mientras su turno no esté cerrado: de ahí salen
--       las ganancias del cierre de turno (taxi_cerrar_turno_conductor).
--       Ya cerrado el turno (el cierre guarda su propio detalle), se borra.
--       Esas filas no se muestran en Mensajes.
--     * entrega_mensajes (chats de las entregas).
--     * mensajes_plataforma (fijados "Taxi PE" / "Tonazo").
--   "Al cerrar caja" el conductor deja de ver sus chats anteriores (su
--   lado; el pasajero los sigue viendo hasta las 24 h): la app filtra por
--   la hora de su último turno cerrado, no hace falta nada acá.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.taxi_limpiar_chats_24h()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corte    timestamptz := now() - interval '24 hours';
  v_chat     integer;
  v_entrega  integer;
  v_fijados  integer;
begin
  delete from public.chat_mensajes m
  where m.created_at < v_corte
    and not (m.tipo = 'oferta' and m.estado_oferta in ('pendiente', 'aceptada', 'en_transito'))
    and not (
      m.tipo = 'oferta'
      and m.estado_oferta = 'finalizado'
      and not exists (
        select 1 from public.taxi_conductor_turnos t
        where t.conductor_id = m.conductor_id
          and t.hasta >= coalesce(m.finalizado_at, m.created_at)
      )
    );
  get diagnostics v_chat = row_count;

  delete from public.entrega_mensajes where created_at < v_corte;
  get diagnostics v_entrega = row_count;

  delete from public.mensajes_plataforma where programado_para < v_corte;
  get diagnostics v_fijados = row_count;

  return jsonb_build_object('chat_mensajes', v_chat, 'entrega_mensajes', v_entrega, 'mensajes_plataforma', v_fijados);
end;
$$;
revoke execute on function public.taxi_limpiar_chats_24h() from public, anon, authenticated;

select cron.unschedule('chats-24-horas')
where exists (select 1 from cron.job where jobname = 'chats-24-horas');
-- Cada hora, a los 7 minutos.
select cron.schedule('chats-24-horas', '7 * * * *', $$select public.taxi_limpiar_chats_24h()$$);

-- Borrar un chat a mano ya no existe: se borran solos (rpc_borrar_hilo_chat
-- se deja por compatibilidad con versiones viejas de la app).

notify pgrst, 'reload schema';
