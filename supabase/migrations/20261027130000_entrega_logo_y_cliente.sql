-- =========================================================================
-- "Tus entregas" del conductor (Mensajes) con caras: el logo del negocio
-- en el chat con la tienda (antes, un ícono de tienda) y la foto y el
-- @usuario del cliente en el suyo.
--
--   * entregas.caja_logo_url: lo manda Caja al crear la entrega
--     (entrega-crear).
--   * rpc_entrega_caras_conductor(p_conductor_id): por cada entrega en curso
--     del conductor, el logo y la foto/usuario del cliente (su cuenta de
--     pasajero, por teléfono: es la misma persona en las dos apps). Mismo
--     criterio de acceso que rpc_entrega_activa_conductor.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.entregas add column if not exists caja_logo_url text;

create or replace function public.rpc_entrega_caras_conductor(p_conductor_id uuid)
returns table (entrega_id uuid, caja_logo_url text, cliente_foto_url text, cliente_usuario text)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.caja_logo_url, u.foto_url, u.nombre_usuario
  from public.entregas e
  left join lateral (
    select foto_url, nombre_usuario
    from public.usuarios
    where telefono = e.cliente_telefono and rol = 'pasajero'
    limit 1
  ) u on true
  where e.conductor_id = p_conductor_id
    and e.estado in ('aceptado', 'en_ruta');
$$;
grant execute on function public.rpc_entrega_caras_conductor(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
