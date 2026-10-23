-- =========================================================================
-- Registro exprés con PIN y localidad; el recolector recarga solo
-- aprobado; sin peticiones vacías.
--
--   * taxi_registrar_temporal recibe el PIN (y, el conductor, su
--     localidad): la cuenta temporal entra después como cualquiera, con
--     teléfono y PIN, sin tener que verificarse para volver a entrar.
--   * Un recolector no registra recargas hasta que el Admin aprueba su
--     cuenta (estado_verificacion 'permanente').
--   * Al borrar la cuenta de un conductor (también directo en la base), se
--     borra su fila de conductor si no estaba aprobado — antes quedaba
--     suelta y aparecía en Peticiones como una verificación vacía. Se
--     limpian las que ya quedaron sueltas.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Registro exprés con PIN y localidad ------------------------------
drop function if exists public.taxi_registrar_temporal(text, text, text, text, timestamptz);

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
    insert into public.usuarios (nombre_usuario, telefono, pin, dni, rol, estado_verificacion, expira_en)
    values (p_nombre_usuario, trim(p_telefono), null, null, 'pasajero', 'temporal', coalesce(p_expira_en, now() + interval '7 days'))
    returning * into v_u;
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

-- ---------- El recolector recarga solo aprobado ------------------------------
create or replace function public.fn_ventas_recolector_aprobado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.recolector_id is not null and exists (
    select 1 from public.usuarios
    where id = new.recolector_id and coalesce(estado_verificacion, 'permanente') <> 'permanente'
  ) then
    raise exception 'Tu cuenta de recolector debe estar aprobada por el Admin para registrar recargas.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ventas_recolector_aprobado on public.ventas;
create trigger trg_ventas_recolector_aprobado
  before insert on public.ventas
  for each row execute function public.fn_ventas_recolector_aprobado();

-- ---------- Sin filas de conductor sueltas -----------------------------------
create or replace function public.fn_usuarios_borrar_conductor_pendiente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.rol = 'conductor' and old.telefono is not null then
    delete from public.conductores where telefono = old.telefono and not coalesce(aprobado, false);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_usuarios_borrar_conductor_pendiente on public.usuarios;
create trigger trg_usuarios_borrar_conductor_pendiente
  after delete on public.usuarios
  for each row execute function public.fn_usuarios_borrar_conductor_pendiente();

-- Las que ya quedaron sueltas: sin aprobar, sin cuenta de conductor con ese
-- teléfono, y que vienen del registro exprés (placa vacía) o cuyo teléfono
-- ya es de otra cuenta (otro rol).
delete from public.conductores c
where not coalesce(c.aprobado, false)
  and not exists (select 1 from public.usuarios u where u.telefono = c.telefono and u.rol = 'conductor')
  and (coalesce(c.placa, '') = '' or exists (select 1 from public.usuarios u where u.telefono = c.telefono));
