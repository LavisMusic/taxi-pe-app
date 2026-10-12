-- =========================================================================
-- Registro exprés y verificación de cuenta también para recolectores.
--
--   * taxi_registrar_temporal acepta 'recolector' (solo nombre y teléfono,
--     como el conductor). Su cuenta queda 'pendiente': no puede usar la
--     app hasta verificarla y que el Admin la apruebe.
--   * La verificación de cuenta (conductor y recolector) va en UNA
--     operación de la base: taxi_crear_pin guarda el PIN y, además de
--     nombre/apellido/edad/sexo, el DNI (si no tenía; sin repetir el de
--     otra cuenta), la foto de perfil y el RUC (opcional, 11 dígitos).
--     Así funciona aunque la persona todavía no tenga sesión (primer
--     ingreso, sin PIN).
--   * usuarios.ruc (RUC opcional del recolector).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================
alter table public.usuarios add column if not exists ruc text;

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
  if p_rol not in ('pasajero', 'conductor', 'recolector') then
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
  elsif p_rol = 'conductor' then
    insert into public.usuarios (nombre, telefono, pin, dni, rol, estado_cuenta, estado_verificacion, expira_en)
    values (p_nombre, trim(p_telefono), null, null, 'conductor', 'activo', 'temporal', coalesce(p_expira_en, now() + interval '7 days'))
    returning * into v_u;
  else
    -- Recolector: no puede usar la app hasta verificar su cuenta y que el
    -- Admin la apruebe (estado_cuenta 'pendiente').
    insert into public.usuarios (nombre, telefono, pin, dni, rol, estado_cuenta, estado_verificacion, expira_en)
    values (p_nombre, trim(p_telefono), null, null, 'recolector', 'pendiente', 'temporal', coalesce(p_expira_en, now() + interval '7 days'))
    returning * into v_u;
  end if;

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
  if nullif(trim(p_datos ->> 'dni'), '') is not null
     and public.taxi_existe_cuenta(p_datos ->> 'dni', null, null, p_usuario_id) then
    return jsonb_build_object('estado', 'dni_duplicado');
  end if;
  if nullif(trim(p_datos ->> 'ruc'), '') is not null and trim(p_datos ->> 'ruc') !~ '^\d{11}$' then
    return jsonb_build_object('estado', 'ruc_invalido');
  end if;

  if p_datos is not null then
    update public.usuarios set
      nombre = coalesce(p_datos ->> 'nombre', nombre),
      apellido = coalesce(p_datos ->> 'apellido', apellido),
      edad = coalesce((p_datos ->> 'edad')::integer, edad),
      sexo = coalesce(p_datos ->> 'sexo', sexo),
      estado_verificacion = coalesce(p_datos ->> 'estado_verificacion', estado_verificacion),
      expira_en = case when p_datos ? 'expira_en' then (p_datos ->> 'expira_en')::timestamptz else expira_en end,
      dni = coalesce(dni, nullif(trim(p_datos ->> 'dni'), '')),
      foto_url = coalesce(nullif(p_datos ->> 'foto_url', ''), foto_url),
      ruc = case when p_datos ? 'ruc' then nullif(trim(p_datos ->> 'ruc'), '') else ruc end
    where id = p_usuario_id;
  end if;

  perform public.taxi_guardar_pin(p_usuario_id, p_pin);
  select * into v_u from public.usuarios where id = p_usuario_id;
  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u), 'ticket', public.taxi_emitir_ticket(v_u.id, v_u.rol));
end;
$$;

-- Ya no se usa: el recolector se registra con taxi_registrar_temporal y
-- verifica su cuenta con taxi_crear_pin.
drop function if exists public.taxi_registrar_recolector(text, text, text, text);
