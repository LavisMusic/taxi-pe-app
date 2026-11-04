-- =========================================================================
-- Códigos de activación y registro exprés con PIN obligatorio
-- (revisión de seguridad 2026-11-04, P0 #2).
--
--   * taxi_crear_pin ponía el primer PIN a CUALQUIER cuenta sin PIN con
--     solo conocer su id (que es público) y abría la sesión; además dejaba
--     que el navegador eligiera estado_verificacion y expira_en. Ahora
--     exige un código de activación de un solo uso (48 h, 5 intentos) que
--     genera el Admin o el recolector, y la verificación la decide la base.
--   * taxi_registrar_temporal exige el PIN (ya no nacen cuentas sin PIN) y
--     el vencimiento de la cuenta temporal lo pone la base (7 días), no el
--     navegador.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Códigos (solo los usan las funciones de acá) ---------------------
create table if not exists public.taxi_codigos_activacion (
  usuario_id  uuid primary key references public.usuarios(id) on delete cascade,
  codigo_hash text not null,
  expira_en   timestamptz not null,
  intentos    integer not null default 0,
  creado_por  uuid,
  created_at  timestamptz not null default now()
);
alter table public.taxi_codigos_activacion enable row level security;
revoke all on public.taxi_codigos_activacion from anon, authenticated;

-- "k7q-29m" → "K7Q29M"
create or replace function public.taxi_normalizar_codigo(p_codigo text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p_codigo, ''), '[^0-9A-Za-z]', '', 'g'));
$$;

-- ---------- Generar un código ---------------------------------------------
-- Admin: cualquier cuenta sin PIN (que no sea admin).
-- Recolector: conductores sin PIN.
-- Devuelve el código en claro UNA sola vez ('K7Q-29M').
create or replace function public.taxi_generar_codigo(p_usuario_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_alfabeto constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_rol      text;
  v_bytes    bytea;
  v_codigo   text := '';
  i          integer;
begin
  select rol into v_rol from public.usuarios where id = p_usuario_id;
  if v_rol is null then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  if not (
    (public.taxi_es_admin() and v_rol <> 'admin')
    or (public.taxi_rol() = 'recolector' and v_rol = 'conductor')
  ) then
    return jsonb_build_object('estado', 'sin_permiso');
  end if;
  if exists (select 1 from public.usuarios_credenciales where usuario_id = p_usuario_id) then
    return jsonb_build_object('estado', 'ya_tiene_pin');
  end if;

  v_bytes := gen_random_bytes(6);
  for i in 0..5 loop
    v_codigo := v_codigo || substr(v_alfabeto, (get_byte(v_bytes, i) % length(v_alfabeto)) + 1, 1);
  end loop;

  insert into public.taxi_codigos_activacion (usuario_id, codigo_hash, expira_en, intentos, creado_por, created_at)
  values (p_usuario_id, encode(digest(p_usuario_id::text || ':' || v_codigo, 'sha256'), 'hex'),
          now() + interval '48 hours', 0, auth.uid(), now())
  on conflict (usuario_id) do update
    set codigo_hash = excluded.codigo_hash, expira_en = excluded.expira_en, intentos = 0,
        creado_por = excluded.creado_por, created_at = excluded.created_at;

  return jsonb_build_object('estado', 'ok', 'codigo', substr(v_codigo, 1, 3) || '-' || substr(v_codigo, 4, 3));
end;
$$;
revoke execute on function public.taxi_generar_codigo(uuid) from public, anon;
grant execute on function public.taxi_generar_codigo(uuid) to authenticated;

-- ---------- PIN escrito por la persona al crear su cuenta ---------------------
-- El Admin o el recolector crean la cuenta y le pasan el celular a la
-- persona, que escribe su PIN en un teclado privado. Mismos permisos que
-- taxi_generar_codigo. A diferencia de taxi_crear_pin NO abre sesión:
-- quien crea la cuenta nunca recibe una entrada a ella.
create or replace function public.taxi_fijar_pin_alta(p_usuario_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rol text;
begin
  select rol into v_rol from public.usuarios where id = p_usuario_id;
  if v_rol is null then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  if not (
    (public.taxi_es_admin() and v_rol <> 'admin')
    or (public.taxi_rol() = 'recolector' and v_rol = 'conductor')
  ) then
    return jsonb_build_object('estado', 'sin_permiso');
  end if;
  if exists (select 1 from public.usuarios_credenciales where usuario_id = p_usuario_id) then
    return jsonb_build_object('estado', 'ya_tiene_pin');
  end if;
  if p_pin is null or p_pin !~ '^\d{6}$' then
    return jsonb_build_object('estado', 'pin_invalido');
  end if;
  perform public.taxi_guardar_pin(p_usuario_id, p_pin);
  delete from public.taxi_codigos_activacion where usuario_id = p_usuario_id;
  return jsonb_build_object('estado', 'ok');
end;
$$;
revoke execute on function public.taxi_fijar_pin_alta(uuid, text) from public, anon;
grant execute on function public.taxi_fijar_pin_alta(uuid, text) to authenticated;

-- ---------- Primer PIN: ahora con código ------------------------------------
drop function if exists public.taxi_crear_pin(uuid, text, jsonb);

create or replace function public.taxi_crear_pin(
  p_usuario_id uuid,
  p_pin text,
  p_datos jsonb default null,
  p_codigo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_u        public.usuarios;
  v_cod      public.taxi_codigos_activacion;
  v_estado   text;
begin
  if exists (select 1 from public.usuarios_credenciales where usuario_id = p_usuario_id) then
    return jsonb_build_object('estado', 'ya_tiene_pin');
  end if;
  select * into v_u from public.usuarios where id = p_usuario_id;
  if v_u.id is null then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  if p_pin is null or p_pin !~ '^\d{6}$' then
    return jsonb_build_object('estado', 'pin_invalido');
  end if;
  -- Antes de gastar el código: que los datos sean válidos.
  if nullif(trim(p_datos ->> 'dni'), '') is not null
     and public.taxi_existe_cuenta(p_datos ->> 'dni', null, null, p_usuario_id) then
    return jsonb_build_object('estado', 'dni_duplicado');
  end if;
  if nullif(trim(p_datos ->> 'ruc'), '') is not null and trim(p_datos ->> 'ruc') !~ '^\d{11}$' then
    return jsonb_build_object('estado', 'ruc_invalido');
  end if;

  -- Código de activación de un solo uso.
  select * into v_cod from public.taxi_codigos_activacion where usuario_id = p_usuario_id for update;
  if v_cod.usuario_id is null then
    return jsonb_build_object('estado', 'requiere_codigo');
  end if;
  if v_cod.expira_en < now() then
    return jsonb_build_object('estado', 'codigo_vencido');
  end if;
  if v_cod.intentos >= 5 then
    return jsonb_build_object('estado', 'codigo_bloqueado');
  end if;
  if encode(digest(p_usuario_id::text || ':' || public.taxi_normalizar_codigo(p_codigo), 'sha256'), 'hex')
     is distinct from v_cod.codigo_hash then
    update public.taxi_codigos_activacion set intentos = intentos + 1 where usuario_id = p_usuario_id;
    return jsonb_build_object('estado', case when v_cod.intentos + 1 >= 5 then 'codigo_bloqueado' else 'codigo_invalido' end);
  end if;
  delete from public.taxi_codigos_activacion where usuario_id = p_usuario_id;

  if p_datos is not null then
    -- La verificación la decide la base: un pasajero que completa sus
    -- datos queda permanente; conductor y recolector quedan "en revisión"
    -- hasta que el Admin los apruebe. El vencimiento no lo toca el
    -- navegador (solo se quita al quedar permanente).
    v_estado := case
      when p_datos ? 'estado_verificacion' and v_u.rol = 'pasajero' then 'permanente'
      when p_datos ? 'estado_verificacion' then 'en_revision'
      else v_u.estado_verificacion
    end;
    update public.usuarios set
      nombre = coalesce(p_datos ->> 'nombre', nombre),
      apellido = coalesce(p_datos ->> 'apellido', apellido),
      edad = coalesce((p_datos ->> 'edad')::integer, edad),
      sexo = coalesce(p_datos ->> 'sexo', sexo),
      estado_verificacion = v_estado,
      expira_en = case when v_estado = 'permanente' then null else expira_en end,
      dni = coalesce(dni, nullif(trim(p_datos ->> 'dni'), '')),
      foto_url = coalesce(nullif(p_datos ->> 'foto_url', ''), foto_url),
      foto_dni_url = coalesce(nullif(p_datos ->> 'foto_dni_url', ''), foto_dni_url),
      ruc = case when p_datos ? 'ruc' then nullif(trim(p_datos ->> 'ruc'), '') else ruc end
    where id = p_usuario_id;
  end if;

  perform public.taxi_guardar_pin(p_usuario_id, p_pin);
  select * into v_u from public.usuarios where id = p_usuario_id;
  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u), 'ticket', public.taxi_emitir_ticket(v_u.id, v_u.rol));
end;
$$;
grant execute on function public.taxi_crear_pin(uuid, text, jsonb, text) to anon, authenticated;

-- ---------- Registro exprés: PIN obligatorio y vencimiento de la base --------
-- Misma función que 20261017110000, con dos cambios: sin PIN no se crea la
-- cuenta, y p_expira_en se ignora (7 días, lo decide la base).
create or replace function public.taxi_registrar_temporal(
  p_rol text,
  p_telefono text,
  p_nombre text default null,
  p_nombre_usuario text default null,
  p_expira_en timestamptz default null,
  p_pin text default null,
  p_localidad text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_u public.usuarios;
  v_creditos integer := 0;
  v_completo boolean := nullif(trim(p_nombre), '') is not null;
  v_vence timestamptz := now() + interval '7 days';
begin
  if p_rol not in ('pasajero', 'conductor', 'recolector') then
    return jsonb_build_object('estado', 'rol_invalido');
  end if;
  if p_pin is null or p_pin !~ '^\d{6}$' then
    return jsonb_build_object('estado', 'pin_invalido');
  end if;
  if exists (
    select 1 from public.usuarios
    where telefono = trim(p_telefono) or (p_nombre_usuario is not null and nombre_usuario = p_nombre_usuario)
  ) then
    return jsonb_build_object('estado', 'duplicado');
  end if;

  if p_rol = 'pasajero' then
    if v_completo then
      insert into public.usuarios (nombre, nombre_usuario, telefono, pin, dni, rol, estado_verificacion, expira_en)
      values (trim(p_nombre), coalesce(p_nombre_usuario, trim(p_telefono)), trim(p_telefono), null, null,
              'pasajero', 'permanente', null)
      returning * into v_u;
    else
      insert into public.usuarios (nombre_usuario, telefono, pin, dni, rol, estado_verificacion, expira_en)
      values (p_nombre_usuario, trim(p_telefono), null, null, 'pasajero', 'temporal', v_vence)
      returning * into v_u;
    end if;
  elsif p_rol = 'conductor' then
    insert into public.usuarios (nombre, telefono, pin, dni, rol, estado_cuenta, estado_verificacion, expira_en)
    values (p_nombre, trim(p_telefono), null, null, 'conductor', 'activo', 'temporal', v_vence)
    returning * into v_u;
    if not exists (select 1 from public.conductores where telefono = trim(p_telefono)) then
      insert into public.conductores (nombre, placa, telefono, localidad, aprobado, estado, nivel_servicio)
      values (p_nombre, '', trim(p_telefono), nullif(trim(p_localidad), ''), false, 'desconectado', 'economico');
    end if;
  else
    if not public.taxi_ya_tuvo_bienvenida('recolector', p_telefono, null) then
      v_creditos := 50;
      insert into public.taxi_bienvenidas (rol, telefono) values ('recolector', trim(p_telefono));
    end if;
    insert into public.usuarios (nombre, telefono, pin, dni, rol, estado_cuenta, estado_verificacion, expira_en, creditos_disponibles)
    values (p_nombre, trim(p_telefono), null, null, 'recolector', 'activo', 'temporal', v_vence, v_creditos)
    returning * into v_u;
  end if;

  perform public.taxi_guardar_pin(v_u.id, p_pin);
  select * into v_u from public.usuarios where id = v_u.id;

  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u), 'ticket', public.taxi_emitir_ticket(v_u.id, v_u.rol));
end;
$$;
grant execute on function public.taxi_registrar_temporal(text, text, text, text, timestamptz, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
