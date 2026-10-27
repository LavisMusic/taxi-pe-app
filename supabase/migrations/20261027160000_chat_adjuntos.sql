-- =========================================================================
-- Fotos y notas de voz en los chats (chat/EntradaChat.jsx). Viajan dentro
-- del texto del mensaje (lib/adjuntosChat.js) y el archivo se sube a este
-- bucket público, en carpetas por hora UTC (2026-10-27T15/<uuid>.jpg).
--
--   * Bucket 'chat-adjuntos': cualquiera con sesión sube (fotos hasta 10 MB
--     y audios); se lee público (enlaces imposibles de adivinar).
--   * Regla de las 24 h: cada hora la Edge Function limpiar-adjuntos borra
--     las carpetas de más de 24 h (los archivos solo se pueden borrar por la
--     API de Storage, no con SQL).
--
-- Proyecto: Taxi-PE (lo usan el pasajero y el repartidor; el cliente y la
-- tienda suben a Caja Tonazo). Idempotente.
-- =========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-adjuntos', 'chat-adjuntos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat_adjuntos_select" on storage.objects;
create policy "chat_adjuntos_select" on storage.objects
  for select using (bucket_id = 'chat-adjuntos');

drop policy if exists "chat_adjuntos_insert" on storage.objects;
create policy "chat_adjuntos_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-adjuntos');

create or replace function public.taxi_limpiar_adjuntos_disparar()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform net.http_post(
    url := 'https://silfhbdmfdryjdzpwzvh.supabase.co/functions/v1/limpiar-adjuntos',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
exception when others then
  raise warning 'taxi_limpiar_adjuntos_disparar: %', sqlerrm;
end;
$$;
revoke execute on function public.taxi_limpiar_adjuntos_disparar() from public, anon, authenticated;

select cron.unschedule('chat-adjuntos-24-horas')
where exists (select 1 from cron.job where jobname = 'chat-adjuntos-24-horas');
-- Cada hora, a los 12 minutos.
select cron.schedule('chat-adjuntos-24-horas', '12 * * * *', $$select public.taxi_limpiar_adjuntos_disparar()$$);
