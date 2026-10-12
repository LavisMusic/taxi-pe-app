-- =========================================================================
-- Aviso público "cambió el conductor X" (complemento de la tanda 3b).
--
-- Desde la 3b el público (sin sesión y pasajero) solo ve las filas de los
-- conductores conectados con saldo. Cuando uno se desconecta, su fila deja
-- de ser visible y Supabase Realtime ya no le avisa al público — el
-- directorio lo seguía mostrando hasta recargar. Este trigger manda un
-- aviso por el canal público 'conductores-publico' (solo el id, ningún
-- dato) cada vez que cambia algo que decide si se ve en el directorio;
-- la app lo escucha y vuelve a pedir la lista.
--
-- Si realtime.send no estuviera disponible, el cambio se guarda igual y
-- solo se pierde el aviso.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.fn_conductores_aviso_publico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := coalesce(new.id, old.id);
begin
  if tg_op = 'UPDATE'
     and new.estado is not distinct from old.estado
     and new.aprobado is not distinct from old.aprobado
     and new.creditos is not distinct from old.creditos
     and new.vencimiento_suscripcion is not distinct from old.vencimiento_suscripcion then
    return null;
  end if;
  begin
    perform realtime.send(jsonb_build_object('id', v_id), 'cambio', 'conductores-publico', false);
  exception when others then
    null;
  end;
  return null;
end;
$$;

drop trigger if exists trg_conductores_aviso_publico on public.conductores;
create trigger trg_conductores_aviso_publico
  after insert or update or delete on public.conductores
  for each row execute function public.fn_conductores_aviso_publico();
