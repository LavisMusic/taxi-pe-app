-- =========================================================================
-- Seguridad, fase 1: PIN privado + código del Admin fuera de la app.
--
-- Antes: cualquiera con la llave pública (anon) podía leer la tabla
-- 'usuarios' con el hash del PIN de todos (un PIN de 6 dígitos se adivina
-- por fuerza bruta en minutos teniendo el hash) y cambiar el PIN de
-- cualquier cuenta. El código maestro del Admin estaba escrito en el
-- JavaScript de la app.
--
-- Ahora:
--   * Los hashes viven en 'usuarios_credenciales', sin acceso para
--     anon/authenticated. 'usuarios.pin' queda solo como marca
--     ('protegido' = tiene PIN, null = todavía no), así el resto de la
--     app y Realtime siguen igual sin exponer nada.
--   * anon/authenticated NO pueden escribir 'usuarios.pin' (trigger). El
--     PIN se crea, comprueba y cambia solo por las funciones de abajo,
--     que corren en la base (security definer).
--   * Máximo 5 intentos fallidos cada 15 min por teléfono (y 10 para el
--     código del Admin).
--   * El código del Admin se guarda cifrado en 'taxi_admin_config'; al
--     entrar se entrega un token de sesión ('taxi_admin_sesiones') que
--     piden las funciones de Admin (fijar PIN, verificar petición).
--   * Una petición de recuperación de PIN solo la marca 'verificado' el
--     Admin (con su token); antes cualquiera podía marcarla y luego fijar
--     el PIN de otra persona.
--
-- DESPUÉS DE CORRER ESTO hay que fijar el código nuevo del Admin (el
-- anterior ya es público). En el SQL Editor, como postgres:
--   select public.taxi_admin_cambiar_codigo('TU-CODIGO-NUEVO');
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Tablas privadas ----------------------------------------------
create table if not exists public.usuarios_credenciales (
  usuario_id     uuid primary key references public.usuarios(id) on delete cascade deferrable initially deferred,
  pin_hash       text not null,
  actualizado_en timestamptz not null default now()
);

create table if not exists public.taxi_intentos (
  clave          text primary key,
  fallidos       integer not null default 0,
  bloqueado_hasta timestamptz,
  actualizado_en timestamptz not null default now()
);

create table if not exists public.taxi_admin_config (
  id          boolean primary key default true check (id),
  codigo_hash text not null,
  actualizado_en timestamptz not null default now()
);

create table if not exists public.taxi_admin_sesiones (
  token     uuid primary key default gen_random_uuid(),
  creada_en timestamptz not null default now(),
  expira_en timestamptz not null
);

alter table public.usuarios_credenciales enable row level security;
alter table public.taxi_intentos enable row level security;
alter table public.taxi_admin_config enable row level security;
alter table public.taxi_admin_sesiones enable row level security;
revoke all on public.usuarios_credenciales, public.taxi_intentos, public.taxi_admin_config, public.taxi_admin_sesiones from anon, authenticated;

-- ---------- 'usuarios.pin' solo como marca --------------------------------
-- Quien no es anon/authenticated (la base misma: migraciones, funciones
-- security definer como el espejo de Caja, service_role) puede seguir
-- escribiendo un hash en 'pin': el trigger lo guarda en
-- 'usuarios_credenciales' y deja la marca. anon/authenticated no pueden
-- tocar 'pin' en absoluto.
-- (security invoker a propósito: así current_user es quien hace el
-- cambio — anon desde la app, postgres desde las funciones de abajo.)
create or replace function public.fn_usuarios_pin_privado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if (tg_op = 'INSERT' and new.pin is not null)
       or (tg_op = 'UPDATE' and new.pin is distinct from old.pin) then
      raise exception 'El PIN solo se cambia con las funciones de la app (taxi_crear_pin, taxi_admin_fijar_pin…).'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.pin is null then
    if tg_op = 'UPDATE' and old.pin is not null then
      delete from public.usuarios_credenciales where usuario_id = new.id;
    end if;
  elsif new.pin <> 'protegido' then
    insert into public.usuarios_credenciales (usuario_id, pin_hash, actualizado_en)
    values (new.id, new.pin, now())
    on conflict (usuario_id) do update set pin_hash = excluded.pin_hash, actualizado_en = now();
    new.pin := 'protegido';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_usuarios_pin_privado on public.usuarios;
create trigger trg_usuarios_pin_privado
  before insert or update of pin on public.usuarios
  for each row execute function public.fn_usuarios_pin_privado();

-- Pasa los hashes que ya existen a la tabla privada (el trigger hace el
-- trabajo: esta migración corre como postgres).
update public.usuarios set pin = pin where pin is not null and pin <> 'protegido';

-- ---------- Ayudantes internos (sin permiso para anon) --------------------
-- Límite de intentos: true si la clave está bloqueada ahora.
create or replace function public.taxi_intento_bloqueado(p_clave text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select bloqueado_hasta > now() from public.taxi_intentos where clave = p_clave), false);
$$;

create or replace function public.taxi_intento_registrar(p_clave text, p_ok boolean, p_max integer default 5)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ok then
    delete from public.taxi_intentos where clave = p_clave;
    return;
  end if;
  insert into public.taxi_intentos as t (clave, fallidos, actualizado_en)
  values (p_clave, 1, now())
  on conflict (clave) do update
    set fallidos = case when t.actualizado_en < now() - interval '15 minutes' then 1 else t.fallidos + 1 end,
        actualizado_en = now();
  update public.taxi_intentos
    set bloqueado_hasta = now() + interval '15 minutes', fallidos = 0
    where clave = p_clave and fallidos >= p_max;
end;
$$;

create or replace function public.taxi_guardar_pin(p_usuario_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_pin !~ '^\d{6}$' then
    raise exception 'El PIN debe tener 6 dígitos.' using errcode = '22023';
  end if;
  update public.usuarios set pin = crypt(p_pin, gen_salt('bf')) where id = p_usuario_id;
end;
$$;

create or replace function public.taxi_admin_token_valido(p_token uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.taxi_admin_sesiones where token = p_token and expira_en > now());
$$;

-- ---------- Funciones públicas: PIN ---------------------------------------
-- Inicio de sesión por teléfono + PIN. estado: 'ok' | 'sin_pin' (la
-- cuenta todavía no tiene PIN: la app pide crearlo) | 'incorrecto' |
-- 'bloqueado'. 'usuario' es la fila sin hash ('pin' = marca).
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
  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u));
end;
$$;

-- Primer PIN de una cuenta que nació sin uno (alta del Admin, registro
-- exprés, conductor que se registra solo). Si la cuenta YA tiene PIN no
-- hace nada: cambiar un PIN existente es solo por recuperación o Admin.
-- Opcional: datos de verificación del pasajero (nombre, apellido…).
create or replace function public.taxi_crear_pin(p_usuario_id uuid, p_pin text, p_datos jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_u public.usuarios;
begin
  if exists (select 1 from public.usuarios_credenciales where usuario_id = p_usuario_id) then
    return jsonb_build_object('estado', 'ya_tiene_pin');
  end if;
  if not exists (select 1 from public.usuarios where id = p_usuario_id) then
    return jsonb_build_object('estado', 'no_existe');
  end if;

  if p_datos is not null then
    update public.usuarios set
      nombre = coalesce(p_datos ->> 'nombre', nombre),
      apellido = coalesce(p_datos ->> 'apellido', apellido),
      edad = coalesce((p_datos ->> 'edad')::integer, edad),
      sexo = coalesce(p_datos ->> 'sexo', sexo),
      estado_verificacion = coalesce(p_datos ->> 'estado_verificacion', estado_verificacion),
      expira_en = case when p_datos ? 'expira_en' then (p_datos ->> 'expira_en')::timestamptz else expira_en end
    where id = p_usuario_id;
  end if;

  perform public.taxi_guardar_pin(p_usuario_id, p_pin);
  select * into v_u from public.usuarios where id = p_usuario_id;
  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u));
end;
$$;

-- Paso 2 de /recuperar-pin: solo si el Admin ya marcó la petición como
-- 'verificado' y el DNI coincide. Cierra la petición.
create or replace function public.taxi_fijar_pin_recuperacion(p_peticion_id text, p_dni text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_u public.usuarios;
begin
  if not exists (
    select 1 from public.peticiones_pin
    where id::text = p_peticion_id and dni = trim(p_dni) and estado = 'verificado'
  ) then
    return jsonb_build_object('estado', 'no_verificado');
  end if;

  select * into v_u from public.usuarios where dni = trim(p_dni) limit 1;
  if v_u.id is null then
    return jsonb_build_object('estado', 'no_existe');
  end if;

  perform public.taxi_guardar_pin(v_u.id, p_pin);
  update public.peticiones_pin set estado = 'resuelto' where id::text = p_peticion_id;
  select * into v_u from public.usuarios where id = v_u.id;
  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u));
end;
$$;

-- Para el servidor (Edge Function mirror-a-caja, service_role): ¿el PIN
-- coincide con el de esta cuenta?
create or replace function public.taxi_pin_correcto(p_telefono text, p_rol text, p_pin text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select coalesce((
    select crypt(p_pin, c.pin_hash) = c.pin_hash
    from public.usuarios u join public.usuarios_credenciales c on c.usuario_id = u.id
    where u.telefono = trim(p_telefono) and u.rol = p_rol
    limit 1
  ), false);
$$;

-- ---------- Funciones públicas: Admin -------------------------------------
create or replace function public.taxi_admin_login(p_codigo text, p_recordar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash  text;
  v_token uuid;
  v_expira timestamptz := now() + case when p_recordar then interval '30 days' else interval '12 hours' end;
begin
  if public.taxi_intento_bloqueado('admin') then
    return jsonb_build_object('estado', 'bloqueado');
  end if;
  select codigo_hash into v_hash from public.taxi_admin_config where id;
  if v_hash is null then
    return jsonb_build_object('estado', 'sin_configurar');
  end if;
  if crypt(coalesce(p_codigo, ''), v_hash) <> v_hash then
    perform public.taxi_intento_registrar('admin', false, 10);
    return jsonb_build_object('estado', 'incorrecto');
  end if;

  perform public.taxi_intento_registrar('admin', true);
  delete from public.taxi_admin_sesiones where expira_en < now();
  insert into public.taxi_admin_sesiones (expira_en) values (v_expira) returning token into v_token;
  return jsonb_build_object('estado', 'ok', 'token', v_token, 'expira_en', v_expira);
end;
$$;

create or replace function public.taxi_admin_sesion_valida(p_token uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.taxi_admin_token_valido(p_token);
$$;

create or replace function public.taxi_admin_salir(p_token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.taxi_admin_sesiones where token = p_token;
$$;

-- El Admin sobrescribe el PIN de alguien (formulario de edición).
create or replace function public.taxi_admin_fijar_pin(p_token uuid, p_usuario_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.taxi_admin_token_valido(p_token) then
    return jsonb_build_object('estado', 'sin_sesion');
  end if;
  perform public.taxi_guardar_pin(p_usuario_id, p_pin);
  return jsonb_build_object('estado', 'ok');
end;
$$;

-- El Admin confirma por WhatsApp que la petición de PIN es real.
create or replace function public.taxi_admin_verificar_peticion(p_token uuid, p_peticion_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.taxi_admin_token_valido(p_token) then
    return jsonb_build_object('estado', 'sin_sesion');
  end if;
  update public.peticiones_pin set estado = 'verificado' where id::text = p_peticion_id;
  return jsonb_build_object('estado', 'ok');
end;
$$;

-- Solo desde el SQL Editor (no tiene permiso para anon): fija o cambia el
-- código del Admin y cierra todas las sesiones de Admin abiertas.
create or replace function public.taxi_admin_cambiar_codigo(p_codigo text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(p_codigo, '')) < 8 then
    raise exception 'Usa un código de al menos 8 caracteres.';
  end if;
  insert into public.taxi_admin_config (id, codigo_hash, actualizado_en)
  values (true, crypt(p_codigo, gen_salt('bf')), now())
  on conflict (id) do update set codigo_hash = excluded.codigo_hash, actualizado_en = now();
  delete from public.taxi_admin_sesiones;
end;
$$;

-- ---------- Peticiones de PIN: 'verificado' solo lo pone el Admin ---------
create or replace function public.fn_peticiones_pin_verificado()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('anon', 'authenticated') and new.estado = 'verificado'
     and (tg_op = 'INSERT' or old.estado is distinct from 'verificado') then
    raise exception 'Solo el Admin puede verificar una petición de PIN.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_peticiones_pin_verificado on public.peticiones_pin;
create trigger trg_peticiones_pin_verificado
  before insert or update of estado on public.peticiones_pin
  for each row execute function public.fn_peticiones_pin_verificado();

-- ---------- Permisos de ejecución -----------------------------------------
revoke execute on function
  public.taxi_intento_bloqueado(text),
  public.taxi_intento_registrar(text, boolean, integer),
  public.taxi_guardar_pin(uuid, text),
  public.taxi_admin_token_valido(uuid),
  public.taxi_pin_correcto(text, text, text),
  public.taxi_admin_cambiar_codigo(text)
from public, anon, authenticated;

grant execute on function
  public.taxi_login(text, text, text[]),
  public.taxi_crear_pin(uuid, text, jsonb),
  public.taxi_fijar_pin_recuperacion(text, text, text),
  public.taxi_admin_login(text, boolean),
  public.taxi_admin_sesion_valida(uuid),
  public.taxi_admin_salir(uuid),
  public.taxi_admin_fijar_pin(uuid, uuid, text),
  public.taxi_admin_verificar_peticion(uuid, text)
to anon, authenticated;

grant execute on function public.taxi_pin_correcto(text, text, text) to service_role;
