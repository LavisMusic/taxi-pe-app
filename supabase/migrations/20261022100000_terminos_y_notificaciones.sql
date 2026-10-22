-- =========================================================================
-- Términos y condiciones + preferencia de notificaciones.
--
--   * usuarios.terminos_version / terminos_aceptados_at: qué versión de
--     los Términos aceptó cada cuenta y cuándo. La app pide aceptarlos
--     (al registrarse o, a quien ya existe, al entrar) y no deja usarla
--     sin aceptar la versión vigente.
--   * usuarios.notificaciones_activas: el interruptor del perfil para
--     dejar de recibir avisos emergentes y sonidos (los mensajes siguen
--     llegando dentro de la app).
-- Solo cambian por estas funciones, y cada usuario solo la suya
-- (auth.uid() = usuarios.id, ver 20261010100000_sesiones_reales.sql).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.usuarios
  add column if not exists terminos_version      text,
  add column if not exists terminos_aceptados_at timestamptz,
  add column if not exists notificaciones_activas boolean not null default true;

create or replace function public.taxi_aceptar_terminos(p_version text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or nullif(trim(p_version), '') is null then
    return false;
  end if;
  update public.usuarios
    set terminos_version = trim(p_version), terminos_aceptados_at = now()
    where id = auth.uid();
  return found;
end;
$$;
revoke execute on function public.taxi_aceptar_terminos(text) from public, anon;
grant execute on function public.taxi_aceptar_terminos(text) to authenticated;

create or replace function public.taxi_set_notificaciones(p_activas boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_activas is null then
    return false;
  end if;
  update public.usuarios set notificaciones_activas = p_activas where id = auth.uid();
  return found;
end;
$$;
revoke execute on function public.taxi_set_notificaciones(boolean) from public, anon;
grant execute on function public.taxi_set_notificaciones(boolean) to authenticated;

notify pgrst, 'reload schema';
