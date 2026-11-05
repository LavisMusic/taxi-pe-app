-- =========================================================================
-- Datos y ubicación de conductores (revisión de seguridad 2026-11-04, P0 #5).
--
--   * Antes cualquiera, sin sesión, leía de `conductores` el teléfono, los
--     créditos, el vencimiento, las compras y la ÚLTIMA ubicación de los
--     conductores "activos" — y el estado se quedaba "activo" por semanas,
--     así que se veían ubicaciones viejas (posiblemente sus casas).
--   * Ahora lo público sale de la vista `conductores_publicos`: solo lo
--     que necesitan el directorio y el radar, y la ubicación solo si es de
--     los últimos 20 minutos. Sin teléfono (decisión del dueño), créditos,
--     vencimiento ni compras.
--   * La tabla queda para el propio conductor, el Admin y el recolector
--     (política conductores_leer, sin cambios).
--   * Los pasajeros ya no reciben los cambios de la tabla por Realtime: el
--     aviso público (canal 'conductores-publico') ahora también avisa
--     cuando cambia algo visible del directorio o cuando un conductor
--     vuelve a transmitir su ubicación.
--   * Cada 5 minutos se desconecta solo a quien lleva 20 minutos sin señal.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Vista pública ----------------------------------------------------
-- Corre con los permisos de su dueño (no los del que consulta): por eso
-- puede leer la tabla aunque el público ya no pueda, y por eso filtra acá
-- mismo quién aparece (mismo criterio que la política vieja).
create or replace view public.conductores_publicos
with (security_invoker = false) as
  select
    c.id,
    c.nombre,
    c.placa,
    c.foto_url,
    c.foto_portada_url,
    c.descripcion,
    c.estado,
    c.categoria_id,
    c.subgrupo_id,
    c.localidad,
    c.nivel_servicio,
    c.asientos_totales,
    c.asientos_ocupados,
    c.aprobado,
    c.modo_delivery,
    c.ultima_actualizacion,
    case when c.ultima_actualizacion > now() - interval '20 minutes' then c.ultima_lat end as ultima_lat,
    case when c.ultima_actualizacion > now() - interval '20 minutes' then c.ultima_lng end as ultima_lng
  from public.conductores c
  where c.estado in ('activo', 'ocupado')
    and (coalesce(c.creditos, 0) > 0 or c.vencimiento_suscripcion > now());

revoke all on public.conductores_publicos from public;
grant select on public.conductores_publicos to anon, authenticated;

-- (Cerrar la tabla al público va aparte, en 20261104120000, DESPUÉS de
-- publicar la web nueva: la versión publicada todavía lee la tabla.)

-- ---------- Aviso público de cambios ----------------------------------------
-- Además de lo de antes (estado, aprobación, saldo), avisa cuando cambia
-- algo que el directorio muestra, y cuando un conductor vuelve a
-- transmitir su ubicación después de 2 minutos sin señal (lo que el
-- directorio usa para mostrarlo). No avisa en cada posición: esas viajan
-- por el radar.
create or replace function public.fn_conductores_aviso_publico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(new.id, old.id);
begin
  if tg_op = 'UPDATE'
     and new.estado is not distinct from old.estado
     and new.aprobado is not distinct from old.aprobado
     and new.creditos is not distinct from old.creditos
     and new.vencimiento_suscripcion is not distinct from old.vencimiento_suscripcion
     and new.nombre is not distinct from old.nombre
     and new.placa is not distinct from old.placa
     and new.foto_url is not distinct from old.foto_url
     and new.foto_portada_url is not distinct from old.foto_portada_url
     and new.descripcion is not distinct from old.descripcion
     and new.categoria_id is not distinct from old.categoria_id
     and new.subgrupo_id is not distinct from old.subgrupo_id
     and new.localidad is not distinct from old.localidad
     and new.nivel_servicio is not distinct from old.nivel_servicio
     and new.asientos_totales is not distinct from old.asientos_totales
     and new.asientos_ocupados is not distinct from old.asientos_ocupados
     and new.modo_delivery is not distinct from old.modo_delivery
     and not (
       new.ultima_actualizacion > now() - interval '2 minutes'
       and (old.ultima_actualizacion is null or old.ultima_actualizacion <= now() - interval '2 minutes')
     ) then
    return null;
  end if;
  begin
    perform realtime.send(jsonb_build_object('id', v_id), 'cambio', 'conductores-publico', false);
  exception when others then
    null;
  end;
  return null;
end;
$$;

-- ---------- Desconexión automática -----------------------------------------
-- Quien sigue "activo" sin mandar ubicación hace 20 minutos (cerró la app,
-- se quedó sin señal, apagó el GPS) pasa a "desconectado". La app abierta
-- la vuelve a guardar cada minuto aunque el celular esté quieto
-- (useGpsBroadcaster.js). "Ocupado" con el auto lleno no guarda su
-- ubicación en la base (solo la manda al pasajero del viaje), así que para
-- ese estado el plazo es de 3 horas: nunca se corta una carrera.
create or replace function public.taxi_desconectar_inactivos()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update public.conductores
     set estado = 'desconectado'
   where (estado = 'activo'
          and (ultima_actualizacion is null or ultima_actualizacion < now() - interval '20 minutes'))
      or (estado = 'ocupado'
          and (ultima_actualizacion is null or ultima_actualizacion < now() - interval '3 hours'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.taxi_desconectar_inactivos() from public, anon, authenticated;

select cron.unschedule('conductores-inactivos')
where exists (select 1 from cron.job where jobname = 'conductores-inactivos');
-- Cada 5 minutos.
select cron.schedule('conductores-inactivos', '*/5 * * * *', $$select public.taxi_desconectar_inactivos()$$);

notify pgrst, 'reload schema';
