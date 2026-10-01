-- =========================================================================
-- 2 meses de membresía gratis al registrarse (conductor y pasajero/
-- cliente). Trigger BEFORE INSERT en vez de tocarlo en cada flujo de
-- alta por separado (registro exprés de pasajero, alta desde el
-- Admin/Recolector, espejo de Caja al mirrorear un cliente nuevo) —
-- así cubre TODOS los caminos de una sola vez, sin tener que acordarse
-- de agregarlo si mañana aparece un cuarto lugar donde se crea una
-- fila nueva.
--
-- Solo pisa el vencimiento si viene NULL — si algún alta ya lo trae
-- seteado a propósito (no debería pasar hoy, pero por las dudas) no lo
-- pisa.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.fn_membresia_gratis_conductor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.vencimiento_suscripcion is null then
    new.vencimiento_suscripcion := now() + interval '60 days';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_membresia_gratis_conductor on public.conductores;
create trigger trg_membresia_gratis_conductor
  before insert on public.conductores
  for each row execute function public.fn_membresia_gratis_conductor();

create or replace function public.fn_membresia_gratis_pasajero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rol = 'pasajero' and new.membresia_vencimiento is null then
    new.membresia_vencimiento := now() + interval '60 days';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_membresia_gratis_pasajero on public.usuarios;
create trigger trg_membresia_gratis_pasajero
  before insert on public.usuarios
  for each row execute function public.fn_membresia_gratis_pasajero();
