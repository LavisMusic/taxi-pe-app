-- =========================================================================
-- Notificaciones emergentes (Web Push) de los chats fijados (fase 2d).
--
--   * push_suscripciones: cada dispositivo/navegador donde una cuenta
--     activó los avisos (endpoint + claves del navegador). Se guardan y
--     borran solo con taxi_push_suscribir / taxi_push_desuscribir (un
--     dispositivo compartido queda con la última cuenta que lo activó).
--   * mensajes_plataforma.push_enviado_at: la Edge Function push-enviar
--     manda cada mensaje una sola vez, cuando llega su hora, a quienes
--     tienen ese rol y los avisos activados (usuarios.notificaciones_activas).
--     Los mensajes que ya existían quedan marcados (no se reenvían).
--   * Se dispara al crear un mensaje "ahora" y cada minuto (pg_cron) para
--     los programados.
--   * Las claves VAPID viven en el Vault (vapid_public_key /
--     vapid_private_key; las crea scripts/generar-claves-push.sh).
--     push_clave_publica() entrega la pública a la app.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create table if not exists public.push_suscripciones (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.usuarios(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_suscripciones enable row level security;
revoke all on public.push_suscripciones from anon, authenticated;

create or replace function public.taxi_push_suscribir(p_endpoint text, p_p256dh text, p_auth text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(p_endpoint, '') !~ '^https://' or nullif(p_p256dh, '') is null or nullif(p_auth, '') is null then
    return false;
  end if;
  insert into public.push_suscripciones (usuario_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  return true;
end;
$$;
revoke execute on function public.taxi_push_suscribir(text, text, text) from public, anon;
grant execute on function public.taxi_push_suscribir(text, text, text) to authenticated;

create or replace function public.taxi_push_desuscribir(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_suscripciones where endpoint = p_endpoint and usuario_id = auth.uid();
$$;
revoke execute on function public.taxi_push_desuscribir(text) from public, anon;
grant execute on function public.taxi_push_desuscribir(text) to authenticated;

create or replace function public.push_clave_publica()
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'vapid_public_key' limit 1;
$$;
revoke execute on function public.push_clave_publica() from public;
grant execute on function public.push_clave_publica() to anon, authenticated;

alter table public.mensajes_plataforma add column if not exists push_enviado_at timestamptz;
update public.mensajes_plataforma set push_enviado_at = now()
  where push_enviado_at is null and programado_para <= now();

-- Llama a la Edge Function (manda lo que esté pendiente; si no hay nada, no hace nada).
create or replace function public.taxi_push_disparar()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform net.http_post(
    url := 'https://silfhbdmfdryjdzpwzvh.supabase.co/functions/v1/push-enviar',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
exception when others then
  raise warning 'taxi_push_disparar: %', sqlerrm;
end;
$$;
revoke execute on function public.taxi_push_disparar() from public, anon, authenticated;

create or replace function public.fn_mensajes_plataforma_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.programado_para <= now() then
    perform public.taxi_push_disparar();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_mensajes_plataforma_push on public.mensajes_plataforma;
create trigger trg_mensajes_plataforma_push
  after insert on public.mensajes_plataforma
  for each row execute function public.fn_mensajes_plataforma_push();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'push-enviar') then
    perform cron.unschedule('push-enviar');
  end if;
  perform cron.schedule('push-enviar', '* * * * *', 'select public.taxi_push_disparar()');
end $$;

notify pgrst, 'reload schema';
