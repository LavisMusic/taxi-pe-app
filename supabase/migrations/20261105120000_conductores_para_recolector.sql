  -- =========================================================================
  -- El recolector ya no ve el teléfono de los conductores (revisión de
  -- seguridad 2026-11-05, P1-D, segunda parte).
  --
  -- La regla conductores_leer le dejaba al recolector leer la tabla entera
  -- de conductores, con el teléfono (y la última ubicación) de todos. En
  -- Postgres no se puede ocultar una columna solo para un rol de la app
  -- (todos los que tienen sesión son el mismo rol de base de datos), así que
  -- el recolector deja de leer la tabla y recibe su lista por
  -- taxi_conductores_para_recolector: lo que usa la recarga (nombre, placa,
  -- foto, categoría, saldo, estado...) SIN teléfono, DNI, fotos de
  -- verificación ni ubicación. El Admin y el propio conductor siguen leyendo
  -- la tabla como siempre.
  --
  -- Proyecto: Taxi-PE. Idempotente.
  -- =========================================================================
  
  drop policy if exists conductores_leer on public.conductores;
  create policy conductores_leer on public.conductores for select to authenticated
    using (
      public.taxi_es_admin()
      or telefono = public.taxi_mi_telefono_conductor()
    );
  
  create or replace function public.taxi_conductores_para_recolector()
  returns setof jsonb
  language sql
  stable
  security definer
  set search_path = public
  as $$
    select to_jsonb(c)
           - 'telefono' - 'dni'
           - 'foto_general_url' - 'foto_interior_url' - 'foto_conductor_dni_url'
           - 'ultima_lat' - 'ultima_lng'
    from public.conductores c
    where public.taxi_rol() = 'recolector' or public.taxi_es_admin()
    order by c.created_at desc;
  $$;
  revoke execute on function public.taxi_conductores_para_recolector() from public, anon;
  grant execute on function public.taxi_conductores_para_recolector() to authenticated;
  
  notify pgrst, 'reload schema';
