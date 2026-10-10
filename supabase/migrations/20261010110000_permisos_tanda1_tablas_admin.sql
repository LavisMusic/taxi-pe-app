-- =========================================================================
-- Seguridad, fase 2B — tanda 1: tablas que solo cambia el Admin.
--
-- anuncios, descripciones_app, planes, paquetes, paquetes_clientes,
-- paquetes_recolectores, configuracion_paquetes, localidades, categorias
-- y subgrupos:
--   * LEER: todos (con o sin sesión), igual que antes.
--   * CREAR / CAMBIAR / BORRAR: solo con la sesión real del Admin (rol
--     'admin' en app_metadata, ver 20261010100000_sesiones_reales.sql).
-- Se borran TODAS las políticas abiertas que tenían (algunas repetidas) y
-- se activa RLS donde faltaba (categorias, localidades). Las funciones de
-- la base (security definer) y el servidor (service_role) siguen
-- pudiendo escribir como antes.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ¿La sesión de esta consulta es la del Admin?
create or replace function public.taxi_es_admin()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'rol', '') = 'admin';
$$;
grant execute on function public.taxi_es_admin() to anon, authenticated;

do $$
declare
  v_tabla text;
  v_pol   record;
begin
  foreach v_tabla in array array[
    'anuncios', 'descripciones_app', 'planes', 'paquetes', 'paquetes_clientes',
    'paquetes_recolectores', 'configuracion_paquetes', 'localidades', 'categorias', 'subgrupos'
  ]
  loop
    if to_regclass('public.' || v_tabla) is null then
      raise notice 'No existe la tabla %, se salta.', v_tabla;
      continue;
    end if;

    for v_pol in select policyname from pg_policies where schemaname = 'public' and tablename = v_tabla loop
      execute format('drop policy %I on public.%I', v_pol.policyname, v_tabla);
    end loop;

    execute format('alter table public.%I enable row level security', v_tabla);
    execute format('create policy %I on public.%I for select to anon, authenticated using (true)', v_tabla || '_leer', v_tabla);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.taxi_es_admin()) with check (public.taxi_es_admin())',
      v_tabla || '_admin', v_tabla
    );
    -- Sin sesión no se escribe ni se vacía la tabla.
    execute format('revoke insert, update, delete, truncate on public.%I from anon', v_tabla);
    execute format('revoke truncate on public.%I from authenticated', v_tabla);
  end loop;
end;
$$;
