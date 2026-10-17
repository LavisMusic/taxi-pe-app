-- =========================================================================
-- Turno de caja: cierre tarde en la noche y límite de extensiones.
--
--   * Si el turno empieza en las últimas 3 horas antes de la medianoche
--     (cerró el anterior desde las 21:00, hora de Perú), su cierre es la
--     medianoche del DÍA SIGUIENTE — antes vencía a las 00:00 de esa
--     misma noche, minutos después de abrirse, y el aviso salía todo el
--     día siguiente.
--   * Extensiones de 30 min: el recolector hasta 3, el Admin hasta 5 por
--     turno. Se cuentan en taxi_turnos.extensiones y se reinician al
--     cerrar. Agotadas, solo queda cerrar el turno.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.taxi_turnos add column if not exists extensiones integer not null default 0;

create or replace function public.taxi_vence_turno(p_desde timestamptz)
returns timestamptz
language sql
immutable
as $$
  select ((date_trunc('day', (p_desde at time zone 'America/Lima') + interval '3 hours') + interval '1 day')
          at time zone 'America/Lima');
$$;

create or replace function public.taxi_max_extensiones()
returns integer
language sql
stable
set search_path = public
as $$
  select case when public.taxi_es_admin() then 5 else 3 end;
$$;

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
  v_vence := public.taxi_vence_turno(v_desde);
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

create or replace function public.taxi_extender_turno()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dueno text := public.taxi_dueno_caja();
  v_n     integer;
begin
  if v_dueno is null then
    return jsonb_build_object('estado', 'sin_permiso');
  end if;
  select extensiones into v_n from public.taxi_turnos where dueno = v_dueno for update;
  if coalesce(v_n, 0) >= public.taxi_max_extensiones() then
    return jsonb_build_object('estado', 'limite') || public.taxi_estado_caja();
  end if;
  insert into public.taxi_turnos (dueno, extendido_hasta, extensiones) values (v_dueno, now() + interval '30 minutes', 1)
  on conflict (dueno) do update
    set extendido_hasta = greatest(now(), coalesce(public.taxi_turnos.extendido_hasta, now())) + interval '30 minutes',
        extensiones = public.taxi_turnos.extensiones + 1;
  return jsonb_build_object('estado', 'ok') || public.taxi_estado_caja();
end;
$$;

revoke execute on function public.taxi_max_extensiones() from public, anon;
grant execute on function public.taxi_max_extensiones() to authenticated;
