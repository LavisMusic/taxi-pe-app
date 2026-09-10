-- =========================================================================
-- Borrar el historial de chat de UN hilo (conductor ↔ pasajero) — para
-- que el conductor limpie de su bandeja las conversaciones de viajes ya
-- concretados. Ver ConductorChatInboxModal.jsx.
--
-- security definer + app-gated (el botón solo aparece cuando ese hilo no
-- tiene un viaje en curso, ver `pasajerosEnCarrera`).
-- Idempotente.
-- =========================================================================

create or replace function public.rpc_borrar_hilo_chat(p_conductor_id uuid, p_pasajero_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  delete from public.chat_mensajes
  where conductor_id = p_conductor_id
    and pasajero_id  = p_pasajero_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('status', 'ok', 'borrados', v_n);
end;
$$;

grant execute on function public.rpc_borrar_hilo_chat(uuid, uuid) to anon, authenticated;
