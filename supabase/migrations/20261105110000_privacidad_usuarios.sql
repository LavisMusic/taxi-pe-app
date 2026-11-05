-- =========================================================================
-- Privacidad de usuarios y conductores (revisión de seguridad 2026-11-05,
-- P1-D).
--
--   * El recolector podía leer la fila de usuario de TODOS los conductores
--     (DNI, teléfono, edad, sexo, créditos) y el DNI completo de todos por
--     taxi_conductores_privados. Ninguna pantalla suya usa la tabla de
--     usuarios de otros; para recargar le basta ubicar al conductor:
--       - ya no lee usuarios de conductores;
--       - del DNI recibe solo los últimos 3 dígitos ('•••••123');
--       - para buscar por DNI escribe los 8 dígitos y
--         taxi_conductor_por_dni le dice de quién es (exacto, sin lista).
--   * usuarios_publicos listaba a todos los usuarios (id, nombre, foto,
--     rol, usuario) sin sesión. Lo único que la usaba es la bandeja de
--     chats del conductor: ahora taxi_usuarios_de_mis_chats devuelve solo
--     a los pasajeros con los que ese conductor tiene chat.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Usuarios: sin la lectura del recolector -------------------------
drop policy if exists usuarios_leer on public.usuarios;
create policy usuarios_leer on public.usuarios for select to authenticated
  using (
    id = auth.uid()
    or public.taxi_es_admin()
  );

-- ---------- DNI: completo solo para el Admin -------------------------------
create or replace function public.taxi_conductores_privados()
returns table (
  id                     uuid,
  dni                    text,
  foto_general_url       text,
  foto_interior_url      text,
  foto_conductor_dni_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         case
           when public.taxi_es_admin() then c.dni::text
           when c.dni is not null then '•••••' || right(c.dni::text, 3)
         end,
         case when public.taxi_es_admin() then c.foto_general_url::text end,
         case when public.taxi_es_admin() then c.foto_interior_url::text end,
         case when public.taxi_es_admin() then c.foto_conductor_dni_url::text end
  from public.conductores c
  where public.taxi_es_admin() or public.taxi_rol() = 'recolector';
$$;
grant execute on function public.taxi_conductores_privados() to authenticated;

-- Buscar por DNI completo (exacto): devuelve el id del conductor o nada.
create or replace function public.taxi_conductor_por_dni(p_dni text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.conductores c
  where (public.taxi_es_admin() or public.taxi_rol() = 'recolector')
    and c.dni = trim(p_dni)
  limit 1;
$$;
revoke execute on function public.taxi_conductor_por_dni(text) from public, anon;
grant execute on function public.taxi_conductor_por_dni(text) to authenticated;

-- ---------- Nombres de la bandeja de chats ----------------------------------
create or replace function public.taxi_usuarios_de_mis_chats(p_ids uuid[])
returns table (id uuid, nombre text, foto_url text, rol text, nombre_usuario text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.nombre, u.foto_url, u.rol, u.nombre_usuario
  from public.usuarios u
  where u.id = any (p_ids[1:200])
    and (
      public.taxi_es_admin()
      or exists (
        select 1 from public.chat_mensajes m
        where m.pasajero_id = u.id and m.conductor_id = public.taxi_mi_conductor_id()
      )
    );
$$;
revoke execute on function public.taxi_usuarios_de_mis_chats(uuid[]) from public, anon;
grant execute on function public.taxi_usuarios_de_mis_chats(uuid[]) to authenticated;

-- La lista completa deja de ser legible.
revoke select on public.usuarios_publicos from anon, authenticated;

notify pgrst, 'reload schema';
