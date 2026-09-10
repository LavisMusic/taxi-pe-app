-- =========================================================================
-- Checks de leído en el chat de una entrega delivery (entrega_mensajes).
-- Marca como leídos los mensajes de UN hilo que NO mandó quien llama.
--
-- Cajero/cliente pasan p_session_token; el repartidor pasa
-- p_entrega_id + p_conductor_id. p_rol_propio ∈ 'cajero'|'cliente'|'conductor'.
-- Idempotente.
-- =========================================================================

create or replace function public.rpc_entrega_marcar_leido(
  p_hilo         text,
  p_rol_propio   text,
  p_session_token uuid default null,
  p_entrega_id    uuid default null,
  p_conductor_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_n integer;
begin
  if p_session_token is not null then
    v_id := public.fn_entrega_por_token(p_session_token);
  elsif p_entrega_id is not null and p_conductor_id is not null then
    select id into v_id from public.entregas
    where id = p_entrega_id and conductor_id = p_conductor_id;
  end if;
  if v_id is null then return jsonb_build_object('status', 'no_autorizado'); end if;

  update public.entrega_mensajes
    set leido = true
  where entrega_id = v_id
    and hilo = p_hilo
    and leido = false
    and emisor_rol <> 'sistema'
    and emisor_rol <> p_rol_propio;
  get diagnostics v_n = row_count;

  return jsonb_build_object('status', 'ok', 'marcados', v_n);
end;
$$;

grant execute on function public.rpc_entrega_marcar_leido(text, text, uuid, uuid, uuid) to anon, authenticated;
