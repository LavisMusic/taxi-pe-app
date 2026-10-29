-- =========================================================================
-- Nombre de usuario en el perfil (pasajero, conductor, recolector) y en
-- los chats: es lo que se muestra de cada persona.
--
--   * Único sin distinguir mayúsculas (índice sobre lower()). Si ya hay
--     repetidos no se crea y queda el aviso: hay que corregirlos a mano.
--   * taxi_nombre_usuario_libre(p_nombre, p_excluir): ¿está libre? (anon
--     también: lo consulta Caja Tonazo para el perfil del cliente). Formato:
--     3 a 20 de a-z, 0-9, punto o guion bajo.
--   * usuarios_publicos suma nombre_usuario.
--   * taxi_conductores_de_mis_chats suma el nombre de usuario del
--     conductor (su cuenta en usuarios, por teléfono).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

do $$
begin
  if exists (
    select 1 from public.usuarios
    where nombre_usuario is not null
    group by lower(nombre_usuario)
    having count(*) > 1
  ) then
    raise notice 'Hay nombres de usuario repetidos: no se creó el índice único.';
  else
    create unique index if not exists usuarios_nombre_usuario_unico
      on public.usuarios (lower(nombre_usuario))
      where nombre_usuario is not null;
  end if;
end $$;

create or replace function public.taxi_nombre_usuario_libre(p_nombre text, p_excluir uuid default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(trim(coalesce(p_nombre, ''))) ~ '^[a-z0-9._]{3,20}$'
     and not exists (
       select 1 from public.usuarios
       where lower(nombre_usuario) = lower(trim(p_nombre))
         and (p_excluir is null or id <> p_excluir)
     );
$$;
grant execute on function public.taxi_nombre_usuario_libre(text, uuid) to anon, authenticated;

create or replace view public.usuarios_publicos as
  select id, nombre, foto_url, rol, nombre_usuario from public.usuarios;
grant select on public.usuarios_publicos to anon, authenticated;

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
        and m.created_at > now() - interval '24 hours'
    );
$$;
revoke all on function public.taxi_conductores_de_mis_chats() from public, anon;
grant execute on function public.taxi_conductores_de_mis_chats() to authenticated;

notify pgrst, 'reload schema';
