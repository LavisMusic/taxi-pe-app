-- =========================================================================
-- Avisos emergentes (Web Push) de los chats de viaje (Taxi-PE): pasajero ↔
-- conductor. Hasta ahora solo llegaban los de los chats fijados.
--
--   * push_chat_pendientes: cola de avisos de chat, uno por destinatario.
--     La llena el trigger de chat_mensajes y la vacía la Edge Function
--     push-enviar (ya existente), que la base llama al toque.
--   * Solo a la otra persona y solo si tiene "Avisos y sonido" activado
--     (usuarios.notificaciones_activas, lo filtra la función). Los mensajes
--     automáticos del sistema no avisan.
--   * Al tocar el aviso se abre Mensajes en ESE chat: "conductor:<id>" (el
--     pasajero) o "pasajero:<id>" (el conductor).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create table if not exists public.push_chat_pendientes (
  id              uuid primary key default gen_random_uuid(),
  destinatario_id uuid not null references public.usuarios(id) on delete cascade,
  titulo          text not null,
  cuerpo          text not null,
  canal           text not null,
  ruta            text not null,
  tag             text,
  created_at      timestamptz not null default now(),
  enviado_at      timestamptz
);
create index if not exists push_chat_pendientes_cola_idx on public.push_chat_pendientes (created_at) where enviado_at is null;
alter table public.push_chat_pendientes enable row level security;
revoke all on public.push_chat_pendientes from anon, authenticated;

-- Texto del aviso (fotos y notas de voz van codificadas, lib/adjuntosChat.js).
create or replace function public.taxi__previa_chat(p_tipo text, p_texto text)
returns text
language sql
immutable
as $$
  select case
    when p_tipo = 'oferta' then '💰 Tarifa: ' || left(coalesce(p_texto, ''), 120)
    when p_tipo = 'senas' then '👋 ' || left(coalesce(p_texto, 'Te hicieron señas'), 150)
    when p_texto like '⟦foto⟧%' then '📷 Foto'
    when p_texto like '⟦audio:%' then '🎤 Nota de voz'
    else left(coalesce(p_texto, ''), 160)
  end;
$$;

create or replace function public.fn_chat_mensajes_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cond record;
  v_dest uuid;
  v_titulo text;
begin
  if new.remitente not in ('pasajero', 'conductor')
     or coalesce(new.tipo, 'texto') in ('sistema', 'sistema_viaje') then
    return new;
  end if;
  select id, nombre, telefono into v_cond from public.conductores where id = new.conductor_id;
  if not found then
    return new;
  end if;

  if new.remitente = 'pasajero' then
    -- Al conductor (su cuenta de usuario, por teléfono).
    select u.id into v_dest from public.usuarios u where u.telefono = v_cond.telefono and u.rol = 'conductor' limit 1;
    select coalesce(nullif('@' || u.nombre_usuario, '@'), nullif(trim(u.nombre), ''), 'Pasajero') into v_titulo
      from public.usuarios u where u.id = new.pasajero_id;
    if v_dest is not null then
      insert into public.push_chat_pendientes (destinatario_id, titulo, cuerpo, canal, ruta, tag)
      values (v_dest, coalesce(v_titulo, 'Pasajero'), public.taxi__previa_chat(new.tipo, new.mensaje),
              'pasajero:' || new.pasajero_id::text, '/conductor?mensajes=pasajero:' || new.pasajero_id::text,
              'chat-viaje-' || new.conductor_id::text || '-' || new.pasajero_id::text);
    end if;
  else
    -- Al pasajero.
    insert into public.push_chat_pendientes (destinatario_id, titulo, cuerpo, canal, ruta, tag)
    values (new.pasajero_id, coalesce(nullif(trim(v_cond.nombre), ''), 'Tu conductor'),
            public.taxi__previa_chat(new.tipo, new.mensaje),
            'conductor:' || new.conductor_id::text, '/?mensajes=conductor:' || new.conductor_id::text,
            'chat-viaje-' || new.conductor_id::text || '-' || new.pasajero_id::text);
  end if;
  perform public.taxi_push_disparar();
  return new;
exception when others then
  raise warning 'fn_chat_mensajes_push: %', sqlerrm;
  return new;
end;
$$;
drop trigger if exists trg_chat_mensajes_push on public.chat_mensajes;
create trigger trg_chat_mensajes_push
  after insert on public.chat_mensajes
  for each row execute function public.fn_chat_mensajes_push();

notify pgrst, 'reload schema';
