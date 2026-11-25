-- =========================================================================
-- Destacados (solo en el panel del admin, para priorizar su atención).
--
-- paquetes.destaca: interruptor en Configurar Membresías. Quien tiene
-- vigente una membresía con "Destacado" encendido sale en el subgrupo
-- "Destacados" del directorio del admin. Al crearse la columna se
-- encienden las membresías de 60 días o más (la regla de hoy).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'paquetes' and column_name = 'destaca'
  ) then
    alter table public.paquetes add column destaca boolean not null default false;
    update public.paquetes set destaca = true where coalesce(dias_membresia, 0) >= 60;
  end if;
end $$;

notify pgrst, 'reload schema';
