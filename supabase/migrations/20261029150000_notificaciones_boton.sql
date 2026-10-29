-- =========================================================================
-- Notificaciones del superadmin con botón con enlace (como los anuncios):
-- las manda Caja Tonazo por webhook-caja-superadmin ('mensajes.crear').
-- Igual que la migración 0129 de Caja.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.mensajes_plataforma
  add column if not exists boton_url text,
  add column if not exists boton_texto text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mensajes_plataforma_boton_texto_check') then
    alter table public.mensajes_plataforma add constraint mensajes_plataforma_boton_texto_check
      check (boton_texto is null or char_length(boton_texto) <= 16);
  end if;
end $$;

notify pgrst, 'reload schema';
