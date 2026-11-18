-- =========================================================================
-- Un viaje en curso se ve siempre en Mensajes (Taxi-PE).
--
-- Bug: la regla de las 24 h (20261027140000) conserva la fila de la oferta
-- de un viaje en curso, pero Mensajes solo mostraba lo de las últimas 24 h:
-- un viaje viejo sin terminar desaparecía de los dos lados, nadie podía
-- abrirlo para terminarlo o cancelarlo, y el conductor quedaba "En carrera".
-- La app ya lo incluye en las dos bandejas; acá, los datos del conductor de
-- ese viaje para el pasajero (aunque esté desconectado y tenga más de 24 h).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create or replace function public.taxi_conductores_de_mis_chats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'nombre', c.nombre,
    'nombre_usuario', (
      select u.nombre_usuario from public.usuarios u
      where u.telefono = c.telefono and u.rol = 'conductor'
      limit 1
    ),
    'placa', c.placa,
    'telefono', c.telefono,
    'foto_url', c.foto_url,
    'foto_portada_url', c.foto_portada_url,
    'descripcion', c.descripcion,
    'estado', c.estado,
    'categoria_id', c.categoria_id,
    'localidad', c.localidad,
    'nivel_servicio', c.nivel_servicio,
    'subgrupo_id', c.subgrupo_id,
    'asientos_totales', c.asientos_totales,
    'asientos_ocupados', c.asientos_ocupados,
    'ultima_actualizacion', c.ultima_actualizacion,
    'ultima_lat', c.ultima_lat,
    'ultima_lng', c.ultima_lng,
    'aprobado', c.aprobado
  )), '[]'::jsonb)
  from public.conductores c
  where auth.uid() is not null
    and c.id in (
      select distinct m.conductor_id
      from public.chat_mensajes m
      where m.pasajero_id = auth.uid()
        and (
          m.created_at > now() - interval '24 hours'
          or (m.tipo = 'oferta' and m.estado_oferta in ('pendiente', 'aceptada', 'en_transito'))
        )
    );
$$;
revoke all on function public.taxi_conductores_de_mis_chats() from public, anon;
grant execute on function public.taxi_conductores_de_mis_chats() to authenticated;

notify pgrst, 'reload schema';
