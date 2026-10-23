-- =========================================================================
-- Conductor: modo delivery, turnos (cerrar turno + historial) y
-- estadísticas.
--
--   * conductores.modo_delivery: el switch del panel de repartidor. Solo
--     con membresía vigente (con créditos solo se hacen viajes); se apaga
--     solo si la membresía vence. Los negocios de Caja Tonazo ven para
--     repartos a quien lo tiene encendido (aunque esté desconectado como
--     taxi) y está mandando su GPS.
--   * taxi_conductor_conexiones: cuándo estuvo conectado como taxi
--     (Activo/Ocupado) y cuándo con el modo delivery — para medir el tiempo.
--   * chat_mensajes.finalizado_at: cuándo terminó cada viaje.
--   * taxi_conductor_turnos: cada "Cerrar turno" guarda desde/hasta y lo
--     calculado en ese rango (viajes, ganado en viajes, entregas, ganado en
--     envíos, tiempos) con el detalle de cada viaje y reparto. "Limpiar
--     historial" solo lo oculta: las estadísticas se calculan de los viajes
--     y entregas reales, no del historial.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Modo delivery ----------------------------------------------------
alter table public.conductores add column if not exists modo_delivery boolean not null default false;
grant select (modo_delivery) on public.conductores to anon, authenticated;

create or replace function public.fn_conductores_modo_delivery()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.taxi_es_admin()
     and new.modo_delivery and not coalesce(old.modo_delivery, false)
     and not (new.vencimiento_suscripcion is not null and new.vencimiento_suscripcion > now()) then
    raise exception 'El modo delivery requiere una membresía vigente (con créditos solo puedes hacer viajes).'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_conductores_modo_delivery on public.conductores;
create trigger trg_conductores_modo_delivery
  before update on public.conductores
  for each row execute function public.fn_conductores_modo_delivery();

-- ---------- Tiempo conectado -------------------------------------------------
create table if not exists public.taxi_conductor_conexiones (
  id           bigserial primary key,
  conductor_id uuid not null,
  tipo         text not null check (tipo in ('taxi', 'delivery')),
  inicio       timestamptz not null default now(),
  fin          timestamptz
);
create index if not exists taxi_conexiones_conductor on public.taxi_conductor_conexiones (conductor_id, inicio desc);
alter table public.taxi_conductor_conexiones enable row level security;
revoke all on public.taxi_conductor_conexiones from anon, authenticated;

create or replace function public.fn_conductores_registrar_conexion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taxi_ahora   boolean := new.estado in ('activo', 'ocupado');
  v_taxi_antes   boolean := tg_op = 'UPDATE' and old.estado in ('activo', 'ocupado');
  v_deliv_ahora  boolean := coalesce(new.modo_delivery, false);
  v_deliv_antes  boolean := tg_op = 'UPDATE' and coalesce(old.modo_delivery, false);
begin
  if v_taxi_ahora and not v_taxi_antes then
    insert into public.taxi_conductor_conexiones (conductor_id, tipo) values (new.id, 'taxi');
  elsif v_taxi_antes and not v_taxi_ahora then
    update public.taxi_conductor_conexiones set fin = now()
      where conductor_id = new.id and tipo = 'taxi' and fin is null;
  end if;
  if v_deliv_ahora and not v_deliv_antes then
    insert into public.taxi_conductor_conexiones (conductor_id, tipo) values (new.id, 'delivery');
  elsif v_deliv_antes and not v_deliv_ahora then
    update public.taxi_conductor_conexiones set fin = now()
      where conductor_id = new.id and tipo = 'delivery' and fin is null;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_conductores_registrar_conexion on public.conductores;
create trigger trg_conductores_registrar_conexion
  after insert or update of estado, modo_delivery on public.conductores
  for each row execute function public.fn_conductores_registrar_conexion();

-- ---------- Cuándo terminó cada viaje ----------------------------------------
alter table public.chat_mensajes add column if not exists finalizado_at timestamptz;

create or replace function public.fn_chat_oferta_finalizado_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.estado_oferta = 'finalizado' and old.estado_oferta is distinct from 'finalizado' then
    new.finalizado_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_chat_oferta_finalizado_at on public.chat_mensajes;
create trigger trg_chat_oferta_finalizado_at
  before update of estado_oferta on public.chat_mensajes
  for each row execute function public.fn_chat_oferta_finalizado_at();

-- ---------- Saldos (cada 10 min): además apaga el modo delivery sin membresía --
create or replace function public.taxi_aplicar_saldos()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conductores c
    set creditos = greatest(c.creditos - d.dias, 0),
        ultimo_descuento_creditos = c.ultimo_descuento_creditos + d.dias * interval '1 day'
  from (
    select id, floor(extract(epoch from now() - ultimo_descuento_creditos) / 86400)::integer as dias
    from public.conductores
    where coalesce(creditos, 0) > 0 and ultimo_descuento_creditos is not null
      and ultimo_descuento_creditos <= now() - interval '1 day'
  ) d
  where c.id = d.id and d.dias > 0;

  update public.conductores
    set ultimo_descuento_creditos = now()
    where coalesce(creditos, 0) > 0 and ultimo_descuento_creditos is null
      and (vencimiento_suscripcion is null or vencimiento_suscripcion <= now());

  update public.conductores
    set estado = 'desconectado'
    where estado in ('activo', 'ocupado')
      and coalesce(creditos, 0) <= 0
      and (vencimiento_suscripcion is null or vencimiento_suscripcion <= now());

  update public.conductores
    set modo_delivery = false
    where modo_delivery
      and (vencimiento_suscripcion is null or vencimiento_suscripcion <= now());
end;
$$;
revoke execute on function public.taxi_aplicar_saldos() from public, anon, authenticated;

-- ---------- Repartidores visibles para Caja: modo delivery encendido ---------
create or replace function public.rpc_conductores_para_reparto()
returns table (
  id          uuid,
  nombre      text,
  placa       text,
  foto_url    text,
  estado      text,
  ultima_lat  numeric,
  ultima_lng  numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.nombre, c.placa, c.foto_url, c.estado, c.ultima_lat, c.ultima_lng
  from public.conductores c
  join public.usuarios u
    on u.telefono = c.telefono
   and u.rol = 'conductor'
   and coalesce(u.estado_verificacion, 'permanente') = 'permanente'
  where coalesce(c.aprobado, false)
    and coalesce(c.modo_delivery, false)
    and c.vencimiento_suscripcion > now()
    and c.ultima_lat is not null
    and c.ultima_lng is not null
    and c.ultima_actualizacion > now() - interval '2 minutes'
    and not exists (
      select 1 from public.entregas e
      where e.conductor_id = c.id and e.estado = 'en_ruta'
    );
$$;
grant execute on function public.rpc_conductores_para_reparto() to anon, authenticated;

-- ---------- Turnos -----------------------------------------------------------
create table if not exists public.taxi_conductor_turnos (
  id               bigserial primary key,
  conductor_id     uuid not null,
  desde            timestamptz not null,
  hasta            timestamptz not null,
  viajes           integer not null default 0,
  ganado_viajes    numeric not null default 0,
  entregas         integer not null default 0,
  ganado_envios    numeric not null default 0,
  minutos_taxi     integer not null default 0,
  minutos_delivery integer not null default 0,
  detalle          jsonb not null default '[]'::jsonb,
  oculto           boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists taxi_turnos_conductor on public.taxi_conductor_turnos (conductor_id, hasta desc);
alter table public.taxi_conductor_turnos enable row level security;
revoke all on public.taxi_conductor_turnos from anon, authenticated;
grant select on public.taxi_conductor_turnos to authenticated;
drop policy if exists turnos_conductor_leer on public.taxi_conductor_turnos;
create policy turnos_conductor_leer on public.taxi_conductor_turnos for select to authenticated
  using (public.taxi_es_admin() or conductor_id = public.taxi_mi_conductor_id());

-- Lo calculado de un conductor en un rango (con o sin el detalle).
create or replace function public.taxi_resumen_conductor(
  p_conductor_id uuid, p_desde timestamptz, p_hasta timestamptz, p_con_detalle boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viajes   jsonb;
  v_entregas jsonb;
  v_min_taxi integer;
  v_min_del  integer;
begin
  select coalesce(jsonb_agg(v order by v ->> 'fecha'), '[]'::jsonb) into v_viajes
  from (
    select jsonb_build_object(
      'tipo', 'viaje',
      'fecha', coalesce(m.finalizado_at, m.created_at),
      -- La tarifa viaja en el texto de la oferta ("S/ 3.00"): el primer número.
      'monto', coalesce(substring(m.mensaje from '([0-9]+(?:\.[0-9]+)?)')::numeric, 0),
      'detalle', coalesce(u.nombre, 'Pasajero')
    ) as v
    from public.chat_mensajes m
    left join public.usuarios u on u.id = m.pasajero_id
    where m.conductor_id = p_conductor_id
      and m.tipo = 'oferta'
      and m.estado_oferta = 'finalizado'
      and coalesce(m.finalizado_at, m.created_at) > p_desde
      and coalesce(m.finalizado_at, m.created_at) <= p_hasta
  ) s;

  select coalesce(jsonb_agg(v order by v ->> 'fecha'), '[]'::jsonb) into v_entregas
  from (
    select jsonb_build_object(
      'tipo', 'reparto',
      'fecha', e.entregado_at,
      'monto', coalesce(e.tarifa, 0),
      'detalle', trim(coalesce(e.caja_sucursal, 'Tienda') || ' → ' || coalesce(e.cliente_nombre, 'Cliente'))
    ) as v
    from public.entregas e
    where e.conductor_id = p_conductor_id
      and e.estado = 'entregado'
      and e.entregado_at > p_desde
      and e.entregado_at <= p_hasta
  ) s;

  select
    coalesce(sum(extract(epoch from least(coalesce(fin, now()), p_hasta) - greatest(inicio, p_desde)) / 60)
             filter (where tipo = 'taxi'), 0)::integer,
    coalesce(sum(extract(epoch from least(coalesce(fin, now()), p_hasta) - greatest(inicio, p_desde)) / 60)
             filter (where tipo = 'delivery'), 0)::integer
    into v_min_taxi, v_min_del
  from public.taxi_conductor_conexiones
  where conductor_id = p_conductor_id
    and inicio < p_hasta
    and coalesce(fin, now()) > p_desde;

  return jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'viajes', jsonb_array_length(v_viajes),
    'ganado_viajes', (select coalesce(sum((x ->> 'monto')::numeric), 0) from jsonb_array_elements(v_viajes) x),
    'entregas', jsonb_array_length(v_entregas),
    'ganado_envios', (select coalesce(sum((x ->> 'monto')::numeric), 0) from jsonb_array_elements(v_entregas) x),
    'minutos_taxi', greatest(v_min_taxi, 0),
    'minutos_delivery', greatest(v_min_del, 0),
    'detalle', case when p_con_detalle then v_viajes || v_entregas else '[]'::jsonb end
  );
end;
$$;
revoke execute on function public.taxi_resumen_conductor(uuid, timestamptz, timestamptz, boolean) from public, anon, authenticated;

-- Inicio del turno abierto: el fin del último turno cerrado o, si nunca
-- cerró, cuando se creó su fila de conductor.
create or replace function public.taxi_inicio_turno_conductor(p_conductor_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select max(hasta) from public.taxi_conductor_turnos where conductor_id = p_conductor_id),
    (select created_at from public.conductores where id = p_conductor_id),
    now()
  );
$$;
revoke execute on function public.taxi_inicio_turno_conductor(uuid) from public, anon, authenticated;

-- El turno abierto del conductor con sesión (para ver antes de cerrarlo).
create or replace function public.taxi_turno_actual_conductor()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid := public.taxi_mi_conductor_id();
begin
  if v_id is null then
    return null;
  end if;
  return public.taxi_resumen_conductor(v_id, public.taxi_inicio_turno_conductor(v_id), now(), true);
end;
$$;
grant execute on function public.taxi_turno_actual_conductor() to authenticated;

-- Cerrar turno: guarda el turno abierto en el historial; el nuevo arranca
-- en cero desde ahora.
create or replace function public.taxi_cerrar_turno_conductor()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  uuid := public.taxi_mi_conductor_id();
  v_r   jsonb;
  v_row public.taxi_conductor_turnos;
begin
  if v_id is null then
    return jsonb_build_object('estado', 'sin_permiso');
  end if;
  v_r := public.taxi_resumen_conductor(v_id, public.taxi_inicio_turno_conductor(v_id), now(), true);
  insert into public.taxi_conductor_turnos
    (conductor_id, desde, hasta, viajes, ganado_viajes, entregas, ganado_envios, minutos_taxi, minutos_delivery, detalle)
  values (
    v_id, (v_r ->> 'desde')::timestamptz, (v_r ->> 'hasta')::timestamptz,
    (v_r ->> 'viajes')::integer, (v_r ->> 'ganado_viajes')::numeric,
    (v_r ->> 'entregas')::integer, (v_r ->> 'ganado_envios')::numeric,
    (v_r ->> 'minutos_taxi')::integer, (v_r ->> 'minutos_delivery')::integer,
    v_r -> 'detalle'
  )
  returning * into v_row;
  return jsonb_build_object('estado', 'ok', 'turno', to_jsonb(v_row));
end;
$$;
grant execute on function public.taxi_cerrar_turno_conductor() to authenticated;

-- Estadísticas: hoy, esta semana (desde el lunes) y este mes (hora de Perú).
create or replace function public.taxi_estadisticas_conductor()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id    uuid := public.taxi_mi_conductor_id();
  v_local timestamp := now() at time zone 'America/Lima';
begin
  if v_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'hoy',    public.taxi_resumen_conductor(v_id, date_trunc('day', v_local) at time zone 'America/Lima', now(), false),
    'semana', public.taxi_resumen_conductor(v_id, date_trunc('week', v_local) at time zone 'America/Lima', now(), false),
    'mes',    public.taxi_resumen_conductor(v_id, date_trunc('month', v_local) at time zone 'America/Lima', now(), false)
  );
end;
$$;
grant execute on function public.taxi_estadisticas_conductor() to authenticated;

-- Limpiar historial: oculta los turnos (lo contado no se toca).
create or replace function public.taxi_limpiar_historial_turnos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := public.taxi_mi_conductor_id();
  v_n  integer;
begin
  if v_id is null then
    return 0;
  end if;
  update public.taxi_conductor_turnos set oculto = true where conductor_id = v_id and not oculto;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function public.taxi_limpiar_historial_turnos() to authenticated;
