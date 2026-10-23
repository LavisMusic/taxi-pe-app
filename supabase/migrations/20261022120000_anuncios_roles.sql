-- =========================================================================
-- Anuncios por rol (fase 2c: el gestor pasa al panel del superadmin).
--
-- anuncios.roles: a qué roles de Taxi PE se muestra el pop-up
-- (pasajero, conductor, recolector). Reemplaza a `publico` (que solo
-- distinguía pasajeros / conductores / todos y no podía apuntar a
-- recolectores ni a combinaciones). Se completa desde `publico` para los
-- anuncios que ya existen; `publico` queda solo por compatibilidad.
-- Los crea y edita el superadmin desde Caja, por el puente firmado
-- (Edge Function webhook-caja-superadmin, con service_role).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.anuncios add column if not exists roles text[];

update public.anuncios
  set roles = case coalesce(publico, 'pasajeros')
    when 'conductores'  then array['conductor']
    when 'recolectores' then array['recolector']
    when 'todos'        then array['pasajero', 'conductor', 'recolector']
    else array['pasajero']
  end
  where roles is null;

notify pgrst, 'reload schema';
