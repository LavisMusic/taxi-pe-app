-- =========================================================================
-- Cierre de turno: aviso a las 23:30 para recolector y conductor
-- (pedido del dueño, 2026-10-27 / 2026-11-05).
--
--   * Recolector: su turno ya se cerraba solo a las 00:00 (con 3
--     extensiones de 30 min). Ahora el aviso llega a las 23:30, 30 minutos
--     antes del día siguiente. El Admin sigue a las 00:00 (5 extensiones).
--   * Conductor: gana el mismo sistema para su "Cerrar turno": a las 23:30
--     se abre solo, puede extender 30 min hasta 3 veces y después el cierre
--     queda obligatorio — salvo si está en una carrera o con un reparto
--     activo (eso lo decide la app: no se le bloquea a mitad de un viaje).
--     Sus extensiones se reinician cada vez que cierra el turno.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Recolector: vence a las 23:30 ----------------------------------
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
  v_n     integer;
begin
  if v_dueno is null then
    return null;
  end if;
  v_desde := public.taxi_inicio_turno(v_dueno);
  -- Admin: medianoche. Recolector: 30 minutos antes.
  v_vence := public.taxi_vence_turno(v_desde)
             - case when public.taxi_es_admin() then interval '0' else interval '30 minutes' end;
  select extendido_hasta, extensiones into v_ext, v_n from public.taxi_turnos where dueno = v_dueno;
  return jsonb_build_object(
    'desde', v_desde,
    'vence', v_vence,
    'extendido_hasta', v_ext,
    'extensiones', coalesce(v_n, 0),
    'max_extensiones', public.taxi_max_extensiones(),
    'vencido', now() >= greatest(v_vence, coalesce(v_ext, v_vence))
  );
end;
$$;

-- ---------- Conductor ------------------------------------------------------
create or replace function public.taxi_estado_turno_conductor()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_cond  uuid := public.taxi_mi_conductor_id();
  v_desde timestamptz;
  v_vence timestamptz;
  v_ext   timestamptz;
  v_n     integer;
begin
  if v_cond is null then
    return null;
  end if;
  v_desde := public.taxi_inicio_turno_conductor(v_cond);
  v_vence := public.taxi_vence_turno(v_desde) - interval '30 minutes';
  select extendido_hasta, extensiones into v_ext, v_n from public.taxi_turnos where dueno = 'conductor:' || v_cond::text;
  return jsonb_build_object(
    'desde', v_desde,
    'vence', v_vence,
    'extendido_hasta', v_ext,
    'extensiones', coalesce(v_n, 0),
    'max_extensiones', 3,
    'vencido', now() >= greatest(v_vence, coalesce(v_ext, v_vence))
  );
end;
$$;
revoke execute on function public.taxi_estado_turno_conductor() from public, anon;
grant execute on function public.taxi_estado_turno_conductor() to authenticated;

create or replace function public.taxi_extender_turno_conductor()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cond  uuid := public.taxi_mi_conductor_id();
  v_dueno text;
  v_n     integer;
begin
  if v_cond is null then
    return jsonb_build_object('estado', 'sin_permiso');
  end if;
  v_dueno := 'conductor:' || v_cond::text;
  select extensiones into v_n from public.taxi_turnos where dueno = v_dueno for update;
  if coalesce(v_n, 0) >= 3 then
    return jsonb_build_object('estado', 'limite') || public.taxi_estado_turno_conductor();
  end if;
  insert into public.taxi_turnos (dueno, extendido_hasta, extensiones) values (v_dueno, now() + interval '30 minutes', 1)
  on conflict (dueno) do update
    set extendido_hasta = greatest(now(), coalesce(public.taxi_turnos.extendido_hasta, now())) + interval '30 minutes',
        extensiones = public.taxi_turnos.extensiones + 1;
  return jsonb_build_object('estado', 'ok') || public.taxi_estado_turno_conductor();
end;
$$;
revoke execute on function public.taxi_extender_turno_conductor() from public, anon;
grant execute on function public.taxi_extender_turno_conductor() to authenticated;

-- Al cerrar el turno, las extensiones vuelven a cero.
create or replace function public.fn_turno_conductor_reinicia_extensiones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.taxi_turnos where dueno = 'conductor:' || new.conductor_id::text;
  return null;
end;
$$;
drop trigger if exists trg_turno_conductor_reinicia_extensiones on public.taxi_conductor_turnos;
create trigger trg_turno_conductor_reinicia_extensiones
  after insert on public.taxi_conductor_turnos
  for each row execute function public.fn_turno_conductor_reinicia_extensiones();

notify pgrst, 'reload schema';
