-- =========================================================================
-- Notificaciones del superadmin con imagen (además de video subido o de
-- YouTube en video_url). Las manda Caja Tonazo por webhook-caja-superadmin
-- ('mensajes.crear'). Igual que la migración 0128 de Caja.
--
-- Los anuncios caducados los borra Caja cada hora llamando a
-- 'anuncios.limpiar' del mismo webhook (no hace falta cron acá).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.mensajes_plataforma add column if not exists imagen_url text;

notify pgrst, 'reload schema';
