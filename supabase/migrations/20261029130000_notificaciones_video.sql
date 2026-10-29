-- =========================================================================
-- Notificaciones del superadmin con video (las manda Caja Tonazo por
-- webhook-caja-superadmin, 'mensajes.crear'): se reproduce solo al entrar
-- al chat fijado. Igual que la migración 0127 de Caja.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.mensajes_plataforma add column if not exists video_url text;

notify pgrst, 'reload schema';
