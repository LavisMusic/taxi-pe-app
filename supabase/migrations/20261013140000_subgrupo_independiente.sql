-- =========================================================================
-- Subgrupo "Independiente" en todas las categorías de vehículo (para el
-- conductor que no pertenece a ninguna empresa o flota). Solo se crea
-- donde todavía no existe.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================
insert into public.subgrupos (categoria_id, nombre, orden)
select c.id, 'Independiente', 0
from public.categorias c
where not exists (
  select 1 from public.subgrupos s
  where s.categoria_id = c.id and lower(trim(s.nombre)) = 'independiente'
);
