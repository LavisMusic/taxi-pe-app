-- =========================================================================
-- Vuelve taxi_login a como estaba (20261010100000_sesiones_reales.sql):
-- cada formulario busca solo las cuentas de su rol y no redirige por el
-- rol de la cuenta. Deshace la parte de login de 20261015110000; el
-- desbloqueo al cambiar el PIN con el código (taxi_restablecer_pin_guardar)
-- se queda.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.taxi_login(p_telefono text, p_pin text, p_roles text[])
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clave text := 'login:' || coalesce(trim(p_telefono), '');
  v_u     public.usuarios;
  v_hash  text;
begin
  if public.taxi_intento_bloqueado(v_clave) then
    return jsonb_build_object('estado', 'bloqueado');
  end if;

  select * into v_u from public.usuarios
    where telefono = trim(p_telefono) and rol = any (p_roles)
    limit 1;
  if v_u.id is null then
    perform public.taxi_intento_registrar(v_clave, false);
    return jsonb_build_object('estado', 'incorrecto');
  end if;

  select pin_hash into v_hash from public.usuarios_credenciales where usuario_id = v_u.id;
  if v_hash is null then
    return jsonb_build_object('estado', 'sin_pin', 'usuario', to_jsonb(v_u));
  end if;

  if coalesce(p_pin, '') !~ '^\d{6}$' or crypt(p_pin, v_hash) <> v_hash then
    perform public.taxi_intento_registrar(v_clave, false);
    return jsonb_build_object('estado', 'incorrecto');
  end if;

  perform public.taxi_intento_registrar(v_clave, true);
  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u), 'ticket', public.taxi_emitir_ticket(v_u.id, v_u.rol));
end;
$$;

notify pgrst, 'reload schema';
