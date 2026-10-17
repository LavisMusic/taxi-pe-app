-- =========================================================================
-- 1. Login: el mismo teléfono puede tener más de una cuenta (por ejemplo
--    pasajero y conductor; no hay índice único). taxi_login revisa las
--    cuentas en el orden de p_roles y entra a la primera cuyo PIN
--    coincide. Así el login de pasajeros (que ahora manda los 3 roles)
--    lleva a un conductor o recolector a su panel, y quien tenga dos
--    cuentas entra a la del PIN que escribió.
--    Si ninguna coincide y alguna todavía no tiene PIN → 'sin_pin' con
--    esa cuenta (igual que antes).
-- 2. Cambiar el PIN con el código (/restablecer-pin) borra el bloqueo y
--    los fallos del login de ese número: quien recupera el PIN casi
--    siempre es quien se bloqueó por olvidarlo.
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
  v_clave   text := 'login:' || coalesce(trim(p_telefono), '');
  v_u       public.usuarios;
  v_hash    text;
  v_sin_pin public.usuarios;
begin
  if public.taxi_intento_bloqueado(v_clave) then
    return jsonb_build_object('estado', 'bloqueado');
  end if;

  for v_u in
    select * from public.usuarios
    where telefono = trim(p_telefono) and rol = any (p_roles)
    order by array_position(p_roles, rol), created_at
  loop
    select pin_hash into v_hash from public.usuarios_credenciales where usuario_id = v_u.id;
    if v_hash is null then
      if v_sin_pin.id is null then
        v_sin_pin := v_u;
      end if;
    elsif coalesce(p_pin, '') ~ '^\d{6}$' and crypt(p_pin, v_hash) = v_hash then
      perform public.taxi_intento_registrar(v_clave, true);
      return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u), 'ticket', public.taxi_emitir_ticket(v_u.id, v_u.rol));
    end if;
  end loop;

  if v_sin_pin.id is not null then
    return jsonb_build_object('estado', 'sin_pin', 'usuario', to_jsonb(v_sin_pin));
  end if;

  perform public.taxi_intento_registrar(v_clave, false);
  return jsonb_build_object('estado', 'incorrecto');
end;
$$;

create or replace function public.taxi_restablecer_pin_guardar(p_token uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_p   public.peticiones_pin;
  v_id  uuid;
  v_tel text;
begin
  select * into v_p from public.peticiones_pin
  where reset_token = p_token and reset_expira > now();
  if not found then
    return jsonb_build_object('estado', 'vencido');
  end if;
  v_id := coalesce(
    v_p.usuario_id,
    (select id from public.usuarios where dni = v_p.dni limit 1)
  );
  if v_id is null then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  perform public.taxi_guardar_pin(v_id, p_pin);
  update public.peticiones_pin set reset_token = null, reset_expira = null where id = v_p.id;

  -- Sin bloqueo: puede entrar ya mismo con el PIN nuevo.
  select telefono into v_tel from public.usuarios where id = v_id;
  if v_tel is not null then
    delete from public.taxi_intentos where clave = 'login:' || v_tel;
  end if;
  return jsonb_build_object('estado', 'ok');
end;
$$;
grant execute on function public.taxi_restablecer_pin_guardar(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
