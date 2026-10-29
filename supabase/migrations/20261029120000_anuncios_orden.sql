-- =========================================================================
-- Orden de los anuncios (carrusel): del más antiguo al más nuevo y
-- reordenables arrastrándolos en el gestor del superadmin (Caja Tonazo,
-- acción 'anuncios.ordenar' de webhook-caja-superadmin). Un anuncio nuevo
-- entra al final: orden = el mayor + 1. Igual que la migración 0126 de Caja.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.fn_anuncios_orden_al_final()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.orden, 0) = 0 then
    select coalesce(max(orden), 0) + 1 into new.orden from public.anuncios;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_anuncios_orden_al_final on public.anuncios;
create trigger trg_anuncios_orden_al_final
  before insert on public.anuncios
  for each row execute function public.fn_anuncios_orden_al_final();
