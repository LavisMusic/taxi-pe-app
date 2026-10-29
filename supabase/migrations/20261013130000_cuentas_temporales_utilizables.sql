-- =========================================================================
-- Cuentas temporales que se pueden usar desde el primer día.
--
-- CONDUCTOR (registro exprés: nombre + teléfono)
--   * Se le crea su fila de 'conductores' al registrarse, con 1 mes de
--     membresía gratis (30 días; antes 60, para todos los conductores
--     nuevos — los que todavía tienen los 60 días de regalo pasan a 30).
--   * Puede ponerse Activo y salir en el directorio y el radar sin estar
--     verificado; elige su vehículo (categoría) en su panel. Su nivel de
--     servicio queda en Económico hasta que el Admin lo apruebe.
--   * Al verificarse manda placa, DNI, asientos, localidad, subgrupo,
--     nivel de servicio que pide (nivel_servicio_solicitado: el Admin lo
--     confirma al aprobar), foto de perfil y las 3 fotos.
-- RECOLECTOR (registro exprés)
--   * Entra a la app de una (estado_cuenta 'activo') con 50 créditos de
--     bienvenida; verifica su cuenta dentro de los 7 días.
-- REGALO DE BIENVENIDA (membresía del conductor, créditos del recolector)
--   * Una sola vez por teléfono y DNI: taxi_bienvenidas. Si la cuenta se
--     borra a los 7 días y se vuelve a registrar, no lo recibe de nuevo.
-- Si no verifica en 7 días, se borra todo (cuenta, fila de conductor y
-- regalo); ahora cuenta por cuenta, para que una que no se pueda borrar
-- no frene a las demás.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Registro de regalos de bienvenida -------------------------------
create table if not exists public.taxi_bienvenidas (
  id         bigserial primary key,
  rol        text not null,
  telefono   text,
  dni        text,
  created_at timestamptz not null default now()
);
create index if not exists taxi_bienvenidas_telefono on public.taxi_bienvenidas (rol, telefono);
create index if not exists taxi_bienvenidas_dni on public.taxi_bienvenidas (rol, dni);
alter table public.taxi_bienvenidas enable row level security;
revoke all on public.taxi_bienvenidas from anon, authenticated;

create or replace function public.taxi_ya_tuvo_bienvenida(p_rol text, p_telefono text, p_dni text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.taxi_bienvenidas
    where rol = p_rol
      and ((nullif(trim(p_telefono), '') is not null and telefono = trim(p_telefono))
           or (nullif(trim(p_dni), '') is not null and dni = trim(p_dni)))
  );
$$;
revoke execute on function public.taxi_ya_tuvo_bienvenida(text, text, text) from public, anon, authenticated;

-- Los que ya existen cuentan como que ya lo recibieron.
insert into public.taxi_bienvenidas (rol, telefono, dni)
select 'conductor', c.telefono, c.dni from public.conductores c
where not public.taxi_ya_tuvo_bienvenida('conductor', c.telefono, c.dni);
insert into public.taxi_bienvenidas (rol, telefono, dni)
select 'recolector', u.telefono, u.dni from public.usuarios u
where u.rol = 'recolector' and not public.taxi_ya_tuvo_bienvenida('recolector', u.telefono, u.dni);

-- ---------- Membresía de bienvenida del conductor: 30 días, una vez ---------
create or replace function public.fn_membresia_gratis_conductor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.vencimiento_suscripcion is null
     and not public.taxi_ya_tuvo_bienvenida('conductor', new.telefono, new.dni) then
    new.vencimiento_suscripcion := now() + interval '30 days';
    insert into public.taxi_bienvenidas (rol, telefono, dni) values ('conductor', new.telefono, new.dni);
  end if;
  return new;
end;
$$;

-- Al cargar su DNI (verificación), queda anotado también por DNI.
create or replace function public.fn_conductores_bienvenida_dni()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.dni is not null and new.dni is distinct from old.dni then
    update public.taxi_bienvenidas set dni = new.dni
    where rol = 'conductor' and telefono = new.telefono and dni is null;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_conductores_bienvenida_dni on public.conductores;
create trigger trg_conductores_bienvenida_dni
  after update of dni on public.conductores
  for each row execute function public.fn_conductores_bienvenida_dni();

-- Los que todavía tienen el regalo de 60 días pasan a 30.
update public.conductores
  set vencimiento_suscripcion = created_at + interval '30 days'
  where membresia_paquete_id is null
    and vencimiento_suscripcion > now()
    and abs(extract(epoch from (vencimiento_suscripcion - (created_at + interval '60 days')))) < 120;

-- ---------- Nivel de servicio que pide el conductor ------------------------
alter table public.conductores add column if not exists nivel_servicio_solicitado text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conductores_nivel_solicitado_valido') then
    alter table public.conductores add constraint conductores_nivel_solicitado_valido
      check (nivel_servicio_solicitado is null or nivel_servicio_solicitado in ('economico', 'ejecutivo', 'premium', 'vip'));
  end if;
end $$;
grant select (nivel_servicio_solicitado) on public.conductores to anon, authenticated;

-- ---------- Registro exprés -------------------------------------------------
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
  v_creditos integer := 0;
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
      -- (placa vacía hasta que se verifique)
      insert into public.conductores (nombre, placa, telefono, aprobado, estado, nivel_servicio)
      values (p_nombre, '', trim(p_telefono), false, 'desconectado', 'economico');
    end if;
  else
    -- Recolector: entra de una con sus créditos de bienvenida (una vez).
    if not public.taxi_ya_tuvo_bienvenida('recolector', p_telefono, null) then
      v_creditos := 50;
      insert into public.taxi_bienvenidas (rol, telefono) values ('recolector', trim(p_telefono));
    end if;
    insert into public.usuarios (nombre, telefono, pin, dni, rol, estado_cuenta, estado_verificacion, expira_en, creditos_disponibles)
    values (p_nombre, trim(p_telefono), null, null, 'recolector', 'activo', 'temporal',
            coalesce(p_expira_en, now() + interval '7 days'), v_creditos)
    returning * into v_u;
  end if;

  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u), 'ticket', public.taxi_emitir_ticket(v_u.id, v_u.rol));
end;
$$;

-- El recolector al verificarse: su DNI queda anotado en el regalo.
create or replace function public.fn_usuarios_bienvenida_dni()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rol = 'recolector' and new.dni is not null and new.dni is distinct from old.dni then
    update public.taxi_bienvenidas set dni = new.dni
    where rol = 'recolector' and telefono = new.telefono and dni is null;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_usuarios_bienvenida_dni on public.usuarios;
create trigger trg_usuarios_bienvenida_dni
  after update of dni on public.usuarios
  for each row execute function public.fn_usuarios_bienvenida_dni();

-- ---------- Lo que el conductor puede tocar (reemplaza la versión de 3b) -----
create or replace function public.fn_conductores_columnas_protegidas()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.taxi_es_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.aprobado := false;
    new.estado := 'desconectado';
    new.creditos := 0;
    new.vencimiento_suscripcion := null;
    new.ultimo_descuento_creditos := null;
    new.membresia_paquete_id := null;
    new.nivel_servicio := 'economico';
    return new;
  end if;

  if new.telefono is distinct from old.telefono
     or new.aprobado is distinct from old.aprobado
     or new.creditos is distinct from old.creditos
     or new.vencimiento_suscripcion is distinct from old.vencimiento_suscripcion
     or new.ultimo_descuento_creditos is distinct from old.ultimo_descuento_creditos
     or new.membresia_paquete_id is distinct from old.membresia_paquete_id
     or new.ultimo_paquete_creditos_nombre is distinct from old.ultimo_paquete_creditos_nombre
     or new.ultimo_paquete_creditos_descripcion is distinct from old.ultimo_paquete_creditos_descripcion
     or new.ultima_compra_creditos_at is distinct from old.ultima_compra_creditos_at
     or new.nivel_servicio is distinct from old.nivel_servicio then
    raise exception 'Ese dato del conductor solo lo cambia el Admin.' using errcode = '42501';
  end if;

  -- Vehículo y datos de verificación: solo mientras no esté aprobado.
  if coalesce(old.aprobado, false)
     and (new.nombre is distinct from old.nombre
          or new.placa is distinct from old.placa
          or new.dni is distinct from old.dni
          or new.categoria_id is distinct from old.categoria_id
          or new.subgrupo_id is distinct from old.subgrupo_id
          or new.nivel_servicio_solicitado is distinct from old.nivel_servicio_solicitado
          or new.foto_general_url is distinct from old.foto_general_url
          or new.foto_interior_url is distinct from old.foto_interior_url
          or new.foto_conductor_dni_url is distinct from old.foto_conductor_dni_url) then
    raise exception 'Tus datos verificados solo los cambia el Admin.' using errcode = '42501';
  end if;

  -- Estado: inhabilitado solo lo levanta el Admin; de rechazado solo se
  -- sale reenviando la verificación ("sin estado"); conectarse se puede
  -- aprobado o no (cuenta temporal o en revisión).
  if new.estado is distinct from old.estado then
    if old.estado = 'inhabilitado' then
      raise exception 'Tu cuenta fue inhabilitada por el Admin.' using errcode = '42501';
    elsif old.estado = 'rechazado' and new.estado is not null then
      raise exception 'Reenvía tu verificación para volver a conectarte.' using errcode = '42501';
    elsif new.estado is null then
      if coalesce(old.aprobado, false) then
        raise exception 'Ese estado solo lo cambia el Admin.' using errcode = '42501';
      end if;
    elsif new.estado not in ('activo', 'ocupado', 'desconectado') then
      raise exception 'Ese estado solo lo cambia el Admin.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ---------- Borrado de cuentas temporales vencidas (una por una) ------------
create or replace function public.borrar_cuentas_temporales_vencidas()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_u record;
begin
  for v_u in
    select id, telefono, rol from public.usuarios
    where estado_verificacion = 'temporal' and expira_en is not null and expira_en < now()
  loop
    begin
      if v_u.rol = 'conductor' then
        delete from public.conductores where telefono = v_u.telefono and not coalesce(aprobado, false);
      end if;
      delete from public.usuarios where id = v_u.id;
    exception when others then
      raise notice 'No se pudo borrar la cuenta temporal %: %', v_u.id, sqlerrm;
    end;
  end loop;
end;
$$;
