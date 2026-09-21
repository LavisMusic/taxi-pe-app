-- =========================================================================
-- Fix: el admin (panel /admin, "Eliminar usuario") borra la fila de
-- 'usuarios' pero NO la de 'conductores' — no tira error, simplemente
-- afecta 0 filas (RLS de conductores no tiene ninguna policy de DELETE
-- que la deje pasar). El conductor sigue existiendo: sigue en el
-- directorio, sigue sincronizando cambios, y su cuenta/membresía sigue
-- operativa aunque el admin haya "eliminado" el usuario.
--
-- Confirmado reproduciendo el flujo exacto de useUsuarios.js
-- (eliminarUsuario) con la clave anon: el DELETE de 'usuarios' borra
-- la fila real; el de 'conductores' devuelve count:0 sin error.
--
-- El admin de este proyecto no tiene sesión real de Supabase Auth (es
-- un código maestro validado del lado del cliente, ver
-- RequireAdminMaster.jsx/LoginAdminPage.jsx) — todas sus operaciones
-- ya corren con la clave anon, incluyendo el DELETE de 'usuarios' que
-- HOY SÍ funciona sin restricción. Esta policy le da a 'conductores'
-- el mismo criterio que ya tiene 'usuarios' — no es una restricción
-- nueva que se está aflojando, es la falta de una que ya faltaba.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

drop policy if exists "conductores_delete_anon" on public.conductores;
create policy "conductores_delete_anon" on public.conductores
  for delete
  using (true);
