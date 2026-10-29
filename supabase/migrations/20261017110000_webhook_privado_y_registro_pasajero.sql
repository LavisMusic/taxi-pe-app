-- =========================================================================
-- 1. Las funciones internas de los webhooks (fn_webhook_*) ya no se pueden
--    llamar desde la app. Estaban abiertas a anon y authenticated: con la
--    clave pública de la web cualquiera podía leer los secretos del Vault
--    (fn_webhook_secret: la clave que firma los avisos Taxi-PE -> Caja y
--    las URLs) o mandar avisos firmados a Caja (fn_webhook_emitir). Solo
--    las usan otras funciones de la base (security definer) y el cron de
--    reconciliación; service_role conserva el permiso (mirror-a-caja lee
--    la clave con él).
--
-- 2. Registro exprés del pasajero = el de cliente en Caja Tonazo: nombre,
--    celular y PIN. La cuenta nace 'permanente' (igual que las que llegan
--    desde Caja) y sin vencimiento; el PIN se copia a Caja desde la app.
--    Sin PIN (registros viejos) sigue siendo temporal como antes.
--
-- 3. peticiones_pin.restablecido_en: cuándo se eligió el PIN nuevo con el
--    código. mirror-a-caja solo pisa el PIN de una cuenta de Caja que ya
--    existe si hubo un restablecimiento en los últimos 10 minutos (así
--    nadie puede cambiar el PIN de Caja de otro con solo registrarse acá
--    con su número).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- 1. Webhooks privados ---------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as firma
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname like 'fn\_webhook\_%'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.firma);
    execute format('grant execute on function %s to service_role', r.firma);
  end loop;
end $$;

-- ---------- 2. Registro exprés del pasajero con nombre y PIN -----------------
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
  v_completo boolean := p_pin is not null and nullif(trim(p_nombre), '') is not null;
begin
  if p_rol not in ('pasajero', 'conductor', 'recolector') then
    return jsonb_build_object('estado', 'rol_invalido');
  end if;
  if p_pin is not null and p_pin !~ '^\d{6}$' then
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
      -- Como el registro de cliente de Caja: nombre + celular + PIN, cuenta
      -- permanente (el teléfono hace de nombre de usuario, igual que las
      -- cuentas que llegan desde Caja).
      insert into public.usuarios (nombre, nombre_usuario, telefono, pin, dni, rol, estado_verificacion, expira_en)
      values (trim(p_nombre), coalesce(p_nombre_usuario, trim(p_telefono)), trim(p_telefono), null, null,
              'pasajero', 'permanente', null)
      returning * into v_u;
    else
      insert into public.usuarios (nombre_usuario, telefono, pin, dni, rol, estado_verificacion, expira_en)
      values (p_nombre_usuario, trim(p_telefono), null, null, 'pasajero', 'temporal', coalesce(p_expira_en, now() + interval '7 days'))
      returning * into v_u;
    end if;
  elsif p_rol = 'conductor' then
    insert into public.usuarios (nombre, telefono, pin, dni, rol, estado_cuenta, estado_verificacion, expira_en)
    values (p_nombre, trim(p_telefono), null, null, 'conductor', 'activo', 'temporal', coalesce(p_expira_en, now() + interval '7 days'))
    returning * into v_u;
    -- Su fila de conductor (la membresía de bienvenida la pone su trigger).
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
    values (p_nombre, trim(p_telefono), null, null, 'recolector', 'activo', 'temporal',
            coalesce(p_expira_en, now() + interval '7 days'), v_creditos)
    returning * into v_u;
  end if;

  -- El PIN se guarda con la función de siempre (tabla privada).
  if p_pin is not null then
    perform public.taxi_guardar_pin(v_u.id, p_pin);
    select * into v_u from public.usuarios where id = v_u.id;
  end if;

  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u), 'ticket', public.taxi_emitir_ticket(v_u.id, v_u.rol));
end;
$$;
grant execute on function public.taxi_registrar_temporal(text, text, text, text, timestamptz, text, text) to anon, authenticated;

-- ---------- 3. Marca del restablecimiento del PIN ----------------------------
alter table public.peticiones_pin add column if not exists restablecido_en timestamptz;

create or replace function public.taxi_restablecer_pin_guardar(p_token uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_p  public.peticiones_pin;
  v_id uuid;
  v_u  public.usuarios;
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
  update public.peticiones_pin
    set reset_token = null, reset_expira = null, restablecido_en = now(), usuario_id = v_id
    where id = v_p.id;

  -- Sin bloqueo: puede entrar ya mismo con el PIN nuevo.
  select * into v_u from public.usuarios where id = v_id;
  if v_u.telefono is not null then
    delete from public.taxi_intentos where clave = 'login:' || v_u.telefono;
  end if;
  return jsonb_build_object(
    'estado', 'ok',
    'telefono', v_u.telefono,
    'rol', v_u.rol,
    'nombre', v_u.nombre
  );
end;
$$;
grant execute on function public.taxi_restablecer_pin_guardar(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
