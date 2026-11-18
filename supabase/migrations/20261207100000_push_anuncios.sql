-- =========================================================================
-- Aviso emergente al publicarse un anuncio (Taxi-PE).
--
--   * anuncios.push_enviado_at: push-enviar manda cada anuncio UNA vez,
--     cuando ya está vigente (al crearlo "ahora" o cuando llega su
--     fecha_inicio, pg_cron cada minuto), a los dispositivos de las cuentas
--     de sus roles con los avisos activados. Al tocarlo se abre la app con
--     ESE anuncio primero (?anuncio=<id>), seguido de los demás.
--   * Los anuncios que ya existían quedan marcados (no se reenvían).
--   * anuncios en la publicación de realtime (los pop-ups se actualizan en
--     vivo).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.anuncios add column if not exists push_enviado_at timestamptz;
update public.anuncios set push_enviado_at = now() where push_enviado_at is null;

create or replace function public.fn_anuncios_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.push_enviado_at is null and coalesce(new.activo, false)
     and (new.fecha_inicio is null or new.fecha_inicio <= now())
     and (new.fecha_fin is null or new.fecha_fin >= now()) then
    perform public.taxi_push_disparar();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_anuncios_push on public.anuncios;
create trigger trg_anuncios_push
  after insert or update on public.anuncios
  for each row execute function public.fn_anuncios_push();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'anuncios'
  ) then
    alter publication supabase_realtime add table public.anuncios;
  end if;
end $$;

notify pgrst, 'reload schema';
