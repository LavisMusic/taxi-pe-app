-- =========================================================================
-- Destacados (solo en el panel del admin, para priorizar su atención).
--
-- conductores.destacado: null = automático (membresía de 60 días o más y
-- vigente), true / false = lo decidió el admin. Solo el admin lo cambia
-- (el conductor puede editar su ficha, pero no destacarse a sí mismo).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.conductores add column if not exists destacado boolean;

create or replace function public.fn_conductor_destacado_solo_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.destacado is distinct from OLD.destacado and not public.taxi_es_admin() then
    NEW.destacado := OLD.destacado;
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_conductor_destacado_solo_admin on public.conductores;
create trigger trg_conductor_destacado_solo_admin
  before update on public.conductores
  for each row execute function public.fn_conductor_destacado_solo_admin();

notify pgrst, 'reload schema';
