-- =========================================================================
-- Seguridad, fase 2A: sesiones reales de Supabase (sin cambiar permisos).
--
-- Hasta ahora nadie tenía sesión ante la base: todo iba con la llave
-- pública (anon). Desde acá, al entrar, la base emite un TICKET de un
-- solo uso (2 minutos) y la Edge Function 'taxi-sesion' lo canjea por
-- una sesión normal de Supabase Auth: una cuenta interna por usuario
-- (mismo id que 'usuarios.id'; el Admin tiene la suya) con el rol en
-- app_metadata. La app guarda esa sesión y Supabase la renueva sola.
--
-- Esta fase NO cierra permisos: quien tiene sesión entra como
-- 'authenticated', así que se le dan los mismos permisos que hoy tiene
-- 'anon' (tablas, funciones, políticas y archivos), para que nada deje
-- de funcionar. La fase 2B cierra tabla por tabla con auth.uid() y el
-- rol de app_metadata.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Tickets de un solo uso ----------------------------------------
create table if not exists public.taxi_tickets (
  ticket     uuid primary key default gen_random_uuid(),
  usuario_id uuid references public.usuarios(id) on delete cascade,
  rol        text not null,
  expira_en  timestamptz not null default now() + interval '2 minutes'
);
alter table public.taxi_tickets enable row level security;
revoke all on public.taxi_tickets from anon, authenticated;

create or replace function public.taxi_emitir_ticket(p_usuario_id uuid, p_rol text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket uuid;
begin
  delete from public.taxi_tickets where expira_en < now();
  insert into public.taxi_tickets (usuario_id, rol) values (p_usuario_id, p_rol) returning ticket into v_ticket;
  return v_ticket;
end;
$$;

-- Solo para la Edge Function (service_role): canjea y borra el ticket.
create or replace function public.taxi_canjear_ticket(p_ticket uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_t public.taxi_tickets;
begin
  delete from public.taxi_tickets where ticket = p_ticket and expira_en > now() returning * into v_t;
  if v_t.ticket is null then
    return null;
  end if;
  if v_t.rol <> 'admin' and not exists (select 1 from public.usuarios where id = v_t.usuario_id) then
    return null;
  end if;
  return jsonb_build_object('usuario_id', v_t.usuario_id, 'rol', v_t.rol);
end;
$$;

-- ---------- Las funciones de entrada ahora devuelven también un ticket ----
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
  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u), 'ticket', public.taxi_emitir_ticket(v_u.id, v_u.rol));
end;
$$;

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
  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u), 'ticket', public.taxi_emitir_ticket(v_u.id, v_u.rol));
end;
$$;

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
  return jsonb_build_object('estado', 'ok', 'token', v_token, 'expira_en', v_expira, 'ticket', public.taxi_emitir_ticket(null, 'admin'));
end;
$$;

-- ---------- Registro exprés (pasajero / conductor temporal) ---------------
-- Antes la app insertaba la fila directo; ahora lo hace la base (así en
-- la fase 2B la llave pública ya no necesita insertar en 'usuarios') y
-- devuelve el ticket de la sesión.
create or replace function public.taxi_registrar_temporal(
  p_rol text,
  p_telefono text,
  p_nombre text default null,
  p_nombre_usuario text default null,
  p_expira_en timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_u public.usuarios;
begin
  if p_rol not in ('pasajero', 'conductor') then
    return jsonb_build_object('estado', 'rol_invalido');
  end if;
  if exists (
    select 1 from public.usuarios
    where telefono = trim(p_telefono) or (p_nombre_usuario is not null and nombre_usuario = p_nombre_usuario)
  ) then
    return jsonb_build_object('estado', 'duplicado');
  end if;

  -- (mismas columnas que insertaba la app en cada caso; el resto queda
  -- con su valor por defecto)
  if p_rol = 'pasajero' then
    insert into public.usuarios (nombre_usuario, telefono, pin, dni, rol, estado_verificacion, expira_en)
    values (p_nombre_usuario, trim(p_telefono), null, null, 'pasajero', 'temporal', coalesce(p_expira_en, now() + interval '7 days'))
    returning * into v_u;
  else
    insert into public.usuarios (nombre, telefono, pin, dni, rol, estado_cuenta, estado_verificacion, expira_en)
    values (p_nombre, trim(p_telefono), null, null, 'conductor', 'activo', 'temporal', coalesce(p_expira_en, now() + interval '7 days'))
    returning * into v_u;
  end if;

  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u), 'ticket', public.taxi_emitir_ticket(v_u.id, v_u.rol));
end;
$$;

-- ---------- Paso a sesión real de quien ya estaba dentro ------------------
-- Una sola vez, al abrir la app nueva: el Admin con un token válido, o
-- una cuenta SIN PIN todavía (registro exprés: no tiene con qué volver a
-- entrar). Quien tiene PIN vuelve a entrar con su PIN.
create or replace function public.taxi_ticket_admin(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.taxi_admin_token_valido(p_token) then
    return null;
  end if;
  return public.taxi_emitir_ticket(null, 'admin');
end;
$$;

create or replace function public.taxi_ticket_sin_pin(p_usuario_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
begin
  if exists (select 1 from public.usuarios_credenciales where usuario_id = p_usuario_id) then
    return null;
  end if;
  select rol into v_rol from public.usuarios where id = p_usuario_id;
  if v_rol is null then
    return null;
  end if;
  return public.taxi_emitir_ticket(p_usuario_id, v_rol);
end;
$$;

-- ---------- Borrar un usuario borra también su cuenta interna -------------
-- (si no, su sesión podría seguir renovándose).
create or replace function public.fn_usuarios_borrar_cuenta_auth()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  begin
    delete from auth.users where id = old.id;
  exception when others then
    raise warning 'No se pudo borrar la cuenta interna %: %', old.id, sqlerrm;
  end;
  return old;
end;
$$;

drop trigger if exists trg_usuarios_borrar_cuenta_auth on public.usuarios;
create trigger trg_usuarios_borrar_cuenta_auth
  after delete on public.usuarios
  for each row execute function public.fn_usuarios_borrar_cuenta_auth();

-- ---------- Permisos de ejecución -----------------------------------------
revoke execute on function
  public.taxi_emitir_ticket(uuid, text),
  public.taxi_canjear_ticket(uuid)
from public, anon, authenticated;
grant execute on function public.taxi_canjear_ticket(uuid) to service_role;

grant execute on function
  public.taxi_registrar_temporal(text, text, text, text, timestamptz),
  public.taxi_ticket_admin(uuid),
  public.taxi_ticket_sin_pin(uuid)
to anon, authenticated;

-- ---------- Paridad: 'authenticated' puede lo mismo que 'anon' hoy --------
-- (la fase 2B lo va cerrando tabla por tabla)
do $$
declare
  r record;
begin
  -- Tablas y vistas
  for r in
    select table_name, string_agg(privilege_type, ', ') as privs
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'
    group by table_name
  loop
    begin
      execute format('grant %s on public.%I to authenticated', r.privs, r.table_name);
    exception when others then
      raise notice 'tabla %: %', r.table_name, sqlerrm;
    end;
  end loop;

  -- Funciones
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
  loop
    begin
      execute format('grant execute on function %s to authenticated', r.fn);
    exception when others then
      raise notice 'función %: %', r.fn, sqlerrm;
    end;
  end loop;

  -- Políticas que solo nombran a anon (tablas y archivos)
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname in ('public', 'storage') and roles = array['anon']::name[]
  loop
    begin
      execute format('alter policy %I on %I.%I to anon, authenticated', r.policyname, r.schemaname, r.tablename);
    exception when others then
      raise notice 'política % en %.%: %', r.policyname, r.schemaname, r.tablename, sqlerrm;
    end;
  end loop;
end;
$$;
