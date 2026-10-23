-- =========================================================================
-- "Olvidé mi PIN" por teléfono.
--
-- Antes la petición se armaba con Nombre + DNI (+ Placa) escritos a mano:
-- no traía teléfono (el Admin no podía mandar el WhatsApp con el código
-- si el DNI no coincidía con una cuenta) y los pasajeros no tienen DNI.
--
-- Ahora la persona solo da su celular (el mismo del login) y
-- taxi_pedir_cambio_pin busca la cuenta y arma la petición con sus datos
-- reales: nombre, tipo, DNI y placa si tiene, teléfono y usuario_id.
--   * Número sin cuenta → 'no_existe' (la app lo dice claro). Para que no
--     sirva para averiguar qué números están registrados: 5 consultas
--     fallidas por dispositivo → 15 minutos de bloqueo.
--   * Las cuentas de admin no se recuperan por acá.
--   * Ya no se puede insertar directo en la tabla (solo por la función):
--     nadie llena el Centro de Peticiones con datos inventados.
-- El código y el PIN nuevo se aplican a usuario_id (antes, por DNI).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.peticiones_pin
  add column if not exists telefono   text,
  add column if not exists usuario_id uuid references public.usuarios(id) on delete cascade;
alter table public.peticiones_pin alter column dni drop not null;

-- Peticiones abiertas de antes: se completan buscando la cuenta por DNI.
update public.peticiones_pin p
  set usuario_id = u.id, telefono = u.telefono
  from public.usuarios u
  where p.usuario_id is null and p.estado <> 'resuelto' and p.dni is not null and u.dni = p.dni;

-- Solo se crean por taxi_pedir_cambio_pin.
drop policy if exists peticiones_pin_crear on public.peticiones_pin;
revoke insert on public.peticiones_pin from anon;

-- ---------- Público: pedir el cambio de PIN ----------------------------------
-- Devuelve { estado: 'enviada' | 'pendiente' | 'codigo_enviado' |
--            'no_existe' | 'invalido' | 'bloqueado' }.
create or replace function public.taxi_pedir_cambio_pin(p_telefono text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clave text := public.taxi_clave_dispositivo('pedir-pin');
  v_tel   text := regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g');
  v_u     public.usuarios;
  v_placa text;
  v_abierta public.peticiones_pin;
begin
  if public.taxi_intento_bloqueado(v_clave) then
    return jsonb_build_object('estado', 'bloqueado');
  end if;
  if v_tel !~ '^9\d{8}$' then
    return jsonb_build_object('estado', 'invalido');
  end if;

  select * into v_u from public.usuarios
  where telefono = v_tel and rol in ('pasajero', 'conductor', 'recolector')
  order by created_at
  limit 1;
  if v_u.id is null then
    perform public.taxi_intento_registrar(v_clave, false, 5);
    if public.taxi_intento_bloqueado(v_clave) then
      return jsonb_build_object('estado', 'bloqueado');
    end if;
    return jsonb_build_object('estado', 'no_existe');
  end if;

  -- Ya tiene una petición abierta: no se duplica.
  select * into v_abierta from public.peticiones_pin
  where usuario_id = v_u.id and estado <> 'resuelto'
  order by created_at desc
  limit 1;
  if v_abierta.id is not null then
    if v_abierta.estado = 'codigo_enviado' and v_abierta.codigo_expira > now() then
      return jsonb_build_object('estado', 'codigo_enviado');
    end if;
    return jsonb_build_object('estado', 'pendiente');
  end if;

  if v_u.rol = 'conductor' then
    select placa into v_placa from public.conductores where telefono = v_tel limit 1;
  end if;

  insert into public.peticiones_pin (nombre, dni, placa, tipo_usuario, estado, telefono, usuario_id)
  values (
    coalesce(
      nullif(trim(concat_ws(' ', v_u.nombre, v_u.apellido)), ''),
      v_u.nombre_usuario,
      'Sin nombre'
    ),
    v_u.dni,
    v_placa,
    v_u.rol,
    'pendiente',
    v_tel,
    v_u.id
  );
  return jsonb_build_object('estado', 'enviada');
end;
$$;
revoke execute on function public.taxi_pedir_cambio_pin(text) from public;
grant execute on function public.taxi_pedir_cambio_pin(text) to anon, authenticated;

-- ---------- Admin: el código va al teléfono de la petición -------------------
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

  v_tel := coalesce(
    v_p.telefono,
    (select telefono from public.usuarios where id = v_p.usuario_id),
    (select telefono from public.usuarios where dni = v_p.dni limit 1)
  );
  if v_tel is null then
    return jsonb_build_object('estado', 'sin_telefono');
  end if;

  v_codigo := public.taxi_codigo_legible();
  update public.peticiones_pin
    set codigo_hash = crypt(v_codigo, gen_salt('bf')),
        codigo_expira = v_expira,
        reset_token = null,
        reset_expira = null,
        estado = 'codigo_enviado'
    where id = v_p.id;

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

-- ---------- Usuario: el PIN nuevo va a la cuenta de la petición --------------
create or replace function public.taxi_restablecer_pin_guardar(p_token uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_p  public.peticiones_pin;
  v_id uuid;
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
  return jsonb_build_object('estado', 'ok');
end;
$$;
grant execute on function public.taxi_restablecer_pin_guardar(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
