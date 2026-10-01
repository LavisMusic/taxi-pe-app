-- =========================================================================
-- Bug: el saldo del cliente nunca aparecía en Caja Tonazo para quien
-- tenía la membresía gratis de registro. Causa: trg_emitir_saldo_pasajero
-- (20260924100000) corría solo AFTER UPDATE, pero la membresía de 60
-- días nace en el INSERT del pasajero (trg_membresia_gratis_pasajero,
-- 20260925100000, BEFORE INSERT) — ese valor nunca se espejaba a Caja.
--
-- 1) El emisor ahora corre también AFTER INSERT (si trae saldo). Cubre
--    el alta desde Caja (create-cliente crea la fila en Caja ANTES de
--    espejar hacia acá, así que el evento ya encuentra dónde guardarse).
--    El alta desde Taxi-PE lo cubre mirror-a-caja, que manda el saldo
--    junto con la cuenta (acá el INSERT ocurre antes de que exista la
--    fila en Caja).
-- 2) Reenvío único del saldo vigente de todos los pasajeros que ya
--    existen — sin esto, los registrados hasta hoy seguirían sin saldo
--    en Caja hasta su próxima recarga.
--
-- Proyecto: Taxi-PE. Idempotente (el reenvío repetido solo reescribe el
-- mismo valor en Caja).
-- =========================================================================

create or replace function public.fn_emitir_saldo_pasajero()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rol <> 'pasajero' or new.telefono is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.creditos_disponibles is not distinct from old.creditos_disponibles
     and new.membresia_vencimiento is not distinct from old.membresia_vencimiento then
    return new;
  end if;
  if tg_op = 'INSERT'
     and new.membresia_vencimiento is null
     and coalesce(new.creditos_disponibles, 0) = 0 then
    return new;
  end if;
  begin
    perform public.fn_webhook_emitir(
      'taxi.saldo_pasajero', 'caja',
      jsonb_build_object(
        'telefono', new.telefono,
        'creditos_disponibles', new.creditos_disponibles,
        'membresia_vencimiento', new.membresia_vencimiento
      )
    );
  exception when others then
    raise warning 'fn_emitir_saldo_pasajero: webhook no emitido: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_emitir_saldo_pasajero on public.usuarios;
create trigger trg_emitir_saldo_pasajero
  after insert or update on public.usuarios
  for each row execute function public.fn_emitir_saldo_pasajero();

do $$
declare
  r record;
begin
  for r in
    select telefono, creditos_disponibles, membresia_vencimiento
    from public.usuarios
    where rol = 'pasajero'
      and telefono is not null
      and (membresia_vencimiento > now() or coalesce(creditos_disponibles, 0) > 0)
  loop
    begin
      perform public.fn_webhook_emitir(
        'taxi.saldo_pasajero', 'caja',
        jsonb_build_object(
          'telefono', r.telefono,
          'creditos_disponibles', r.creditos_disponibles,
          'membresia_vencimiento', r.membresia_vencimiento
        )
      );
    exception when others then
      raise warning 'reenvío de saldo para % falló: %', r.telefono, sqlerrm;
    end;
  end loop;
end $$;
