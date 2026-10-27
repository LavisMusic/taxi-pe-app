-- =========================================================================
-- El pasajero ve al conductor de sus chats (nombre, foto, placa, categoría)
-- aunque ya no esté en la lista pública: esa lista (política
-- conductores_publicos) solo trae a los conectados con créditos, y la app
-- además descarta a los que no reportan ubicación hace 2 minutos. Sin esto,
-- el chat y Mensajes del pasajero se quedaban sin nombre ni foto.
--
-- Devuelve los conductores con los que el pasajero de la sesión tuvo
-- mensajes en las últimas 24 horas (la vida de un chat en Mensajes), con
-- las mismas columnas públicas que ya lee useConductoresPublicos.js.
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
        and m.created_at > now() - interval '24 hours'
    );
$$;
revoke all on function public.taxi_conductores_de_mis_chats() from public, anon;
grant execute on function public.taxi_conductores_de_mis_chats() to authenticated;

notify pgrst, 'reload schema';
