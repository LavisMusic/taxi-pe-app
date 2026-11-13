-- =========================================================================
-- Revisión de seguridad P1-F (Taxi-PE): el canal en vivo del viaje es
-- privado.
--
-- El canal 'viaje-<conductor_id>-<pasajero_id>' lleva el GPS en vivo del
-- conductor durante la carrera y los avisos del viaje (inicio, fin,
-- cancelación). Su nombre se arma con dos ids que se pueden conseguir, así
-- que cualquiera con la llave pública podía escucharlo. Ahora la app lo abre
-- como canal PRIVADO y Supabase Realtime solo deja escucharlo y enviar por
-- él a sus dos participantes (sesión de Taxi-PE): el conductor de ese viaje
-- y el pasajero.
--
-- Los demás canales en vivo se quedan públicos a propósito: el radar
-- ('radar_publico', autos libres en el mapa público), los avisos con solo un
-- id ('conductores-publico', 'perfiles') y los de nombre imposible de
-- adivinar (entregas por su id, sufijos al azar). Lo que lee la base
-- (postgres_changes) ya respeta los permisos de cada tabla.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ¿La sesión es el conductor o el pasajero de este canal de viaje?
-- 'viaje-' (6) + conductor (36) + '-' + pasajero (36).
create or replace function public.taxi__participa_canal_viaje(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_topic ~ '^viaje-[0-9a-f-]{36}-[0-9a-f-]{36}$'
     and auth.uid() is not null
     and (substr(p_topic, 44, 36) = auth.uid()::text
          or substr(p_topic, 7, 36) = public.taxi_mi_conductor_id()::text);
$$;
revoke execute on function public.taxi__participa_canal_viaje(text) from public, anon;
grant execute on function public.taxi__participa_canal_viaje(text) to authenticated;

drop policy if exists taxi_canal_viaje_leer on realtime.messages;
create policy taxi_canal_viaje_leer on realtime.messages
  for select to authenticated
  using (public.taxi__participa_canal_viaje(realtime.topic()));

drop policy if exists taxi_canal_viaje_enviar on realtime.messages;
create policy taxi_canal_viaje_enviar on realtime.messages
  for insert to authenticated
  with check (public.taxi__participa_canal_viaje(realtime.topic()));
