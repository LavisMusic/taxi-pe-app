-- =========================================================================
-- Seguridad, fase 2B — tanda 3b: tabla 'conductores'.
--
--   * LEER:
--       - Sin sesión y pasajero: solo los conductores conectados (activo u
--         ocupado) con saldo (créditos o membresía vigente).
--       - Conductor: su propia fila (por teléfono) y las públicas.
--       - Recolector y Admin: todas.
--     Nadie lee directo el DNI ni las fotos de verificación: el Admin los
--     pide con taxi_conductores_privados() (el recolector, solo el DNI).
--   * CREAR: el Admin; el conductor su propia fila (al verificar su
--     cuenta). Recolector/Admin crean con taxi_crear_conductor (ya existía).
--   * CAMBIAR: el Admin todo; el conductor su fila, pero NO créditos,
--     membresía, aprobado, categoría, nivel ni teléfono, y sus datos de
--     verificación solo mientras no esté aprobado.
--   * BORRAR: solo el Admin (se quita 'conductores_delete_anon').
--   * Asientos/estado desde el chat: taxi_sincronizar_asientos(conductor),
--     que los recalcula de las ofertas (el pasajero ya no escribe acá).
--   * Pre-registro (/registro-conductor, sin sesión):
--     taxi_buscar_preregistro(teléfono).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Ayudantes --------------------------------------------------------
-- Teléfono de la cuenta de conductor con sesión (vínculo con 'conductores').
create or replace function public.taxi_mi_telefono_conductor()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select telefono from public.usuarios where id = auth.uid() and rol = 'conductor';
$$;
grant execute on function public.taxi_mi_telefono_conductor() to authenticated;

-- ---------- Políticas -------------------------------------------------------
select public.taxi_reiniciar_politicas('conductores');
alter table public.conductores enable row level security;

create policy conductores_publicos on public.conductores for select to anon, authenticated
  using (
    estado in ('activo', 'ocupado')
    and (coalesce(creditos, 0) > 0 or vencimiento_suscripcion > now())
  );
create policy conductores_leer on public.conductores for select to authenticated
  using (
    public.taxi_es_admin()
    or public.taxi_rol() = 'recolector'
    or telefono = public.taxi_mi_telefono_conductor()
  );
create policy conductores_crear on public.conductores for insert to authenticated
  with check (
    public.taxi_es_admin()
    or (public.taxi_rol() = 'conductor' and telefono = public.taxi_mi_telefono_conductor())
  );
create policy conductores_cambiar on public.conductores for update to authenticated
  using (public.taxi_es_admin() or telefono = public.taxi_mi_telefono_conductor())
  with check (public.taxi_es_admin() or telefono = public.taxi_mi_telefono_conductor());
create policy conductores_admin_borrar on public.conductores for delete to authenticated
  using (public.taxi_es_admin());

-- ---------- Columnas ---------------------------------------------------------
-- Sin sesión no se escribe nada. Leer: todas las columnas menos DNI y fotos
-- de verificación (para anon y authenticated; el Admin los pide aparte).
revoke all on public.conductores from anon;
revoke select on public.conductores from authenticated;
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'conductores'
    and column_name not in ('dni', 'foto_general_url', 'foto_interior_url', 'foto_conductor_dni_url');
  execute format('grant select (%s) on public.conductores to anon, authenticated', v_cols);
end $$;

-- ---------- Lo que el conductor no puede tocar -------------------------------
-- 'trg_a_…': corre ANTES que la membresía gratis y las reglas de saldo.
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
    -- Fila nueva del propio conductor: queda pendiente de revisión y sin
    -- saldo (la membresía gratis de registro la pone su propio trigger).
    new.aprobado := false;
    new.estado := null;
    new.creditos := 0;
    new.vencimiento_suscripcion := null;
    new.ultimo_descuento_creditos := null;
    new.membresia_paquete_id := null;
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
     or new.categoria_id is distinct from old.categoria_id
     or new.subgrupo_id is distinct from old.subgrupo_id
     or new.nivel_servicio is distinct from old.nivel_servicio then
    raise exception 'Ese dato del conductor solo lo cambia el Admin.' using errcode = '42501';
  end if;

  -- Datos de verificación: solo mientras no esté aprobado.
  if coalesce(old.aprobado, false)
     and (new.nombre is distinct from old.nombre
          or new.placa is distinct from old.placa
          or new.dni is distinct from old.dni
          or new.foto_general_url is distinct from old.foto_general_url
          or new.foto_interior_url is distinct from old.foto_interior_url
          or new.foto_conductor_dni_url is distinct from old.foto_conductor_dni_url) then
    raise exception 'Tus datos verificados solo los cambia el Admin.' using errcode = '42501';
  end if;

  -- Estado: conectarse solo aprobado; volver a "sin estado" solo al
  -- reenviar la verificación (no aprobado). 'rechazado'/'pendiente' los
  -- pone el Admin.
  if new.estado is distinct from old.estado then
    if new.estado is null then
      if coalesce(old.aprobado, false) then
        raise exception 'Ese estado solo lo cambia el Admin.' using errcode = '42501';
      end if;
    elsif new.estado in ('activo', 'ocupado') then
      if not coalesce(old.aprobado, false) then
        raise exception 'Tu cuenta aún no está aprobada.' using errcode = '42501';
      end if;
    elsif new.estado <> 'desconectado' then
      raise exception 'Ese estado solo lo cambia el Admin.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_a_conductores_columnas_protegidas on public.conductores;
create trigger trg_a_conductores_columnas_protegidas
  before insert or update on public.conductores
  for each row execute function public.fn_conductores_columnas_protegidas();

-- ---------- DNI y fotos de verificación ---------------------------------------
-- Admin: todo. Recolector: solo el DNI (para buscar en Recarga). Resto: nada.
create or replace function public.taxi_conductores_privados()
returns table (
  id                     uuid,
  dni                    text,
  foto_general_url       text,
  foto_interior_url      text,
  foto_conductor_dni_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         c.dni::text,
         case when public.taxi_es_admin() then c.foto_general_url::text end,
         case when public.taxi_es_admin() then c.foto_interior_url::text end,
         case when public.taxi_es_admin() then c.foto_conductor_dni_url::text end
  from public.conductores c
  where public.taxi_es_admin() or public.taxi_rol() = 'recolector';
$$;
revoke execute on function public.taxi_conductores_privados() from public, anon;
grant execute on function public.taxi_conductores_privados() to authenticated;

-- ---------- Asientos y estado desde el chat ------------------------------------
-- Recalcula asientos_ocupados (pasajeros distintos con oferta aceptada o en
-- tránsito) y, si estaba activo/ocupado, el switch entre los dos. Lo llaman
-- el pasajero y el conductor después de cada cambio de oferta.
create or replace function public.taxi_sincronizar_asientos(p_conductor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_totales  integer;
  v_estado   text;
  v_ocupados integer;
begin
  if p_conductor_id is null then
    return;
  end if;
  select coalesce(asientos_totales, 4), estado into v_totales, v_estado
  from public.conductores where id = p_conductor_id for update;
  if not found then
    return;
  end if;

  select count(distinct pasajero_id) into v_ocupados
  from public.chat_mensajes
  where conductor_id = p_conductor_id
    and tipo = 'oferta'
    and estado_oferta in ('aceptada', 'en_transito');
  v_ocupados := least(coalesce(v_ocupados, 0), v_totales);

  update public.conductores
    set asientos_ocupados = v_ocupados,
        estado = case
          when estado in ('activo', 'ocupado') then case when v_ocupados > 0 then 'ocupado' else 'activo' end
          else estado
        end
  where id = p_conductor_id;
end;
$$;
revoke execute on function public.taxi_sincronizar_asientos(uuid) from public, anon;
grant execute on function public.taxi_sincronizar_asientos(uuid) to authenticated;

-- ---------- Pre-registro (/registro-conductor, sin sesión) ---------------------
-- Solo responde por un pre-registro SIN cuenta todavía (el que el
-- recolector cargó y nadie reclamó).
create or replace function public.taxi_buscar_preregistro(p_telefono text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_c public.conductores;
begin
  select * into v_c from public.conductores where telefono = trim(p_telefono) limit 1;
  if not found then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  if exists (select 1 from public.usuarios where telefono = trim(p_telefono)) then
    return jsonb_build_object('estado', 'ya_vinculado');
  end if;
  return jsonb_build_object(
    'estado', 'ok',
    'conductor', jsonb_build_object('id', v_c.id, 'nombre', v_c.nombre, 'placa', v_c.placa, 'estado', v_c.estado)
  );
end;
$$;
grant execute on function public.taxi_buscar_preregistro(text) to anon, authenticated;
