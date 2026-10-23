-- =========================================================================
-- Seguridad, fase 2B — tanda 2: dinero, operación y peticiones.
--
--   * webhook_inbox / webhook_outbox: solo el servidor y las funciones de
--     la base (la app no las usa).
--   * ventas: el Admin todo; cada recolector ve, registra y anula SOLO
--     sus propias ventas (recolector_id = su id).
--   * fiados_conductores: el Admin todo; el recolector solo los fiados
--     de SUS ventas (los crea al registrar una recarga fiada y los anula
--     al anular la venta).
--   * peticiones_recarga_recolector: el Admin todo; cada recolector ve
--     las suyas y solo puede crearlas en 'pendiente'.
--   * gastos_operativos: leen Admin y recolectores (el cierre de turno
--     los descuenta); solo el Admin los cambia.
--   * pagos_fiados_conductores: solo el Admin.
--   * peticiones_pin: cualquiera puede CREAR una (la recuperación es para
--     quien no puede entrar); leer y cambiar, solo el Admin. La página
--     /recuperar-pin consulta su estado con taxi_peticion_pin_estado, que
--     no devuelve datos personales.
--
-- Las funciones de la base (security definer) y el servidor
-- (service_role) siguen pudiendo escribir como antes.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- Rol de la sesión (app_metadata) — ver 20261010100000_sesiones_reales.sql.
create or replace function public.taxi_rol()
returns text
language sql
stable
set search_path = public
as $$
  select auth.jwt() -> 'app_metadata' ->> 'rol';
$$;
grant execute on function public.taxi_rol() to anon, authenticated;

-- Borra todas las políticas de una tabla y activa RLS.
create or replace function public.taxi_reiniciar_politicas(p_tabla text)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_pol record;
begin
  for v_pol in select policyname from pg_policies where schemaname = 'public' and tablename = p_tabla loop
    execute format('drop policy %I on public.%I', v_pol.policyname, p_tabla);
  end loop;
  execute format('alter table public.%I enable row level security', p_tabla);
  execute format('revoke truncate on public.%I from anon, authenticated', p_tabla);
end;
$$;
revoke execute on function public.taxi_reiniciar_politicas(text) from public, anon, authenticated;

-- ---------- Colas de webhooks: solo el servidor ---------------------------
revoke all on public.webhook_inbox, public.webhook_outbox from anon, authenticated;

-- ---------- ventas ---------------------------------------------------------
select public.taxi_reiniciar_politicas('ventas');
revoke insert, update, delete on public.ventas from anon;
create policy ventas_admin on public.ventas for all to authenticated
  using (public.taxi_es_admin()) with check (public.taxi_es_admin());
create policy ventas_recolector_leer on public.ventas for select to authenticated
  using (public.taxi_rol() = 'recolector' and recolector_id = auth.uid());
create policy ventas_recolector_crear on public.ventas for insert to authenticated
  with check (public.taxi_rol() = 'recolector' and recolector_id = auth.uid());
create policy ventas_recolector_anular on public.ventas for update to authenticated
  using (public.taxi_rol() = 'recolector' and recolector_id = auth.uid())
  with check (public.taxi_rol() = 'recolector' and recolector_id = auth.uid());
revoke select on public.ventas from anon;

-- ---------- fiados_conductores ---------------------------------------------
select public.taxi_reiniciar_politicas('fiados_conductores');
revoke select, insert, update, delete on public.fiados_conductores from anon;
create policy fiados_conductores_admin on public.fiados_conductores for all to authenticated
  using (public.taxi_es_admin()) with check (public.taxi_es_admin());
create policy fiados_conductores_recolector on public.fiados_conductores for all to authenticated
  using (
    public.taxi_rol() = 'recolector'
    and exists (select 1 from public.ventas v where v.id = venta_id and v.recolector_id = auth.uid())
  )
  with check (
    public.taxi_rol() = 'recolector'
    and exists (select 1 from public.ventas v where v.id = venta_id and v.recolector_id = auth.uid())
  );

-- ---------- peticiones_recarga_recolector ----------------------------------
select public.taxi_reiniciar_politicas('peticiones_recarga_recolector');
revoke select, insert, update, delete on public.peticiones_recarga_recolector from anon;
create policy peticiones_recarga_admin on public.peticiones_recarga_recolector for all to authenticated
  using (public.taxi_es_admin()) with check (public.taxi_es_admin());
create policy peticiones_recarga_recolector_leer on public.peticiones_recarga_recolector for select to authenticated
  using (public.taxi_rol() = 'recolector' and recolector_id = auth.uid());
create policy peticiones_recarga_recolector_crear on public.peticiones_recarga_recolector for insert to authenticated
  with check (public.taxi_rol() = 'recolector' and recolector_id = auth.uid() and estado = 'pendiente');

-- ---------- gastos_operativos ----------------------------------------------
select public.taxi_reiniciar_politicas('gastos_operativos');
revoke select, insert, update, delete on public.gastos_operativos from anon;
create policy gastos_operativos_admin on public.gastos_operativos for all to authenticated
  using (public.taxi_es_admin()) with check (public.taxi_es_admin());
create policy gastos_operativos_recolector_leer on public.gastos_operativos for select to authenticated
  using (public.taxi_rol() = 'recolector');

-- ---------- pagos_fiados_conductores ---------------------------------------
select public.taxi_reiniciar_politicas('pagos_fiados_conductores');
revoke select, insert, update, delete on public.pagos_fiados_conductores from anon;
create policy pagos_fiados_conductores_admin on public.pagos_fiados_conductores for all to authenticated
  using (public.taxi_es_admin()) with check (public.taxi_es_admin());

-- ---------- peticiones_pin --------------------------------------------------
select public.taxi_reiniciar_politicas('peticiones_pin');
revoke select, update, delete on public.peticiones_pin from anon;
create policy peticiones_pin_crear on public.peticiones_pin for insert to anon, authenticated
  with check (coalesce(estado, 'pendiente') = 'pendiente');
create policy peticiones_pin_admin on public.peticiones_pin for all to authenticated
  using (public.taxi_es_admin()) with check (public.taxi_es_admin());

-- Estado de la petición abierta (no resuelta) de un DNI, sin datos
-- personales: { id, estado } o null.
create or replace function public.taxi_peticion_pin_estado(p_dni text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object('id', id, 'estado', estado)
  from public.peticiones_pin
  where dni = trim(p_dni) and estado <> 'resuelto'
  order by created_at desc
  limit 1;
$$;
grant execute on function public.taxi_peticion_pin_estado(text) to anon, authenticated;
