-- =========================================================================
-- Avisar a Caja cuando un repartidor ACEPTA la entrega (estado 'aceptado').
-- Caja (webhook-taxi-entrega-estado) manda entonces al cliente, por el chat
-- de la tienda, la boleta ya con el repartidor asignado.
--
-- Trigger aparte (no toca rpc_entrega_aceptar): cualquier paso de
-- 'buscando' a 'aceptado' avisa. Si se reasigna, Caja no repite la boleta.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.fn_entrega_aceptada_avisar_caja()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'aceptado' and old.estado is distinct from 'aceptado' then
    begin
      perform public.fn_entrega_avisar_caja(new.id, 'aceptado');
    exception when others then
      raise warning 'fn_entrega_aceptada_avisar_caja: %', sqlerrm;
    end;
  end if;
  return null;
end;
$$;
revoke execute on function public.fn_entrega_aceptada_avisar_caja() from public, anon, authenticated;

drop trigger if exists trg_entrega_aceptada_avisar_caja on public.entregas;
create trigger trg_entrega_aceptada_avisar_caja
  after update of estado on public.entregas
  for each row execute function public.fn_entrega_aceptada_avisar_caja();

notify pgrst, 'reload schema';
