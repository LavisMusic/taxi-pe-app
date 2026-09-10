-- =========================================================================
-- Delivery — el cajero ve el estado de sus ofertas (para saber quién
-- aceptó / rechazó / sigue pendiente). Ver DELIVERY.md §7.
-- Idempotente.
-- =========================================================================

create or replace function public.rpc_entrega_ofertas_de_entrega(p_session_token uuid)
returns table (
  conductor_id     uuid,
  conductor_nombre text,
  estado           text,
  created_at       timestamptz,
  resuelta_at      timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select o.conductor_id, c.nombre, o.estado, o.created_at, o.resuelta_at
  from public.entrega_ofertas o
  join public.entregas e on e.id = o.entrega_id
  left join public.conductores c on c.id = o.conductor_id
  where e.session_token = p_session_token
  order by o.created_at;
$$;

grant execute on function public.rpc_entrega_ofertas_de_entrega(uuid) to anon, authenticated;
