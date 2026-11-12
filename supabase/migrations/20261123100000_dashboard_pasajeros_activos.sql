-- =========================================================================
-- Dashboard de Taxi-PE: medidor "Pasajeros activos" (reemplaza al de
-- "Gemas verdes ganadas", que ya está en la tarjeta Gemas de abajo).
--
-- taxi_dashboard_admin pasa a ser un envoltorio: la función de siempre se
-- renombra a taxi__dashboard_admin_base (sin tocarla) y se le suman:
--   pasajeros_activos      pasajeros con al menos un viaje terminado en el
--                          periodo (taxi_viajes_hechos)
--   pasajeros_activos_ant  lo mismo en el periodo anterior
--   pasajeros_hoy          con viaje terminado hoy (Lima)
--   pasajeros_total        cuentas de pasajero
--   pasajeros_nuevos       pasajeros registrados en el periodo
-- Nota: taxi_viajes_hechos existe desde la fase 4a (noviembre 2026); antes
-- de eso no hay viajes guardados para contar.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'taxi__dashboard_admin_base'
  ) then
    alter function public.taxi_dashboard_admin(timestamptz, timestamptz) rename to taxi__dashboard_admin_base;
  end if;
end;
$$;
revoke execute on function public.taxi__dashboard_admin_base(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.taxi_dashboard_admin(p_desde timestamptz, p_hasta timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ant timestamptz := p_desde - (p_hasta - p_desde);
  v_hoy timestamptz := date_trunc('day', now() at time zone 'America/Lima') at time zone 'America/Lima';
begin
  if not public.taxi__puede_ver_metricas() then
    raise exception 'Solo el admin.' using errcode = '42501';
  end if;

  return public.taxi__dashboard_admin_base(p_desde, p_hasta) || jsonb_build_object(
    'pasajeros_activos', (select count(distinct pasajero_id) from public.taxi_viajes_hechos
                           where finalizado_at >= p_desde and finalizado_at < p_hasta),
    'pasajeros_activos_ant', (select count(distinct pasajero_id) from public.taxi_viajes_hechos
                               where finalizado_at >= v_ant and finalizado_at < p_desde),
    'pasajeros_hoy', (select count(distinct pasajero_id) from public.taxi_viajes_hechos
                       where finalizado_at >= v_hoy),
    'pasajeros_total', (select count(*) from public.usuarios where rol = 'pasajero'),
    'pasajeros_nuevos', (select count(*) from public.usuarios
                          where rol = 'pasajero' and created_at >= p_desde and created_at < p_hasta)
  );
end;
$$;
revoke execute on function public.taxi_dashboard_admin(timestamptz, timestamptz) from public, anon;
grant execute on function public.taxi_dashboard_admin(timestamptz, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
