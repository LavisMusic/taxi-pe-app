-- =========================================================================
-- Descripciones bajo el logo también para recolectores.
--
-- descripciones_app.publico acepta 'recolectores' además de 'pasajeros',
-- 'conductores' y 'todos' (en el Admin, "Todos"). Las que ya estaban
-- para 'todos' las ven también los recolectores.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================
alter table public.descripciones_app drop constraint if exists descripciones_app_publico_check;
alter table public.descripciones_app
  add constraint descripciones_app_publico_check
  check (publico in ('pasajeros', 'conductores', 'recolectores', 'todos'));
