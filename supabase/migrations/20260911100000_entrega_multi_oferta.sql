-- =========================================================================
-- Reparto: un conductor puede tener VARIAS entregas aceptadas (todavía
-- sin recoger) a la vez, pero deja de recibir ofertas NUEVAS apenas
-- tiene alguna EN_RUTA (ya recogió y pagó esa, está en la calle con
-- ella) — hasta que la cierre (entregado/no_entregado). Ver bug
-- reportado: "el conductor puede aceptar más de una solicitud... se
-- bloquea el envío de ofertas cuando confirma que recogió y pagó".
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- 1) Aceptar oferta: rechaza si el conductor ya tiene una entrega en_ruta.
create or replace function public.rpc_entrega_aceptar(p_oferta_id uuid, p_conductor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_entrega_id uuid; v_taken uuid; v_en_ruta int;
begin
  select count(*) into v_en_ruta from public.entregas
  where conductor_id = p_conductor_id and estado = 'en_ruta';
  if v_en_ruta > 0 then
    return jsonb_build_object('status', 'conductor_en_ruta');
  end if;

  select entrega_id into v_entrega_id
  from public.entrega_ofertas
  where id = p_oferta_id and conductor_id = p_conductor_id and estado = 'pendiente';
  if v_entrega_id is null then return jsonb_build_object('status', 'oferta_invalida'); end if;

  select conductor_id into v_taken from public.entregas where id = v_entrega_id for update;
  if v_taken is not null then
    update public.entrega_ofertas set estado = 'cerrada', resuelta_at = now() where id = p_oferta_id;
    return jsonb_build_object('status', 'ya_tomada');
  end if;

  update public.entregas
    set conductor_id = p_conductor_id, estado = 'aceptado',
        aceptado_at = now(), actualizado_at = now()
    where id = v_entrega_id;

  update public.entrega_ofertas set estado = 'aceptada', resuelta_at = now() where id = p_oferta_id;
  update public.entrega_ofertas set estado = 'cerrada',  resuelta_at = now()
    where entrega_id = v_entrega_id and id <> p_oferta_id and estado = 'pendiente';

  insert into public.entrega_mensajes (entrega_id, hilo, emisor_rol, mensaje)
  values (v_entrega_id, 'cliente_conductor', 'sistema', 'El repartidor aceptó y va en camino a retirar el pedido.');

  return jsonb_build_object('status', 'ok', 'entrega_id', v_entrega_id);
end;
$$;

-- 2) Entregas activas del conductor: TODAS las no cerradas (antes traía
--    solo la más reciente con `limit 1`) — el panel ahora las lista todas.
create or replace function public.rpc_entrega_activa_conductor(p_conductor_id uuid)
returns setof public.entregas
language sql
security definer
set search_path = public
as $$
  select * from public.entregas
  where conductor_id = p_conductor_id and estado in ('aceptado', 'en_ruta')
  order by aceptado_at asc;
$$;

-- 3) Sugerencias para "Asignar repartidor" (Caja): saca a un conductor
--    que ya tiene una entrega en_ruta — no se le puede ofrecer otra
--    hasta que la recogida/pago actual quede cerrada.
create or replace function public.rpc_conductores_para_reparto()
returns table (
  id          uuid,
  nombre      text,
  placa       text,
  foto_url    text,
  estado      text,
  ultima_lat  numeric,
  ultima_lng  numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.nombre, c.placa, c.foto_url, c.estado, c.ultima_lat, c.ultima_lng
  from public.conductores c
  join public.usuarios u
    on u.telefono = c.telefono
   and u.rol = 'conductor'
   and coalesce(u.estado_verificacion, 'permanente') = 'permanente'
  where coalesce(c.aprobado, false)
    and c.estado in ('activo', 'ocupado')
    and c.ultima_lat is not null
    and c.ultima_lng is not null
    and c.ultima_actualizacion > now() - interval '2 minutes'
    and (c.vencimiento_suscripcion > now() or coalesce(c.creditos, 0) > 0)
    and not exists (
      select 1 from public.entregas e
      where e.conductor_id = c.id and e.estado = 'en_ruta'
    );
$$;

grant execute on function public.rpc_conductores_para_reparto() to anon, authenticated;

notify pgrst, 'reload schema';
