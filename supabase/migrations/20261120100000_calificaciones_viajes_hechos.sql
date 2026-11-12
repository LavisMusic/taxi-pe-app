-- =========================================================================
-- Calificaciones de viajes: leer el viaje de taxi_viajes_hechos.
--
--   El chat (chat_mensajes) se borra 24 h después de cerrar el turno del
--   conductor, y con él la oferta del viaje: "Por calificar" perdía el viaje
--   y taxi_calificar decía "Solo se califican viajes terminados" aunque no
--   hubieran pasado los 7 días. taxi_viajes_hechos (fase 4a) guarda una copia
--   mínima de cada viaje terminado por 120 días: ahora las dos funciones
--   leen de ahí. Las entregas no cambian.
--
-- Requiere: 20261119100000_reportes_fase4a.sql. Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.taxi_calificar(p_ref text, p_estrellas integer, p_comentario text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cond uuid := public.taxi_mi_conductor_id();
  v_viaje public.taxi_viajes_hechos;
  v_autor_tipo text;
  v_autor_id text;
  v_tipo text;
  v_id uuid;
  v_coment text := nullif(trim(coalesce(p_comentario, '')), '');
  v_rep public.taxi_reputacion;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para calificar.' using errcode = '42501';
  end if;
  if p_estrellas is null or p_estrellas < 1 or p_estrellas > 5 then
    raise exception 'Elige de 1 a 5 estrellas.' using errcode = '22023';
  end if;
  if v_coment is not null and char_length(v_coment) > 280 then
    raise exception 'El comentario puede tener hasta 280 letras.' using errcode = '22023';
  end if;
  if p_ref is null or p_ref not like 'viaje:%' then
    raise exception 'Servicio inválido.' using errcode = '22023';
  end if;

  select * into v_viaje from public.taxi_viajes_hechos where oferta_id::text = substr(p_ref, 7);
  if v_viaje.oferta_id is null then
    raise exception 'Solo se califican viajes terminados.' using errcode = '42501';
  end if;

  if v_viaje.pasajero_id = v_uid then
    v_autor_tipo := 'pasajero'; v_autor_id := v_uid::text;
    v_tipo := 'conductor'; v_id := v_viaje.conductor_id;
  elsif v_cond is not null and v_viaje.conductor_id = v_cond then
    v_autor_tipo := 'conductor'; v_autor_id := v_cond::text;
    v_tipo := 'pasajero'; v_id := v_viaje.pasajero_id;
  else
    raise exception 'Solo califica quien hizo el viaje.' using errcode = '42501';
  end if;
  if v_viaje.finalizado_at < now() - interval '7 days'
     and not exists (select 1 from public.taxi_calificaciones
                      where ref = p_ref and autor_tipo = v_autor_tipo and calificado_tipo = v_tipo) then
    raise exception 'Pasaron más de 7 días: ya no se puede calificar este viaje.' using errcode = '42501';
  end if;

  insert into public.taxi_calificaciones (servicio, ref, autor_tipo, autor_id, calificado_tipo, calificado_id, estrellas, comentario)
  values ('viaje', p_ref, v_autor_tipo, v_autor_id, v_tipo, v_id, p_estrellas, v_coment)
  on conflict (ref, autor_tipo, calificado_tipo) do update
    set estrellas = excluded.estrellas, comentario = excluded.comentario, updated_at = now();

  select * into v_rep from public.taxi_reputacion where calificado_tipo = v_tipo and calificado_id = v_id;
  return jsonb_build_object('ok', true, 'calificado_tipo', v_tipo, 'calificado_id', v_id,
                            'total', v_rep.total, 'promedio', v_rep.promedio, 'etiqueta', v_rep.etiqueta);
end;
$$;
revoke execute on function public.taxi_calificar(text, integer, text) from public, anon;
grant execute on function public.taxi_calificar(text, integer, text) to authenticated;

create or replace function public.taxi_calificaciones_pendientes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cond uuid := public.taxi_mi_conductor_id();
begin
  if v_uid is null then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(x order by x->>'fecha' desc, x->>'orden')
      from (
        select jsonb_build_object(
                 'ref', 'viaje:' || v.oferta_id::text, 'servicio', 'viaje', 'orden', '1', 'fecha', v.finalizado_at,
                 'calificado_tipo', 'conductor', 'calificado_id', c.id, 'nombre', c.nombre, 'foto_url', c.foto_url,
                 'detalle', c.placa) as x
          from public.taxi_viajes_hechos v
          join public.conductores c on c.id = v.conductor_id
         where v.pasajero_id = v_uid
           and v.finalizado_at >= now() - interval '7 days'
           and not exists (select 1 from public.taxi_calificaciones k
                            where k.ref = 'viaje:' || v.oferta_id::text and k.autor_tipo = 'pasajero' and k.calificado_tipo = 'conductor')
        union all
        select jsonb_build_object(
                 'ref', 'viaje:' || v.oferta_id::text, 'servicio', 'viaje', 'orden', '1', 'fecha', v.finalizado_at,
                 'calificado_tipo', 'pasajero', 'calificado_id', u.id,
                 'nombre', case when u.nombre_usuario is not null and u.nombre_usuario !~ '^\d{6,}$'
                                then '@' || u.nombre_usuario else coalesce(u.nombre, 'Pasajero') end,
                 'foto_url', u.foto_url, 'detalle', null) as x
          from public.taxi_viajes_hechos v
          join public.usuarios u on u.id = v.pasajero_id
         where v_cond is not null and v.conductor_id = v_cond
           and v.finalizado_at >= now() - interval '7 days'
           and not exists (select 1 from public.taxi_calificaciones k
                            where k.ref = 'viaje:' || v.oferta_id::text and k.autor_tipo = 'conductor' and k.calificado_tipo = 'pasajero')
        union all
        -- Entregas del repartidor: primero el negocio, después el cliente.
        select jsonb_build_object(
                 'ref', 'entrega:' || e.id, 'servicio', 'entrega', 'entrega_id', e.id, 'orden', t.orden,
                 'fecha', coalesce(e.entregado_at, e.actualizado_at), 'calificado_tipo', t.tipo,
                 'nombre', case when t.tipo = 'negocio' then coalesce(e.caja_sucursal, 'Tienda') else coalesce(e.cliente_nombre, 'Cliente') end,
                 'foto_url', case when t.tipo = 'negocio' then e.caja_logo_url else null end,
                 'detalle', case when t.tipo = 'negocio' then 'Negocio de la entrega' else 'Cliente de la entrega' end) as x
          from public.entregas e
          cross join (values ('negocio', '1'), ('cliente', '2')) as t(tipo, orden)
         where v_cond is not null and e.conductor_id = v_cond and e.estado = 'entregado' and e.caja_pedido_ref is not null
           and coalesce(e.entregado_at, e.actualizado_at) >= now() - interval '7 days'
           and not exists (select 1 from public.taxi_calificaciones_salientes k
                            where k.ref = 'entrega:' || e.id and k.calificado_tipo = t.tipo)
      ) p
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.taxi_calificaciones_pendientes() from public, anon;
grant execute on function public.taxi_calificaciones_pendientes() to authenticated;
