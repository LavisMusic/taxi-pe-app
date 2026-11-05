-- =========================================================================
-- La tabla `conductores` deja de ser pública (segunda parte de
-- 20261104110000, P0 #5).
--
-- Correr SOLO cuando la web nueva (que lee la vista conductores_publicos)
-- ya esté publicada en Vercel: la versión anterior leía la tabla directo.
--
-- Quedan: el propio conductor, el Admin y el recolector (política
-- conductores_leer); lo público sale de la vista.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

drop policy if exists conductores_publicos on public.conductores;

-- Sin sesión no se lee ninguna columna de la tabla.
do $$
declare
  v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into v_cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'conductores';
  execute format('revoke select (%s) on public.conductores from anon', v_cols);
end $$;
revoke select on public.conductores from anon;

notify pgrst, 'reload schema';
