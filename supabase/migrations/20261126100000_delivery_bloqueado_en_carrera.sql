-- =========================================================================
-- El modo delivery tampoco se apaga en pleno viaje (Taxi-PE).
--
-- Igual que el switch de taxi en carrera y que el delivery con repartos
-- pendientes: si el conductor tiene un viaje aceptado o en curso
-- (taxi_conductor_en_carrera), no puede apagar el modo delivery hasta
-- terminarlo. Lo hecho por la base (funciones security definer, crons) no
-- pasa por acá.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.fn_conductores_repartiendo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.taxi_es_admin() then
    if coalesce(old.modo_delivery, false) and not coalesce(new.modo_delivery, false) then
      if public.taxi_conductor_repartos_activos(new.id) > 0 then
        raise exception 'Tienes repartos pendientes: entrégalos antes de apagar el modo delivery.'
          using errcode = '22023';
      end if;
      if public.taxi_conductor_en_carrera(new.id) then
        raise exception 'Estás en un viaje: termínalo antes de apagar el modo delivery.'
          using errcode = '22023';
      end if;
    end if;
    if new.estado in ('activo', 'ocupado') and new.estado is distinct from old.estado
       and public.taxi_conductor_repartos_activos(new.id) > 0 then
      raise exception 'Estás repartiendo: termina tus repartos para recibir pasajeros.'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
