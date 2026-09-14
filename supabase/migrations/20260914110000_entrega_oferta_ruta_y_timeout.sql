-- =========================================================================
-- 1) Coordenadas en la oferta: el repartidor puede ver el trayecto
--    (sucursal + punto de entrega) ANTES de aceptar.
-- 2) Timeout de 30s por oferta: si el conductor no responde, se
--    "expira" sola (el cliente que detecta el vencimiento — conductor o
--    cajero, lo que esté mirando la pantalla — llama a
--    rpc_entrega_oferta_expirar) y se avisa por el chat cajero-conductor.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.entrega_ofertas drop constraint if exists entrega_ofertas_estado_check;
alter table public.entrega_ofertas add constraint entrega_ofertas_estado_check check (estado in (
  'pendiente', 'aceptada', 'rechazada', 'cerrada', 'expirada'
));

-- 1) El repartidor ve el trayecto (sucursal + destino) + cuándo se le
--    ofreció (para el conteo regresivo de 30s) en su oferta pendiente.
drop function if exists public.rpc_entrega_ofertas_conductor(uuid);
create or replace function public.rpc_entrega_ofertas_conductor(p_conductor_id uuid)
returns table (
  oferta_id uuid, entrega_id uuid, cliente_nombre text, direccion_entrega text,
  caja_sucursal text, total numeric, tarifa numeric, items jsonb, creado_at timestamptz,
  oferta_creada_at timestamptz,
  entrega_lat numeric, entrega_lng numeric, origen_lat numeric, origen_lng numeric
)
language sql
security definer
set search_path = public
as $$
  select o.id, e.id, e.cliente_nombre, e.direccion_entrega,
         e.caja_sucursal, e.total, e.tarifa, e.items, e.creado_at,
         o.created_at,
         e.entrega_lat, e.entrega_lng, e.origen_lat, e.origen_lng
  from public.entrega_ofertas o
  join public.entregas e on e.id = o.entrega_id
  where o.conductor_id = p_conductor_id
    and o.estado = 'pendiente'
    and e.estado = 'buscando'
  order by e.creado_at;
$$;

grant execute on function public.rpc_entrega_ofertas_conductor(uuid) to anon, authenticated;

-- 2) El cajero también necesita el id de la oferta (para poder
--    expirarla desde su pantalla) — antes solo traía conductor_id/estado.
drop function if exists public.rpc_entrega_ofertas_de_entrega(uuid);
create or replace function public.rpc_entrega_ofertas_de_entrega(p_session_token uuid)
returns table (
  oferta_id        uuid,
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
  select o.id, o.conductor_id, c.nombre, o.estado, o.created_at, o.resuelta_at
  from public.entrega_ofertas o
  join public.entregas e on e.id = o.entrega_id
  left join public.conductores c on c.id = o.conductor_id
  where e.session_token = p_session_token
  order by o.created_at;
$$;

grant execute on function public.rpc_entrega_ofertas_de_entrega(uuid) to anon, authenticated;

-- 3) Expirar una oferta que nadie respondió en 30s. La llama quien la
--    vea vencida primero (conductor o cajero) — un pequeño colchón de
--    25s server-side evita que un reloj cliente adelantado la cierre
--    antes de tiempo. Idempotente: si ya no está 'pendiente', no hace nada.
create or replace function public.rpc_entrega_oferta_expirar(p_oferta_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entrega_id uuid; v_conductor_id uuid; v_estado text; v_creada_at timestamptz;
  v_conductor_nombre text;
begin
  select entrega_id, conductor_id, estado, created_at
    into v_entrega_id, v_conductor_id, v_estado, v_creada_at
  from public.entrega_ofertas where id = p_oferta_id for update;

  if v_entrega_id is null then return jsonb_build_object('status', 'no_encontrada'); end if;
  if v_estado is distinct from 'pendiente' then return jsonb_build_object('status', 'no_pendiente'); end if;
  if now() - v_creada_at < interval '25 seconds' then return jsonb_build_object('status', 'aun_no'); end if;

  update public.entrega_ofertas set estado = 'expirada', resuelta_at = now() where id = p_oferta_id;

  select nombre into v_conductor_nombre from public.conductores where id = v_conductor_id;
  insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
  values (
    v_entrega_id, 'cajero_conductor', 'sistema',
    format('⏱️ %s no respondió la oferta a tiempo (30 s) — se canceló sola.', coalesce(v_conductor_nombre, 'El repartidor'))
  );

  return jsonb_build_object('status', 'ok', 'entrega_id', v_entrega_id, 'conductor_id', v_conductor_id);
end;
$$;

grant execute on function public.rpc_entrega_oferta_expirar(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
