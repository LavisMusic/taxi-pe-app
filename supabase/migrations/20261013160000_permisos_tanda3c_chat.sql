-- =========================================================================
-- Seguridad, fase 2B — tanda 3c: tabla 'chat_mensajes'.
--
--   * LEER: el pasajero sus conversaciones (pasajero_id = su cuenta), el
--     conductor las de su fila de conductor, el Admin todas. Sin sesión,
--     nada.
--   * ESCRIBIR: cada uno solo en sus conversaciones y como sí mismo (o como
--     aviso del sistema); las ofertas solo las manda el conductor.
--   * CAMBIAR: un mensaje enviado no se edita — solo su estado de oferta,
--     si fue leído y la hora de fin del viaje. Aceptar o rechazar una oferta
--     lo hace solo el pasajero.
--   * BORRAR: el Admin; una conversación entera, también sus dos
--     participantes (rpc_borrar_hilo_chat).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Ayudante: id de la fila de conductor de la sesión --------------
create or replace function public.taxi_mi_conductor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.conductores
  where telefono = public.taxi_mi_telefono_conductor()
  limit 1;
$$;
revoke execute on function public.taxi_mi_conductor_id() from public, anon;
grant execute on function public.taxi_mi_conductor_id() to authenticated;

-- ---------- Políticas -------------------------------------------------------
select public.taxi_reiniciar_politicas('chat_mensajes');
alter table public.chat_mensajes enable row level security;
revoke all on public.chat_mensajes from anon;

create policy chat_leer on public.chat_mensajes for select to authenticated
  using (
    public.taxi_es_admin()
    or pasajero_id = auth.uid()
    or conductor_id = public.taxi_mi_conductor_id()
  );
create policy chat_escribir on public.chat_mensajes for insert to authenticated
  with check (
    public.taxi_es_admin()
    or (
      pasajero_id = auth.uid()
      and remitente in ('pasajero', 'sistema')
      and coalesce(tipo, 'texto') <> 'oferta'
    )
    or (
      conductor_id = public.taxi_mi_conductor_id()
      and remitente in ('conductor', 'sistema')
    )
  );
create policy chat_cambiar on public.chat_mensajes for update to authenticated
  using (
    public.taxi_es_admin()
    or pasajero_id = auth.uid()
    or conductor_id = public.taxi_mi_conductor_id()
  )
  with check (
    public.taxi_es_admin()
    or pasajero_id = auth.uid()
    or conductor_id = public.taxi_mi_conductor_id()
  );
create policy chat_admin_borrar on public.chat_mensajes for delete to authenticated
  using (public.taxi_es_admin());

-- ---------- Un mensaje enviado no se edita ---------------------------------
create or replace function public.fn_chat_mensajes_protegidos()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.taxi_es_admin() then
    return new;
  end if;
  if new.conductor_id is distinct from old.conductor_id
     or new.pasajero_id is distinct from old.pasajero_id
     or new.remitente is distinct from old.remitente
     or new.mensaje is distinct from old.mensaje
     or new.tipo is distinct from old.tipo
     or new.destino_lat is distinct from old.destino_lat
     or new.destino_lng is distinct from old.destino_lng
     or new.origen_lat is distinct from old.origen_lat
     or new.origen_lng is distinct from old.origen_lng
     or new.created_at is distinct from old.created_at then
    raise exception 'Un mensaje enviado no se puede editar.' using errcode = '42501';
  end if;
  -- Aceptar o rechazar una oferta: solo el pasajero de esa conversación.
  if old.estado_oferta = 'pendiente'
     and new.estado_oferta in ('aceptada', 'rechazada')
     and new.pasajero_id is distinct from auth.uid() then
    raise exception 'Solo el pasajero puede aceptar o rechazar la oferta.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_chat_mensajes_protegidos on public.chat_mensajes;
create trigger trg_chat_mensajes_protegidos
  before update on public.chat_mensajes
  for each row execute function public.fn_chat_mensajes_protegidos();

-- ---------- Borrar una conversación: sus participantes o el Admin ----------
create or replace function public.rpc_borrar_hilo_chat(p_conductor_id uuid, p_pasajero_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  if not (
    public.taxi_es_admin()
    or p_pasajero_id = auth.uid()
    or p_conductor_id = public.taxi_mi_conductor_id()
  ) then
    return jsonb_build_object('status', 'sin_permiso', 'borrados', 0);
  end if;
  delete from public.chat_mensajes
  where conductor_id = p_conductor_id
    and pasajero_id  = p_pasajero_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('status', 'ok', 'borrados', v_n);
end;
$$;
revoke execute on function public.rpc_borrar_hilo_chat(uuid, uuid) from public, anon;
grant execute on function public.rpc_borrar_hilo_chat(uuid, uuid) to authenticated;
