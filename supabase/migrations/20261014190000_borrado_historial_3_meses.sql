-- =========================================================================
-- Regla de los 3 meses (calendario): lo más antiguo se borra solo, todos
-- los días a las 3:30 a. m. (hora de Perú).
--
--   Se borra (más de 3 meses):
--     * chat_mensajes          — menos las ofertas de un viaje en curso
--                                 (pendiente / aceptada / en tránsito).
--     * entrega_mensajes       — solo de entregas ya cerradas
--                                 (entregado / cancelado / no entregado).
--     * taxi_conductor_turnos  — turnos cerrados hace más de 3 meses.
--     * taxi_conductor_conexiones — tiempos de conexión ya terminados.
--     * ventas de recolectores — nunca una venta ligada a un fiado
--                                 (fiados_conductores), pagado o no.
--     * cierres de recolectores.
--   Se guarda siempre:
--     * ventas y cierres del Admin, fiados, entregas, peticiones.
--
--   Cada pasada queda anotada en taxi_limpiezas (cuántas filas por tabla).
--   Se puede correr a mano: select public.taxi_limpiar_historial_3_meses();
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create table if not exists public.taxi_limpiezas (
  id            bigserial primary key,
  ejecutada_at  timestamptz not null default now(),
  corte         timestamptz not null,
  detalle       jsonb not null
);
alter table public.taxi_limpiezas enable row level security;
revoke all on public.taxi_limpiezas from anon, authenticated;
grant select on public.taxi_limpiezas to authenticated;
drop policy if exists taxi_limpiezas_admin on public.taxi_limpiezas;
create policy taxi_limpiezas_admin on public.taxi_limpiezas for select to authenticated
  using (public.taxi_es_admin());

create or replace function public.taxi_limpiar_historial_3_meses()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corte    timestamptz := now() - interval '3 months';
  v_chat     integer;
  v_entrega  integer;
  v_turnos   integer;
  v_conex    integer;
  v_ventas   integer;
  v_cierres  integer;
  v_detalle  jsonb;
begin
  delete from public.chat_mensajes
  where created_at < v_corte
    and not (tipo = 'oferta' and estado_oferta in ('pendiente', 'aceptada', 'en_transito'));
  get diagnostics v_chat = row_count;

  delete from public.entrega_mensajes m
  using public.entregas e
  where e.id = m.entrega_id
    and m.created_at < v_corte
    and e.estado in ('entregado', 'cancelado', 'no_entregado');
  get diagnostics v_entrega = row_count;

  delete from public.taxi_conductor_turnos where hasta < v_corte;
  get diagnostics v_turnos = row_count;

  delete from public.taxi_conductor_conexiones where fin is not null and fin < v_corte;
  get diagnostics v_conex = row_count;

  delete from public.ventas v
  where v.recolector_id is not null
    and v.created_at < v_corte
    and not exists (select 1 from public.fiados_conductores f where f.venta_id = v.id);
  get diagnostics v_ventas = row_count;

  delete from public.cierres_caja
  where recolector_id is not null
    and not coalesce(es_admin, false)
    and created_at < v_corte;
  get diagnostics v_cierres = row_count;

  v_detalle := jsonb_build_object(
    'chat_mensajes', v_chat,
    'entrega_mensajes', v_entrega,
    'turnos_conductor', v_turnos,
    'conexiones_conductor', v_conex,
    'ventas_recolectores', v_ventas,
    'cierres_recolectores', v_cierres
  );
  insert into public.taxi_limpiezas (corte, detalle) values (v_corte, v_detalle);
  return v_detalle;
end;
$$;
revoke execute on function public.taxi_limpiar_historial_3_meses() from public, anon, authenticated;

select cron.unschedule('borrar-historial-3-meses')
where exists (select 1 from cron.job where jobname = 'borrar-historial-3-meses');
-- 08:30 UTC = 3:30 a. m. en Perú.
select cron.schedule('borrar-historial-3-meses', '30 8 * * *', $$select public.taxi_limpiar_historial_3_meses()$$);

notify pgrst, 'reload schema';
