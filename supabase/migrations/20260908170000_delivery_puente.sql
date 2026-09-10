-- =========================================================================
-- Delivery — puente Caja (Fase 3). Proyecto: Taxi-PE (silfhbdmfdryjdzpwzvh).
-- Ver DELIVERY.md §2 / §8.
--
-- rpc_conductores_para_reparto(): lista que consume el radar de la app de
-- Caja Tonazo (vía el 2º cliente Supabase → Taxi-PE) para elegir a quién
-- ofrecerle una entrega. Solo conductores:
--   - aprobados y operativos (estado 'activo' | 'ocupado')
--   - VERIFICADOS: su fila en `usuarios` (por teléfono) con rol 'conductor'
--     y estado_verificacion 'permanente' (excluye 'temporal' / 'en_revision')
--   - con acceso vigente (membresía o créditos) — mismo criterio que el
--     radar de pasajeros (useRadarPublico.js)
--   - con última posición conocida (ultima_lat/lng, que useGpsBroadcaster
--     va guardando con throttle)
--
-- El movimiento en vivo lo trae el Broadcast del canal `radar_publico`
-- (event 'gps_update', payload {conductorId,lat,lng}) — esto es solo la
-- foto inicial.
--
-- Idempotente.
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
    and (c.vencimiento_suscripcion > now() or coalesce(c.creditos, 0) > 0);
$$;

grant execute on function public.rpc_conductores_para_reparto() to anon, authenticated;
