-- =========================================================================
-- rpc_conductores_para_reparto: excluir a los que ya NO están conectados.
--
-- `conductores.estado` ('activo'/'ocupado') es un valor guardado que no
-- cambia solo cuando el chofer cierra la app. La señal real de "está
-- online AHORA" es `ultima_actualizacion` (useGpsBroadcaster.js lo
-- escribe cada ~8 s mientras transmite GPS al canal público). Si hace
-- más de 2 min que no se actualiza, se lo considera offline y no
-- aparece en las sugerencias para asignar repartidor.
--
-- Idempotente (create or replace, misma firma).
-- =========================================================================

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
    and (c.vencimiento_suscripcion > now() or coalesce(c.creditos, 0) > 0);
$$;

grant execute on function public.rpc_conductores_para_reparto() to anon, authenticated;
