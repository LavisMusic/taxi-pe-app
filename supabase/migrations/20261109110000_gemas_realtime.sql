-- =========================================================================
-- Gemas: las cajas del conductor y del recolector se actualizan al
-- instante (Realtime), con el destello cuando entra una gema.
-- Cada uno solo recibe su fila (las políticas de lectura ya lo limitan).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================
do $$
declare
  t text;
begin
  foreach t in array array['taxi_gemas_conductores', 'taxi_gemas_recolectores'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
