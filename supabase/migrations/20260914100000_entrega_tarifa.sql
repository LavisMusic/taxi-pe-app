-- =========================================================================
-- Tarifa de envío: lo que la Caja le paga al repartidor por hacer la
-- entrega (aparte del valor del pedido, que se lo cobra el repartidor
-- al cliente en el mostrador — ver DELIVERY.md §5). El cajero la carga
-- en el modal de "Asignar repartidor" ANTES de ofertar; el repartidor
-- la ve en la oferta antes de aceptar/rechazar, y queda en la boleta.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.entregas
  add column if not exists tarifa numeric;

-- 1) Ofertar: ahora recibe la tarifa. La graba en la entrega la primera
--    vez (o si cambia) y avisa por el chat cajero-conductor — así queda
--    un registro directo en la conversación, visible para cualquier
--    repartidor que termine aceptando esta entrega.
--    (drop primero: agregar un parámetro cambia la firma — 'create or
--    replace' con un parámetro nuevo crea un OVERLOAD aparte en vez de
--    reemplazar la función vieja de 2 argumentos.)
drop function if exists public.rpc_entrega_ofertar(uuid, uuid);
create or replace function public.rpc_entrega_ofertar(
  p_session_token uuid,
  p_conductor_id  uuid,
  p_tarifa        numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid; v_estado text;
  v_tarifa_previa numeric; v_direccion text; v_sucursal text; v_total numeric;
begin
  v_id := public.fn_entrega_por_token(p_session_token);
  if v_id is null then return jsonb_build_object('status', 'token_invalido'); end if;

  select estado, tarifa, direccion_entrega, caja_sucursal, total
    into v_estado, v_tarifa_previa, v_direccion, v_sucursal, v_total
  from public.entregas where id = v_id;
  if v_estado is distinct from 'buscando' then
    return jsonb_build_object('status', 'estado_invalido', 'estado', v_estado);
  end if;

  if p_tarifa is not null and p_tarifa is distinct from v_tarifa_previa then
    update public.entregas set tarifa = p_tarifa, actualizado_at = now() where id = v_id;
    insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
    values (
      v_id, 'cajero_conductor', 'sistema',
      format(
        '📦 Nueva oferta de reparto: %s · Sucursal %s · Monto del pedido S/ %s · Tarifa de envío S/ %s',
        coalesce(v_direccion, 'sin dirección'),
        coalesce(v_sucursal, '-'),
        trim(to_char(coalesce(v_total, 0), '999999990.00')),
        trim(to_char(p_tarifa, '999999990.00'))
      )
    );
  end if;

  insert into public.entrega_ofertas (entrega_id, conductor_id)
  values (v_id, p_conductor_id)
  on conflict (entrega_id, conductor_id) do update
    set estado = 'pendiente', resuelta_at = null
    where public.entrega_ofertas.estado in ('rechazada', 'cerrada');

  return jsonb_build_object('status', 'ok');
end;
$$;

grant execute on function public.rpc_entrega_ofertar(uuid, uuid, numeric) to anon, authenticated;

-- 2) El repartidor ve la tarifa en la oferta ANTES de aceptar/rechazar.
--    (drop primero: agregar una columna a RETURNS TABLE también cambia
--    el tipo de retorno.)
drop function if exists public.rpc_entrega_ofertas_conductor(uuid);
create or replace function public.rpc_entrega_ofertas_conductor(p_conductor_id uuid)
returns table (
  oferta_id uuid, entrega_id uuid, cliente_nombre text, direccion_entrega text,
  caja_sucursal text, total numeric, tarifa numeric, items jsonb, creado_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select o.id, e.id, e.cliente_nombre, e.direccion_entrega,
         e.caja_sucursal, e.total, e.tarifa, e.items, e.creado_at
  from public.entrega_ofertas o
  join public.entregas e on e.id = o.entrega_id
  where o.conductor_id = p_conductor_id
    and o.estado = 'pendiente'
    and e.estado = 'buscando'
  order by e.creado_at;
$$;

grant execute on function public.rpc_entrega_ofertas_conductor(uuid) to anon, authenticated;

-- 3) rpc_entrega_estado: suma la tarifa (vista en vivo del cajero/cliente
--    + para la boleta).
drop function if exists public.rpc_entrega_estado(uuid);
create or replace function public.rpc_entrega_estado(p_session_token uuid)
returns table (
  id uuid, estado text, conductor_id uuid, conductor_nombre text, conductor_placa text,
  cliente_nombre text, direccion_entrega text, caja_sucursal text,
  items jsonb, total numeric, tarifa numeric, pin text,
  entrega_lat numeric, entrega_lng numeric,
  origen_lat numeric, origen_lng numeric,
  repartidor_lat numeric, repartidor_lng numeric, repartidor_pos_at timestamptz,
  aceptado_at timestamptz, retirado_at timestamptz, entregado_at timestamptz, actualizado_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select e.id, e.estado, e.conductor_id, c.nombre, c.placa,
         e.cliente_nombre, e.direccion_entrega, e.caja_sucursal,
         e.items, e.total, e.tarifa, e.pin,
         e.entrega_lat, e.entrega_lng,
         e.origen_lat, e.origen_lng,
         e.repartidor_lat, e.repartidor_lng, e.repartidor_pos_at,
         e.aceptado_at, e.retirado_at, e.entregado_at, e.actualizado_at
  from public.entregas e
  left join public.conductores c on c.id = e.conductor_id
  where e.session_token = p_session_token;
$$;

grant execute on function public.rpc_entrega_estado(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
