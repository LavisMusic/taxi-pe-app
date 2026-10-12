-- =========================================================================
-- Cierres de caja de verdad en Taxi-PE (Admin y cada recolector).
--
-- Antes "Cerrar turno" escribía en una tabla 'cierres_caja' que nunca se
-- creó en esta base: ningún cierre se guardaba y el turno del recolector
-- vivía en su navegador. Ahora:
--   * cierres_caja guarda cada cierre con su dueño (el recolector, o el
--     Admin), el período (desde / hasta), los totales por método, los
--     gastos operativos y el arqueo (efectivo contado y diferencia).
--   * Cada uno ve SOLO sus cierres (el Admin no interviene en los de los
--     recolectores).
--   * El turno empieza al cerrar el anterior. Debe cerrarse a las 00:00
--     (hora de Perú); taxi_estado_caja avisa cuando ya venció y
--     taxi_extender_turno lo extiende 30 min (cuantas veces haga falta).
--   * taxi_cerrar_caja calcula los totales EN LA BASE (no se pueden
--     alterar desde el navegador) y pide el efectivo contado:
--       - recolector: sus ventas del turno; gastos = sus compras de
--         créditos aprobadas en el turno (si no compró, 0).
--       - Admin: sus ventas (las que no hizo un recolector); gastos = los
--         gastos operativos del turno.
--   * Una venta que ya entró en un cierre no la puede anular el
--     recolector (el Admin sí).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create table if not exists public.cierres_caja (
  id                 uuid primary key default gen_random_uuid(),
  recolector_id      uuid references public.usuarios(id) on delete cascade,
  es_admin           boolean not null default false,
  cajero_nombre      text,
  desde              timestamptz,
  hasta              timestamptz not null default now(),
  recaudado_total    numeric not null default 0,
  total_efectivo     numeric not null default 0,
  total_digital      numeric not null default 0,
  total_fiado        numeric not null default 0,
  total_gastos       numeric not null default 0,
  gastos_efectivo    numeric not null default 0,
  balance_neto       numeric not null default 0,
  ventas_registradas integer not null default 0,
  ticket_general     numeric not null default 0,
  efectivo_esperado  numeric not null default 0,
  efectivo_real      numeric,
  diferencia         numeric,
  created_at         timestamptz not null default now(),
  check (es_admin or recolector_id is not null)
);
create index if not exists cierres_caja_dueno_idx on public.cierres_caja (recolector_id, es_admin, hasta desc);

alter table public.cierres_caja enable row level security;
revoke all on public.cierres_caja from anon;
revoke insert, update, delete, truncate on public.cierres_caja from authenticated;
drop policy if exists cierres_caja_propios on public.cierres_caja;
create policy cierres_caja_propios on public.cierres_caja for select to authenticated
  using (
    (public.taxi_es_admin() and es_admin)
    or (public.taxi_rol() = 'recolector' and recolector_id = auth.uid())
  );

-- Extensiones del turno (una fila por dueño: 'admin' o el id del recolector).
create table if not exists public.taxi_turnos (
  dueno           text primary key,
  extendido_hasta timestamptz
);
alter table public.taxi_turnos enable row level security;
revoke all on public.taxi_turnos from anon, authenticated;

-- ---------- Ayudantes ------------------------------------------------------
-- Dueño de la caja de la sesión: 'admin', el id del recolector o null.
create or replace function public.taxi_dueno_caja()
returns text
language sql
stable
set search_path = public
as $$
  select case
    when public.taxi_es_admin() then 'admin'
    when public.taxi_rol() = 'recolector' then auth.uid()::text
    else null
  end;
$$;

-- Inicio del turno abierto: el fin del último cierre (o, si nunca cerró,
-- su primera venta; o ahora).
create or replace function public.taxi_inicio_turno(p_dueno text)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select max(hasta) from public.cierres_caja
      where case when p_dueno = 'admin' then es_admin else recolector_id::text = p_dueno end),
    (select min(created_at) from public.ventas
      where case when p_dueno = 'admin' then recolector_id is null else recolector_id::text = p_dueno end),
    now()
  );
$$;

-- Hora de cierre del turno: la medianoche (hora de Perú) siguiente a su
-- inicio.
create or replace function public.taxi_vence_turno(p_desde timestamptz)
returns timestamptz
language sql
immutable
as $$
  select ((date_trunc('day', p_desde at time zone 'America/Lima') + interval '1 day') at time zone 'America/Lima');
$$;

-- ---------- Estado / extender / cerrar ------------------------------------
-- { desde, vence, extendido_hasta, vencido }
create or replace function public.taxi_estado_caja()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dueno text := public.taxi_dueno_caja();
  v_desde timestamptz;
  v_vence timestamptz;
  v_ext   timestamptz;
begin
  if v_dueno is null then
    return null;
  end if;
  v_desde := public.taxi_inicio_turno(v_dueno);
  v_vence := public.taxi_vence_turno(v_desde);
  select extendido_hasta into v_ext from public.taxi_turnos where dueno = v_dueno;
  return jsonb_build_object(
    'desde', v_desde,
    'vence', v_vence,
    'extendido_hasta', v_ext,
    'vencido', now() >= greatest(v_vence, coalesce(v_ext, v_vence))
  );
end;
$$;

create or replace function public.taxi_extender_turno()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dueno text := public.taxi_dueno_caja();
begin
  if v_dueno is null then
    return jsonb_build_object('estado', 'sin_permiso');
  end if;
  insert into public.taxi_turnos (dueno, extendido_hasta) values (v_dueno, now() + interval '30 minutes')
  on conflict (dueno) do update
    set extendido_hasta = greatest(now(), coalesce(public.taxi_turnos.extendido_hasta, now())) + interval '30 minutes';
  return jsonb_build_object('estado', 'ok') || public.taxi_estado_caja();
end;
$$;

create or replace function public.taxi_cerrar_caja(p_efectivo_real numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dueno    text := public.taxi_dueno_caja();
  v_admin    boolean := public.taxi_es_admin();
  v_uid      uuid := auth.uid();
  v_desde    timestamptz;
  v_hasta    timestamptz := now();
  v_rec      numeric;
  v_ef       numeric;
  v_dig      numeric;
  v_fia      numeric;
  v_n        integer;
  v_gastos   numeric;
  v_gastos_ef numeric;
  v_esperado numeric;
  v_nombre   text;
  v_cierre   public.cierres_caja;
begin
  if v_dueno is null then
    return jsonb_build_object('estado', 'sin_permiso');
  end if;
  if p_efectivo_real is null or p_efectivo_real < 0 then
    return jsonb_build_object('estado', 'falta_efectivo');
  end if;
  v_desde := public.taxi_inicio_turno(v_dueno);

  select coalesce(sum(monto), 0),
         coalesce(sum(monto) filter (where metodo_pago = 'efectivo'), 0),
         coalesce(sum(monto) filter (where metodo_pago in ('yape', 'plin', 'otros')), 0),
         coalesce(sum(monto) filter (where metodo_pago = 'fiado'), 0),
         count(*)
    into v_rec, v_ef, v_dig, v_fia, v_n
  from public.ventas
  where not coalesce(anulado, false)
    and created_at > v_desde and created_at <= v_hasta
    and case when v_admin then recolector_id is null else recolector_id = v_uid end;

  if v_admin then
    select coalesce(sum(monto), 0), coalesce(sum(monto), 0) into v_gastos, v_gastos_ef
    from public.gastos_operativos where created_at > v_desde and created_at <= v_hasta;
    v_nombre := 'Admin';
  else
    select coalesce(sum(monto), 0), coalesce(sum(monto) filter (where metodo_pago = 'efectivo'), 0)
      into v_gastos, v_gastos_ef
    from public.peticiones_recarga_recolector
    where recolector_id = v_uid and estado = 'aprobado'
      and coalesce(resuelto_at, created_at) > v_desde and coalesce(resuelto_at, created_at) <= v_hasta;
    select nombre into v_nombre from public.usuarios where id = v_uid;
  end if;

  v_esperado := v_ef - v_gastos_ef;

  insert into public.cierres_caja (
    recolector_id, es_admin, cajero_nombre, desde, hasta, recaudado_total, total_efectivo, total_digital,
    total_fiado, total_gastos, gastos_efectivo, balance_neto, ventas_registradas, ticket_general,
    efectivo_esperado, efectivo_real, diferencia
  ) values (
    case when v_admin then null else v_uid end, v_admin, coalesce(v_nombre, 'Recolector'), v_desde, v_hasta,
    v_rec, v_ef, v_dig, v_fia, v_gastos, v_gastos_ef, v_rec - v_gastos, v_n,
    case when v_n > 0 then round(v_rec / v_n, 2) else 0 end,
    v_esperado, p_efectivo_real, p_efectivo_real - v_esperado
  )
  returning * into v_cierre;

  delete from public.taxi_turnos where dueno = v_dueno;
  return jsonb_build_object('estado', 'ok', 'cierre', to_jsonb(v_cierre));
end;
$$;

revoke execute on function public.taxi_inicio_turno(text) from public, anon, authenticated;
revoke execute on function
  public.taxi_estado_caja(),
  public.taxi_extender_turno(),
  public.taxi_cerrar_caja(numeric)
from public, anon;
grant execute on function
  public.taxi_estado_caja(),
  public.taxi_extender_turno(),
  public.taxi_cerrar_caja(numeric)
to authenticated;
grant execute on function public.taxi_dueno_caja() to authenticated;

-- ---------- Anular: no lo ya cerrado (recolector) ----------------------------
-- estado: 'ok' | 'sin_permiso' | 'no_existe' | 'ya_anulada' |
-- 'ya_cerrada' (el recolector no anula ventas que ya entraron en un cierre).
-- Devuelve también era_fiado / fiado_encontrado (como hacía la app).
create or replace function public.taxi_anular_venta(p_venta_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol    text := public.taxi_rol();
  v_uid    uuid := auth.uid();
  v_venta  public.ventas;
  v_cred   integer;
  v_dias   integer;
  v_fiados integer := 0;
begin
  if v_rol is null or v_rol not in ('admin', 'recolector') then
    return jsonb_build_object('estado', 'sin_permiso');
  end if;

  select * into v_venta from public.ventas where id::text = p_venta_id for update;
  if v_venta.id is null then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  if v_rol = 'recolector' and v_venta.recolector_id is distinct from v_uid then
    return jsonb_build_object('estado', 'sin_permiso');
  end if;
  if coalesce(v_venta.anulado, false) then
    return jsonb_build_object('estado', 'ya_anulada');
  end if;
  if v_rol = 'recolector' and v_venta.created_at <= (
    select max(hasta) from public.cierres_caja where recolector_id = v_uid
  ) then
    return jsonb_build_object('estado', 'ya_cerrada');
  end if;

  v_cred := coalesce(v_venta.creditos_otorgados, nullif(substring(coalesce(v_venta.detalle, '') from '^(\d+)'), '')::integer, 0);
  v_dias := coalesce(v_venta.dias_otorgados, nullif(substring(coalesce(v_venta.detalle, '') from '·\s*(\d+)\s*días'), '')::integer, 30);

  -- Al conductor (o al cliente, en ventas viejas) se le quita lo recibido.
  if v_venta.conductor_id is not null then
    if v_venta.tipo_item = 'membresia' then
      update public.conductores
        set vencimiento_suscripcion = vencimiento_suscripcion - v_dias * interval '1 day'
        where id = v_venta.conductor_id and vencimiento_suscripcion is not null;
    else
      update public.conductores
        set creditos = greatest(coalesce(creditos, 0) - v_cred, 0)
        where id = v_venta.conductor_id;
    end if;
  elsif v_venta.cliente_id is not null and v_venta.tipo_item = 'creditos' then
    update public.usuarios
      set creditos_disponibles = greatest(coalesce(creditos_disponibles, 0) - v_cred, 0)
      where id = v_venta.cliente_id;
  end if;

  -- Al recolector se le devuelven los créditos que gastó.
  if v_venta.recolector_id is not null and v_venta.creditos_descontados > 0 then
    update public.usuarios
      set creditos_disponibles = coalesce(creditos_disponibles, 0) + v_venta.creditos_descontados
      where id = v_venta.recolector_id;
  end if;

  update public.ventas set anulado = true where id = v_venta.id;

  if v_venta.metodo_pago = 'fiado' then
    update public.fiados_conductores set estado = 'anulado' where venta_id = v_venta.id;
    get diagnostics v_fiados = row_count;
  end if;

  return jsonb_build_object(
    'estado', 'ok',
    'era_fiado', v_venta.metodo_pago = 'fiado',
    'fiado_encontrado', v_venta.metodo_pago <> 'fiado' or v_fiados > 0
  );
end;
$$;
revoke execute on function public.taxi_anular_venta(text) from public, anon;
grant execute on function public.taxi_anular_venta(text) to authenticated;
