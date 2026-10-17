-- =========================================================================
-- Seguridad, fase 2B — tanda 3a: tabla 'usuarios'.
--
--   * LEER: cada uno su propia fila; el Admin todas; el recolector además
--     las de los conductores (las necesita para recargar y registrar).
--     Sin sesión, nada. Para mostrar nombres a otros (ej. el conductor
--     viendo el nombre del pasajero en su bandeja) está la vista
--     'usuarios_publicos' (id, nombre, foto, rol: sin teléfono ni DNI).
--   * CREAR: solo el Admin directo. Los registros pasan por funciones de
--     la base: taxi_registrar_temporal (ya existía), taxi_registrar_
--     recolector, taxi_registrar_conductor_vinculado y taxi_crear_
--     conductor (Admin o recolector: crea la cuenta y su fila de
--     conductor juntas). "¿Ya existe una cuenta con ese DNI/teléfono?" se
--     pregunta con taxi_existe_cuenta (solo responde sí o no).
--   * CAMBIAR: cada uno su fila (datos personales), pero NO su rol, estado
--     de cuenta, créditos, membresía ni vencimiento (eso lo hacen el Admin
--     o la base). El Admin, todo.
--   * BORRAR: solo el Admin.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Políticas -------------------------------------------------------
select public.taxi_reiniciar_politicas('usuarios');
revoke all on public.usuarios from anon;

create policy usuarios_leer on public.usuarios for select to authenticated
  using (
    id = auth.uid()
    or public.taxi_es_admin()
    or (public.taxi_rol() = 'recolector' and rol = 'conductor')
  );
create policy usuarios_admin_crear on public.usuarios for insert to authenticated
  with check (public.taxi_es_admin());
create policy usuarios_cambiar on public.usuarios for update to authenticated
  using (id = auth.uid() or public.taxi_es_admin())
  with check (id = auth.uid() or public.taxi_es_admin());
create policy usuarios_admin_borrar on public.usuarios for delete to authenticated
  using (public.taxi_es_admin());

-- ---------- Columnas que el propio usuario no puede tocar -------------------
create or replace function public.fn_usuarios_columnas_protegidas()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.taxi_es_admin() then
    return new;
  end if;
  if new.rol is distinct from old.rol
     or new.estado_cuenta is distinct from old.estado_cuenta
     or new.creditos_disponibles is distinct from old.creditos_disponibles
     or new.membresia_vencimiento is distinct from old.membresia_vencimiento
     or new.expira_en is distinct from old.expira_en then
    raise exception 'Ese dato de la cuenta solo lo cambia el Admin.' using errcode = '42501';
  end if;
  -- Verificación: el propio usuario solo pasa de 'temporal' a 'en_revision'
  -- (mandó sus datos) o vuelve a 'temporal' si falló el envío.
  if new.estado_verificacion is distinct from old.estado_verificacion
     and not (old.estado_verificacion = 'temporal' and new.estado_verificacion = 'en_revision')
     and not (old.estado_verificacion = 'en_revision' and new.estado_verificacion = 'temporal') then
    raise exception 'La verificación de la cuenta solo la cambia el Admin.' using errcode = '42501';
  end if;
  -- El DNI se carga una vez (verificación); después solo el Admin.
  if old.dni is not null and new.dni is distinct from old.dni then
    raise exception 'El DNI solo lo cambia el Admin.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_usuarios_columnas_protegidas on public.usuarios;
create trigger trg_usuarios_columnas_protegidas
  before update on public.usuarios
  for each row execute function public.fn_usuarios_columnas_protegidas();

-- ---------- Vista pública (sin datos personales) ----------------------------
create or replace view public.usuarios_publicos as
  select id, nombre, foto_url, rol from public.usuarios;
grant select on public.usuarios_publicos to anon, authenticated;

-- ---------- ¿Existe una cuenta? (solo sí / no) -------------------------------
create or replace function public.taxi_existe_cuenta(
  p_dni text default null,
  p_telefono text default null,
  p_nombre_usuario text default null,
  p_excluir uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.usuarios
    where (p_excluir is null or id <> p_excluir)
      and (
        (nullif(trim(p_dni), '') is not null and dni = trim(p_dni))
        or (nullif(trim(p_telefono), '') is not null and telefono = trim(p_telefono))
        or (nullif(trim(p_nombre_usuario), '') is not null and nombre_usuario = trim(p_nombre_usuario))
      )
  );
$$;
grant execute on function public.taxi_existe_cuenta(text, text, text, uuid) to anon, authenticated;

-- ---------- Registro de recolector (pendiente de aprobación) ----------------
create or replace function public.taxi_registrar_recolector(p_nombre text, p_telefono text, p_dni text, p_foto_url text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_u public.usuarios;
begin
  if public.taxi_existe_cuenta(p_dni, p_telefono) then
    return jsonb_build_object('estado', 'duplicado');
  end if;
  insert into public.usuarios (dni, telefono, pin, nombre, rol, estado_cuenta, foto_url)
  values (trim(p_dni), trim(p_telefono), null, p_nombre, 'recolector', 'pendiente', p_foto_url)
  returning * into v_u;
  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u));
end;
$$;
grant execute on function public.taxi_registrar_recolector(text, text, text, text) to anon, authenticated;

-- ---------- Conductor que reclama su pre-registro (/registro-conductor) -----
-- Solo si un recolector/Admin ya lo cargó en 'conductores' con ese
-- teléfono y todavía no tiene cuenta. Crea la cuenta con su PIN y devuelve
-- el ticket de la sesión.
create or replace function public.taxi_registrar_conductor_vinculado(p_dni text, p_telefono text, p_nombre text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_u public.usuarios;
begin
  if not exists (select 1 from public.conductores where telefono = trim(p_telefono)) then
    return jsonb_build_object('estado', 'sin_preregistro');
  end if;
  if public.taxi_existe_cuenta(p_dni, p_telefono) then
    return jsonb_build_object('estado', 'duplicado');
  end if;
  insert into public.usuarios (dni, telefono, nombre, rol)
  values (trim(p_dni), trim(p_telefono), p_nombre, 'conductor')
  returning * into v_u;
  perform public.taxi_guardar_pin(v_u.id, p_pin);
  select * into v_u from public.usuarios where id = v_u.id;
  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u), 'ticket', public.taxi_emitir_ticket(v_u.id, v_u.rol));
end;
$$;
grant execute on function public.taxi_registrar_conductor_vinculado(text, text, text, text) to anon, authenticated;

-- ---------- Admin o recolector crean un conductor (cuenta + fila) ----------
-- p_conductor: los datos de la fila de 'conductores' (placa, localidad,
-- categoria_id, subgrupo_id, nivel_servicio, asientos_totales, fotos…).
-- Solo el Admin puede crearlo ya aprobado; el del recolector va a la cola
-- del Centro de Peticiones.
create or replace function public.taxi_crear_conductor(p_dni text, p_telefono text, p_nombre text, p_conductor jsonb, p_aprobado boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin    boolean := public.taxi_es_admin();
  v_aprobado boolean := public.taxi_es_admin() and coalesce(p_aprobado, false);
  v_u        public.usuarios;
  v_c        public.conductores;
  v_datos    public.conductores;
begin
  if not v_admin and coalesce(public.taxi_rol(), '') <> 'recolector' then
    return jsonb_build_object('estado', 'sin_permiso');
  end if;
  if public.taxi_existe_cuenta(p_dni, p_telefono) then
    return jsonb_build_object('estado', 'duplicado');
  end if;

  insert into public.usuarios (dni, telefono, pin, nombre, rol, estado_cuenta)
  values (trim(p_dni), trim(p_telefono), null, p_nombre, 'conductor', 'activo')
  returning * into v_u;

  v_datos := jsonb_populate_record(null::public.conductores, coalesce(p_conductor, '{}'::jsonb));
  insert into public.conductores (
    nombre, placa, telefono, dni, localidad, categoria_id, subgrupo_id, nivel_servicio, asientos_totales,
    foto_url, foto_general_url, foto_interior_url, foto_conductor_dni_url, aprobado, estado
  ) values (
    p_nombre, v_datos.placa, trim(p_telefono), trim(p_dni), v_datos.localidad, v_datos.categoria_id, v_datos.subgrupo_id,
    coalesce(v_datos.nivel_servicio, 'economico'), coalesce(nullif(v_datos.asientos_totales, 0), 4),
    v_datos.foto_url, v_datos.foto_general_url, v_datos.foto_interior_url, v_datos.foto_conductor_dni_url,
    v_aprobado, case when v_aprobado then 'desconectado' else null end
  )
  returning * into v_c;

  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u), 'conductor', to_jsonb(v_c));
end;
$$;
revoke execute on function public.taxi_crear_conductor(text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.taxi_crear_conductor(text, text, text, jsonb, boolean) to authenticated;
