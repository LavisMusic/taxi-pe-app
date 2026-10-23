-- =========================================================================
-- Recuperar el PIN con un código enviado por WhatsApp.
--
-- Antes: el Admin tocaba "Verificar identidad" y la petición quedaba
-- 'verificado'; después CUALQUIERA que supiera ese DNI podía entrar a
-- /recuperar-pin y ponerle un PIN nuevo a la cuenta.
--
-- Ahora:
--   1. El Admin toca "Enviar código" (taxi_admin_codigo_pin): se genera un
--      código de 8 caracteres (letras y números, sin 0/O/1/I/L), de un solo
--      uso, que vence en 30 minutos. En la base solo queda su hash. La app
--      abre WhatsApp con el aviso, el código y el enlace a /restablecer-pin.
--      Reenviar genera uno nuevo y anula el anterior.
--   2. El usuario escribe el código en /restablecer-pin
--      (taxi_restablecer_pin_validar): si es correcto, la petición se
--      resuelve sola y recibe un permiso de 15 minutos para elegir su PIN
--      (taxi_restablecer_pin_guardar). 5 códigos incorrectos desde el mismo
--      dispositivo → 15 minutos de bloqueo.
--   3. Elegir el PIN solo con el DNI (taxi_fijar_pin_recuperacion) deja
--      de funcionar.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- Estado nuevo: 'codigo_enviado' (el Admin ya mandó el código).
do $$
declare
  v_nombre text;
begin
  select conname into v_nombre from pg_constraint
  where conrelid = 'public.peticiones_pin'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%estado%';
  if v_nombre is not null then
    execute format('alter table public.peticiones_pin drop constraint %I', v_nombre);
  end if;
end $$;
alter table public.peticiones_pin add constraint peticiones_pin_estado_check
  check (estado in ('pendiente', 'verificado', 'codigo_enviado', 'resuelto'));

alter table public.peticiones_pin
  add column if not exists codigo_hash   text,
  add column if not exists codigo_expira timestamptz,
  add column if not exists reset_token   uuid,
  add column if not exists reset_expira  timestamptz;

-- Código legible: 8 caracteres de un alfabeto sin los que se confunden.
create or replace function public.taxi_codigo_legible()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $$
declare
  v_abc   constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea := gen_random_bytes(8);
  v_out   text := '';
begin
  for i in 0..7 loop
    v_out := v_out || substr(v_abc, (get_byte(v_bytes, i) % length(v_abc)) + 1, 1);
  end loop;
  return v_out;
end;
$$;
revoke execute on function public.taxi_codigo_legible() from public, anon, authenticated;

-- ---------- Admin: generar y enviar el código ---------------------------------
-- Devuelve { estado, codigo ('XXXX-XXXX'), expira, nombre, telefono }.
create or replace function public.taxi_admin_codigo_pin(p_peticion_id text, p_token uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_p      public.peticiones_pin;
  v_codigo text;
  v_expira timestamptz := now() + interval '30 minutes';
  v_tel    text;
begin
  if not (public.taxi_es_admin() or (p_token is not null and public.taxi_admin_token_valido(p_token))) then
    return jsonb_build_object('estado', 'sin_sesion');
  end if;
  select * into v_p from public.peticiones_pin where id::text = p_peticion_id;
  if not found or v_p.estado = 'resuelto' then
    return jsonb_build_object('estado', 'no_existe');
  end if;

  v_codigo := public.taxi_codigo_legible();
  update public.peticiones_pin
    set codigo_hash = crypt(v_codigo, gen_salt('bf')),
        codigo_expira = v_expira,
        reset_token = null,
        reset_expira = null,
        estado = 'codigo_enviado'
    where id = v_p.id;

  select telefono into v_tel from public.usuarios where dni = v_p.dni limit 1;
  return jsonb_build_object(
    'estado', 'ok',
    'codigo', substr(v_codigo, 1, 4) || '-' || substr(v_codigo, 5, 4),
    'expira', v_expira,
    'nombre', v_p.nombre,
    'telefono', v_tel
  );
end;
$$;
revoke execute on function public.taxi_admin_codigo_pin(text, uuid) from public, anon;
grant execute on function public.taxi_admin_codigo_pin(text, uuid) to authenticated;

-- Clave del límite de intentos: el dispositivo (IP que ve la API).
create or replace function public.taxi_clave_dispositivo(p_prefijo text)
returns text
language sql
stable
as $$
  select p_prefijo || ':' || coalesce(
    nullif(trim(split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1)), ''),
    'sin-ip'
  );
$$;
revoke execute on function public.taxi_clave_dispositivo(text) from public, anon, authenticated;

-- ---------- Usuario: validar el código ----------------------------------------
-- Devuelve { estado: 'ok' | 'incorrecto' | 'bloqueado', token, nombre }.
create or replace function public.taxi_restablecer_pin_validar(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_clave  text := public.taxi_clave_dispositivo('restablecer-pin');
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
  v_p      public.peticiones_pin;
  v_token  uuid := gen_random_uuid();
begin
  if public.taxi_intento_bloqueado(v_clave) then
    return jsonb_build_object('estado', 'bloqueado');
  end if;

  if length(v_codigo) = 8 then
    select * into v_p
    from public.peticiones_pin
    where estado = 'codigo_enviado'
      and codigo_hash is not null
      and codigo_expira > now()
      and crypt(v_codigo, codigo_hash) = codigo_hash
    limit 1;
  end if;

  if v_p.id is null then
    perform public.taxi_intento_registrar(v_clave, false, 5);
    if public.taxi_intento_bloqueado(v_clave) then
      return jsonb_build_object('estado', 'bloqueado');
    end if;
    return jsonb_build_object('estado', 'incorrecto');
  end if;

  perform public.taxi_intento_registrar(v_clave, true);
  -- Código correcto: la petición queda resuelta (aunque después no elija
  -- el PIN) y el código ya no sirve más.
  update public.peticiones_pin
    set estado = 'resuelto',
        codigo_hash = null,
        codigo_expira = null,
        reset_token = v_token,
        reset_expira = now() + interval '15 minutes'
    where id = v_p.id;
  return jsonb_build_object('estado', 'ok', 'token', v_token, 'nombre', split_part(coalesce(v_p.nombre, ''), ' ', 1));
end;
$$;
grant execute on function public.taxi_restablecer_pin_validar(text) to anon, authenticated;

-- ---------- Usuario: elegir el PIN nuevo --------------------------------------
-- Devuelve { estado: 'ok' | 'vencido' | 'no_existe' }.
create or replace function public.taxi_restablecer_pin_guardar(p_token uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_p public.peticiones_pin;
  v_u public.usuarios;
begin
  select * into v_p from public.peticiones_pin
  where reset_token = p_token and reset_expira > now();
  if not found then
    return jsonb_build_object('estado', 'vencido');
  end if;
  select * into v_u from public.usuarios where dni = v_p.dni limit 1;
  if v_u.id is null then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  perform public.taxi_guardar_pin(v_u.id, p_pin);
  update public.peticiones_pin set reset_token = null, reset_expira = null where id = v_p.id;
  return jsonb_build_object('estado', 'ok');
end;
$$;
grant execute on function public.taxi_restablecer_pin_guardar(uuid, text) to anon, authenticated;

-- ---------- Se cierra el camino viejo (PIN con solo el DNI) -------------------
create or replace function public.taxi_fijar_pin_recuperacion(p_peticion_id text, p_dni text, p_pin text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object('estado', 'usar_codigo');
$$;

notify pgrst, 'reload schema';
