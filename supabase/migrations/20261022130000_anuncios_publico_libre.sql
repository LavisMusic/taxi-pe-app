-- =========================================================================
-- anuncios.publico ya no decide a quién se muestra (lo hace `roles`,
-- migración 20261022120000): se quita su CHECK viejo, que solo admitía
-- 'pasajeros', 'conductores' y 'todos' y hacía fallar un anuncio solo para
-- recolectores.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.anuncios drop constraint if exists anuncios_publico_check;

notify pgrst, 'reload schema';
