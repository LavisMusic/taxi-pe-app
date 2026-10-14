-- =========================================================================
-- Turno del conductor: guarda la meta del día que tenía al cerrar
-- (conductores.meta_diaria), para verla en el cierre y en el historial
-- junto con si se cumplió.
--
-- Requiere 20261014160000 y 20261014170000. Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.taxi_conductor_turnos add column if not exists meta numeric(10, 2);

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
  return public.taxi_resumen_conductor(v_id, public.taxi_inicio_turno_conductor(v_id), now(), true)
    || jsonb_build_object('meta', (select meta_diaria from public.conductores where id = v_id));
end;
$$;
grant execute on function public.taxi_turno_actual_conductor() to authenticated;

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
    (conductor_id, desde, hasta, viajes, ganado_viajes, entregas, ganado_envios, minutos_taxi, minutos_delivery,
     detalle, meta)
  values (
    v_id, (v_r ->> 'desde')::timestamptz, (v_r ->> 'hasta')::timestamptz,
    (v_r ->> 'viajes')::integer, (v_r ->> 'ganado_viajes')::numeric,
    (v_r ->> 'entregas')::integer, (v_r ->> 'ganado_envios')::numeric,
    (v_r ->> 'minutos_taxi')::integer, (v_r ->> 'minutos_delivery')::integer,
    v_r -> 'detalle',
    (select meta_diaria from public.conductores where id = v_id)
  )
  returning * into v_row;
  return jsonb_build_object('estado', 'ok', 'turno', to_jsonb(v_row));
end;
$$;
grant execute on function public.taxi_cerrar_turno_conductor() to authenticated;

notify pgrst, 'reload schema';
