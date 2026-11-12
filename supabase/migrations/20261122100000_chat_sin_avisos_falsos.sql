-- =========================================================================
-- Chats sin avisos del sistema falsos (Taxi-PE).
--
--   * chat_mensajes (viajes): desde el teléfono, un aviso del sistema
--     (remitente 'sistema' o tipo 'sistema'/'sistema_viaje') solo puede ser
--     uno de los avisos fijos que manda la app, y cada lado solo los suyos:
--       pasajero  → "❌ El pasajero rechazó la oferta",
--                   "⚠️ El pasajero ha cancelado el viaje"
--       conductor → "⚠️ El conductor ha cancelado el viaje",
--                   "📍 Estás cerca de tu destino", "🚀 Viaje Iniciado"
--     Antes cualquiera podía escribir cualquier texto como "sistema".
--   * El conductor solo escribe en conversaciones que el pasajero empezó
--     (antes podía escribirle a cualquier pasajero_id).
--   * rpc_entrega_mensaje_nuevo (chats de la entrega): el repartidor tiene
--     que ser él (sesión) y escribe como 'conductor'; con el token de la
--     entrega se escribe como 'cliente' o 'cajero'; y el hilo tiene que ser
--     uno donde participa ese rol.
--
-- Lo que escribe la base (funciones security definer) no pasa por acá.
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.fn_chat_mensajes_remitente()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_tipo text := coalesce(new.tipo, 'texto');
  v_conductor uuid;
  v_es_pasajero boolean;
  v_es_conductor boolean;
begin
  if current_user not in ('anon', 'authenticated') or public.taxi_es_admin() then
    return new;
  end if;

  v_conductor := public.taxi_mi_conductor_id();
  v_es_pasajero := new.pasajero_id = auth.uid();
  v_es_conductor := v_conductor is not null and new.conductor_id = v_conductor;

  if v_tipo not in ('texto', 'oferta', 'senas', 'sistema', 'sistema_viaje') then
    raise exception 'Tipo de mensaje no permitido.' using errcode = '42501';
  end if;

  -- Avisos del sistema: solo los fijos de la app, cada lado los suyos.
  -- (\S{1,3} = el emoji del inicio, con o sin su selector de variante.)
  if new.remitente = 'sistema' or v_tipo in ('sistema', 'sistema_viaje') then
    if not (
      new.remitente = 'sistema'
      and (
        (v_es_pasajero and v_tipo = 'sistema'
          and new.mensaje ~ '^\S{1,3} El pasajero (rechazó la oferta|ha cancelado el viaje)$')
        or (v_es_conductor and v_tipo = 'sistema'
          and new.mensaje ~ '^\S{1,3} (El conductor ha cancelado el viaje|Estás cerca de tu destino)$')
        or (v_es_conductor and v_tipo = 'sistema_viaje'
          and new.mensaje ~ '^\S{1,3} Viaje Iniciado$')
      )
    ) then
      raise exception 'Aviso del sistema no permitido.' using errcode = '42501';
    end if;
  end if;

  -- El conductor no abre conversaciones: el pasajero tiene que haber escrito.
  if v_es_conductor and not v_es_pasajero and not exists (
    select 1 from public.chat_mensajes c
    where c.conductor_id = new.conductor_id
      and c.pasajero_id = new.pasajero_id
      and c.remitente = 'pasajero'
  ) then
    raise exception 'El pasajero todavía no te ha escrito.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_chat_mensajes_remitente on public.chat_mensajes;
create trigger trg_chat_mensajes_remitente
  before insert on public.chat_mensajes
  for each row execute function public.fn_chat_mensajes_remitente();

-- ---------- Chats de la entrega --------------------------------------------
create or replace function public.rpc_entrega_mensaje_nuevo(
  p_hilo         text,
  p_emisor_rol   text,
  p_mensaje      text,
  p_session_token uuid default null,
  p_entrega_id    uuid default null,
  p_conductor_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_session_token is not null then
    -- Token de la entrega (Caja): escribe el cliente o el cajero.
    if p_emisor_rol not in ('cliente', 'cajero') then
      return jsonb_build_object('status', 'no_autorizado');
    end if;
    v_id := public.fn_entrega_por_token(p_session_token);
  elsif p_entrega_id is not null and p_conductor_id is not null then
    -- El repartidor: tiene que ser él (su sesión) y escribe como conductor.
    if p_emisor_rol <> 'conductor' or public.taxi_mi_conductor_id() is distinct from p_conductor_id then
      return jsonb_build_object('status', 'no_autorizado');
    end if;
    select id into v_id from public.entregas
    where id = p_entrega_id and conductor_id = p_conductor_id;
  end if;
  if v_id is null then return jsonb_build_object('status', 'no_autorizado'); end if;

  if p_hilo not in ('cliente_cajero', 'cliente_conductor', 'cajero_conductor')
     or p_emisor_rol not in ('cliente', 'cajero', 'conductor')
     or position(p_emisor_rol in p_hilo) = 0
     or btrim(coalesce(p_mensaje, '')) = '' then
    return jsonb_build_object('status', 'datos_invalidos');
  end if;

  insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
  values (v_id, p_hilo, p_emisor_rol, btrim(p_mensaje));
  return jsonb_build_object('status', 'ok');
end;
$$;

notify pgrst, 'reload schema';
