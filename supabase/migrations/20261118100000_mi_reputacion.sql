-- =========================================================================
-- Reportes y reputación, fase 3b (Taxi-PE): "Mi reputación" del pasajero
-- y del conductor/repartidor.
--
--   taxi_mi_reputacion(p_rol 'pasajero' | 'conductor'): en una lectura:
--     * reputacion: sus estrellas (promedio, total, barras, etiqueta auto)
--     * etiquetas: las que le puso el admin
--     * dadas: las calificaciones que ÉL puso
--         pasajero  → a conductores (viajes), con la respuesta del
--                     conductor y si ocultó el comentario
--         conductor → a pasajeros (viajes) y, como repartidor, a negocios
--                     y clientes (entregas: taxi_calificaciones_salientes)
--       Se editan con taxi_calificar / taxi_calificar_entrega y se borran
--       con taxi_borrar_calificacion (ya existen).
--   Lo que tiene por calificar sale de taxi_calificaciones_pendientes().
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.taxi_mi_reputacion(p_rol text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cond uuid := public.taxi_mi_conductor_id();
  v_id uuid;
  v_rep public.taxi_reputacion;
  v_dadas jsonb;
begin
  if v_uid is null then
    raise exception 'Inicia sesión para ver tu reputación.' using errcode = '42501';
  end if;
  if p_rol = 'conductor' then
    if v_cond is null then
      raise exception 'Solo para conductores.' using errcode = '42501';
    end if;
    v_id := v_cond;
  elsif p_rol = 'pasajero' then
    v_id := v_uid;
  else
    raise exception 'Rol inválido.' using errcode = '22023';
  end if;

  select * into v_rep from public.taxi_reputacion where calificado_tipo = p_rol and calificado_id = v_id;

  if p_rol = 'pasajero' then
    select jsonb_agg(t.x order by t.fecha desc) into v_dadas
      from (
        select k.created_at as fecha,
               jsonb_build_object(
                 'id', k.id, 'ref', k.ref, 'servicio', k.servicio, 'calificado_tipo', k.calificado_tipo,
                 'calificado_id', k.calificado_id, 'estrellas', k.estrellas, 'comentario', k.comentario,
                 'fecha', k.created_at, 'editada', k.updated_at > k.created_at + interval '1 minute',
                 'respuesta', k.respuesta,
                 'oculto_por', case when k.oculto then coalesce(k.oculto_por, 'admin') end,
                 'nombre', coalesce(c.nombre, 'Conductor'), 'foto_url', c.foto_url, 'detalle', c.placa) as x
          from public.taxi_calificaciones k
          left join public.conductores c on c.id = k.calificado_id
         where k.autor_tipo = 'pasajero' and k.autor_id = v_uid::text
         order by k.created_at desc
         limit 200
      ) t;
  else
    select jsonb_agg(t.x order by t.fecha desc) into v_dadas
      from (
        (select k.created_at as fecha,
                jsonb_build_object(
                  'id', k.id, 'ref', k.ref, 'servicio', k.servicio, 'calificado_tipo', k.calificado_tipo,
                  'calificado_id', k.calificado_id, 'estrellas', k.estrellas, 'comentario', k.comentario,
                  'fecha', k.created_at, 'editada', k.updated_at > k.created_at + interval '1 minute',
                  'respuesta', null, 'oculto_por', null,
                  'nombre', case when u.nombre_usuario is not null and u.nombre_usuario !~ '^\d{6,}$'
                                 then '@' || u.nombre_usuario else coalesce(u.nombre, 'Pasajero') end,
                  'foto_url', u.foto_url, 'detalle', 'Viaje') as x
           from public.taxi_calificaciones k
           left join public.usuarios u on u.id = k.calificado_id
          where k.autor_tipo = 'conductor' and k.autor_id = v_cond::text
          order by k.created_at desc
          limit 150)
        union all
        (select s.created_at as fecha,
                jsonb_build_object(
                  'id', s.id, 'ref', s.ref, 'servicio', 'entrega', 'entrega_id', e.id,
                  'calificado_tipo', s.calificado_tipo, 'estrellas', s.estrellas, 'comentario', s.comentario,
                  'fecha', s.created_at, 'editada', s.updated_at > s.created_at + interval '1 minute',
                  'respuesta', null, 'oculto_por', null,
                  'nombre', case when s.calificado_tipo = 'negocio' then coalesce(e.caja_sucursal, 'Tienda')
                                 else coalesce(e.cliente_nombre, 'Cliente') end,
                  'foto_url', case when s.calificado_tipo = 'negocio' then e.caja_logo_url end,
                  'detalle', case when s.calificado_tipo = 'negocio' then 'Negocio de la entrega' else 'Cliente de la entrega' end) as x
           from public.taxi_calificaciones_salientes s
           left join public.entregas e on e.id::text = substr(s.ref, 9)
          where s.conductor_id = v_cond
          order by s.created_at desc
          limit 150)
      ) t;
  end if;

  return jsonb_build_object(
    'id', v_id,
    'reputacion', jsonb_build_object(
      'total', coalesce(v_rep.total, 0),
      'promedio', coalesce(v_rep.promedio, 0),
      'distribucion', coalesce(v_rep.distribucion, '{"1":0,"2":0,"3":0,"4":0,"5":0}'::jsonb),
      'etiqueta', coalesce(v_rep.etiqueta, 'nuevo')),
    'etiquetas', coalesce((
      select jsonb_agg(jsonb_build_object('etiqueta', e.etiqueta, 'color', e.color) order by e.created_at)
        from public.taxi_etiquetas e
       where e.calificado_tipo = p_rol and e.calificado_id = v_id
    ), '[]'::jsonb),
    'dadas', coalesce(v_dadas, '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.taxi_mi_reputacion(text) from public, anon;
grant execute on function public.taxi_mi_reputacion(text) to authenticated;

notify pgrst, 'reload schema';
