-- =========================================================================
-- Fase 5c (2): dashboard de Taxi-PE con lo que se trae de Caja.
-- Misma función taxi_dashboard_admin, más:
--   * membresías separadas: conductores y recolectores, cada una con su
--     periodo anterior y cuántas se vendieron.
--   * estados de las membresías (vigente / por vencer 7 días / vencida /
--     sin membresía) de conductores y de recolectores.
--   * bajas: membresías que vencieron en el periodo y no se renovaron,
--     sobre las que estaban vigentes al empezar.
--   * mrr: lo que pagan las membresías vigentes repartido a 30 días
--     (monto / días × 30), al final del periodo y al empezar.
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================
create or replace function public.taxi_dashboard_admin(p_desde timestamptz, p_hasta timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ant timestamptz := p_desde - (p_hasta - p_desde);
  v_fin timestamptz := least(p_hasta, now());
  v_hoy timestamptz := date_trunc('day', now() at time zone 'America/Lima') at time zone 'America/Lima';
  v_out jsonb;
begin
  if not public.taxi__puede_ver_metricas() then
    raise exception 'Solo el admin.' using errcode = '42501';
  end if;

  with
  vc as (  -- membresías vendidas a conductores
    select v.monto, v.created_at, v.conductor_id, v.recolector_id, coalesce(v.gemas_usadas, 0) as gemas_usadas,
           greatest(coalesce(v.dias_otorgados, 30), 1) as dias,
           coalesce(v.gemas_monto, 0) as gemas_monto
      from public.ventas v
     where not coalesce(v.anulado, false) and v.tipo_item = 'membresia'
  ),
  vr as (  -- membresías de recolectores aprobadas
    select p.monto, p.resuelto_at as created_at, coalesce(p.gemas_usadas, 0) as gemas_usadas,
           greatest(coalesce(p.dias_membresia, 30), 1) as dias,
           coalesce(p.gemas_monto, 0) as gemas_monto
      from public.peticiones_recarga_recolector p
     where p.estado = 'aprobado' and p.resuelto_at is not null
  ),
  tu as (
    select * from public.taxi_conductor_turnos where hasta >= v_ant and hasta < p_hasta
  ),
  en as (
    select * from public.entregas where creado_at >= v_ant and creado_at < p_hasta
  ),
  cx as (  -- conexiones recortadas al periodo
    select conductor_id, tipo,
           greatest(inicio, p_desde) as ini,
           least(coalesce(fin, now()), v_fin) as fin
      from public.taxi_conductor_conexiones
     where inicio < v_fin and coalesce(fin, now()) > p_desde
  ),
  cx_ant as (
    select distinct conductor_id
      from public.taxi_conductor_conexiones
     where inicio < p_desde and coalesce(fin, now()) > v_ant
  ),
  gm as (
    select delta, created_at from public.taxi_gemas_movimientos
     where color = 'verde' and created_at >= v_ant and created_at < p_hasta
  )
  select jsonb_build_object(
    'ingresos_conductores', coalesce((select sum(monto) from vc where created_at >= p_desde and created_at < p_hasta), 0),
    'ingresos_recolectores', coalesce((select sum(monto) from vr where created_at >= p_desde and created_at < p_hasta), 0),
    'ingresos_ant', coalesce((select sum(monto) from vc where created_at >= v_ant and created_at < p_desde), 0)
                  + coalesce((select sum(monto) from vr where created_at >= v_ant and created_at < p_desde), 0),
    'membresias', (select count(*) from vc where created_at >= p_desde and created_at < p_hasta)
                + (select count(*) from vr where created_at >= p_desde and created_at < p_hasta),

    'viajes', coalesce((select sum(viajes) from tu where hasta >= p_desde), 0),
    'viajes_ant', coalesce((select sum(viajes) from tu where hasta < p_desde), 0),
    'ganado_viajes', coalesce((select sum(ganado_viajes) from tu where hasta >= p_desde), 0),
    'ganado_envios', coalesce((select sum(ganado_envios) from tu where hasta >= p_desde), 0),

    'entregas_ok', (select count(*) from en where creado_at >= p_desde and estado = 'entregado'),
    'entregas_ok_ant', (select count(*) from en where creado_at < p_desde and estado = 'entregado'),
    'entregas_fallidas', (select count(*) from en where creado_at >= p_desde and estado in ('cancelado', 'no_entregado')),
    'entregas_en_curso', (select count(*) from en where creado_at >= p_desde and estado in ('buscando', 'aceptado', 'en_ruta')),
    'entrega_minutos', (select round(avg(extract(epoch from entregado_at - aceptado_at) / 60)::numeric, 1)
                          from en where creado_at >= p_desde and estado = 'entregado'
                           and aceptado_at is not null and entregado_at > aceptado_at),

    'activos_hoy', (select count(distinct conductor_id) from cx where fin > v_hoy),
    'activos_periodo', (select count(distinct conductor_id) from cx),
    'activos_ant', (select count(*) from cx_ant),
    'conductores_total', (select count(*) from public.conductores),
    'horas_taxi', coalesce((select round((sum(extract(epoch from fin - ini)) / 3600)::numeric, 1) from cx where tipo = 'taxi' and fin > ini), 0),
    'horas_delivery', coalesce((select round((sum(extract(epoch from fin - ini)) / 3600)::numeric, 1) from cx where tipo = 'delivery' and fin > ini), 0),

    'gemas_ganadas', coalesce((select sum(delta) from gm where delta > 0 and created_at >= p_desde), 0),
    'gemas_ganadas_ant', coalesce((select sum(delta) from gm where delta > 0 and created_at < p_desde), 0),
    'gemas_usadas', coalesce((select -sum(delta) from gm where delta < 0 and created_at >= p_desde), 0),
    'gemas_canjeadas', coalesce((select sum(gemas_usadas) from vc where created_at >= p_desde and created_at < p_hasta), 0)
                     + coalesce((select sum(gemas_usadas) from vr where created_at >= p_desde and created_at < p_hasta), 0),
    'gemas_canjeadas_soles', coalesce((select sum(gemas_monto) from vc where created_at >= p_desde and created_at < p_hasta), 0)
                           + coalesce((select sum(gemas_monto) from vr where created_at >= p_desde and created_at < p_hasta), 0),

    'serie_dias', coalesce((
      select jsonb_agg(jsonb_build_object('dia', d.dia, 'viajes', d.viajes, 'entregas', d.entregas) order by d.dia)
        from (
          select dia, sum(viajes) as viajes, sum(entregas) as entregas from (
            select to_char(hasta at time zone 'America/Lima', 'YYYY-MM-DD') as dia, viajes, 0 as entregas
              from tu where hasta >= p_desde
            union all
            select to_char(entregado_at at time zone 'America/Lima', 'YYYY-MM-DD'), 0, 1
              from public.entregas where estado = 'entregado' and entregado_at >= p_desde and entregado_at < p_hasta
          ) x group by dia
        ) d), '[]'::jsonb),

    'serie_ingresos', coalesce((
      select jsonb_agg(jsonb_build_object('mes', m.mes, 'conductores', m.c, 'recolectores', m.r) order by m.mes)
        from (
          select mes, sum(c) as c, sum(r) as r from (
            select to_char(created_at at time zone 'America/Lima', 'YYYY-MM') as mes, monto as c, 0 as r from vc
            union all
            select to_char(created_at at time zone 'America/Lima', 'YYYY-MM'), 0, monto from vr
          ) x
          where mes >= to_char((now() at time zone 'America/Lima') - interval '5 months', 'YYYY-MM')
          group by mes
        ) m), '[]'::jsonb),

    -- Promedio de conductores conectados por día de la semana (0 = domingo) y hora.
    'horas_pico', coalesce((
      select jsonb_agg(jsonb_build_object('dow', q.dow, 'hora', q.hora, 'conductores',
               round(q.n::numeric / greatest(1, (
                 select count(*) from generate_series(
                   date_trunc('day', p_desde at time zone 'America/Lima'),
                   date_trunc('day', v_fin at time zone 'America/Lima'), interval '1 day') g
                  where extract(dow from g)::int = q.dow)), 2)))
        from (
          select extract(dow from s.slot)::int as dow, extract(hour from s.slot)::int as hora,
                 count(distinct (s.conductor_id, s.slot)) as n
            from (
              select cx.conductor_id, generate_series(
                       date_trunc('hour', cx.ini at time zone 'America/Lima'),
                       (cx.fin at time zone 'America/Lima') - interval '1 second', interval '1 hour') as slot
                from cx where cx.fin > cx.ini
            ) s
           group by 1, 2
        ) q), '[]'::jsonb),

    -- Zonas de entrega agrupadas (celdas de ~0.005°).
    'zonas', coalesce((
      select jsonb_agg(jsonb_build_object('lat', z.lat, 'lng', z.lng, 'total', z.total, 'entregadas', z.ok))
        from (
          select round(entrega_lat / 0.005) * 0.005 as lat, round(entrega_lng / 0.005) * 0.005 as lng,
                 count(*) as total, count(*) filter (where estado = 'entregado') as ok
            from en
           where creado_at >= p_desde and entrega_lat is not null and entrega_lng is not null
           group by 1, 2
        ) z), '[]'::jsonb),

    'top_conductores', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.conductor_id, 'nombre', c.nombre, 'foto_url', c.foto_url,
                                          'viajes', t.viajes, 'entregas', t.entregas, 'ganado', t.ganado)
                       order by t.viajes + t.entregas desc, t.ganado desc)
        from (
          select conductor_id, sum(viajes) as viajes, sum(entregas) as entregas,
                 sum(ganado_viajes + ganado_envios) as ganado
            from tu where hasta >= p_desde
           group by conductor_id
           having sum(viajes) + sum(entregas) > 0
           order by sum(viajes) + sum(entregas) desc, sum(ganado_viajes + ganado_envios) desc
           limit 5
        ) t join public.conductores c on c.id = t.conductor_id), '[]'::jsonb),

    'top_recolectores', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.recolector_id, 'nombre', u.nombre, 'foto_url', u.foto_url,
                                          'conductores', t.conductores, 'monto', t.monto,
                                          'cupo', coalesce(u.membresia_cupo, 0),
                                          'usado', public.taxi__cupo_usado_recolector(u.id))
                       order by t.conductores desc, t.monto desc)
        from (
          select recolector_id, count(distinct conductor_id) as conductores, sum(monto) as monto
            from vc
           where recolector_id is not null and created_at >= p_desde and created_at < p_hasta
           group by recolector_id
           order by count(distinct conductor_id) desc, sum(monto) desc
           limit 5
        ) t join public.usuarios u on u.id = t.recolector_id), '[]'::jsonb),

    'vencen', coalesce((
      select jsonb_agg(x order by x->>'vence')
        from (
          select jsonb_build_object('id', c.id, 'tipo', 'conductor', 'nombre', c.nombre, 'telefono', c.telefono,
                                    'vence', c.vencimiento_suscripcion, 'paquete', p.nombre, 'precio', p.precio) as x
            from public.conductores c
            left join public.paquetes p on p.id::text = c.membresia_paquete_id::text
           where c.vencimiento_suscripcion >= now() and c.vencimiento_suscripcion < now() + interval '7 days'
          union all
          select jsonb_build_object('id', u.id, 'tipo', 'recolector', 'nombre', u.nombre, 'telefono', u.telefono,
                                    'vence', u.membresia_vencimiento, 'paquete', pr.nombre, 'precio', pr.precio)
            from public.usuarios u
            left join public.paquetes_recolectores pr on pr.id::text = u.membresia_paquete_id::text
           where u.rol = 'recolector'
             and u.membresia_vencimiento >= now() and u.membresia_vencimiento < now() + interval '7 days'
        ) v), '[]'::jsonb)
  ) || jsonb_build_object(
    'ingresos_conductores_ant', coalesce((select sum(monto) from vc where created_at >= v_ant and created_at < p_desde), 0),
    'ingresos_recolectores_ant', coalesce((select sum(monto) from vr where created_at >= v_ant and created_at < p_desde), 0),
    'membresias_conductores', (select count(*) from vc where created_at >= p_desde and created_at < p_hasta),
    'membresias_recolectores', (select count(*) from vr where created_at >= p_desde and created_at < p_hasta),
    'mrr', coalesce((select sum(monto / dias * 30) from (select monto, dias, created_at from vc union all select monto, dias, created_at from vr) m
                      where m.created_at <= v_fin and m.created_at + m.dias * interval '1 day' > v_fin), 0),
    'mrr_ant', coalesce((select sum(monto / dias * 30) from (select monto, dias, created_at from vc union all select monto, dias, created_at from vr) m
                          where m.created_at <= p_desde and m.created_at + m.dias * interval '1 day' > p_desde), 0),
    'bajas', (select count(*) from public.conductores
               where vencimiento_suscripcion >= p_desde and vencimiento_suscripcion < v_fin)
           + (select count(*) from public.usuarios
               where rol = 'recolector' and membresia_vencimiento >= p_desde and membresia_vencimiento < v_fin),
    'base_bajas', (select count(*) from public.conductores where vencimiento_suscripcion > p_desde)
                + (select count(*) from public.usuarios where rol = 'recolector' and membresia_vencimiento > p_desde),
    'estados_conductores', (
      select jsonb_build_object(
        'vigente', count(*) filter (where vencimiento_suscripcion > now() + interval '7 days'),
        'por_vencer', count(*) filter (where vencimiento_suscripcion > now() and vencimiento_suscripcion <= now() + interval '7 days'),
        'vencida', count(*) filter (where vencimiento_suscripcion <= now()),
        'sin', count(*) filter (where vencimiento_suscripcion is null))
        from public.conductores),
    'estados_recolectores', (
      select jsonb_build_object(
        'vigente', count(*) filter (where membresia_vencimiento > now() + interval '7 days'),
        'por_vencer', count(*) filter (where membresia_vencimiento > now() and membresia_vencimiento <= now() + interval '7 days'),
        'vencida', count(*) filter (where membresia_vencimiento <= now()),
        'sin', count(*) filter (where membresia_vencimiento is null))
        from public.usuarios where rol = 'recolector')
  ) into v_out;

  return v_out;
end;
$$;
revoke execute on function public.taxi_dashboard_admin(timestamptz, timestamptz) from public, anon;
grant execute on function public.taxi_dashboard_admin(timestamptz, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
