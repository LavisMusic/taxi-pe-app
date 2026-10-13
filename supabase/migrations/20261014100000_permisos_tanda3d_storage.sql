-- =========================================================================
-- Seguridad, fase 2B — tanda 3d: archivos (Storage).
--
--   * Nadie lista los archivos: las imágenes públicas se siguen viendo por
--     su enlace (no necesitan ninguna política de lectura).
--   * Subir:
--       conductores-fotos  (fotos de perfil)            → con sesión, imágenes ≤ 10 MB
--       verificaciones     (PRIVADO: fotos de verificación y con el DNI)
--                                                        → con sesión, imágenes ≤ 10 MB
--       anuncios-media     (anuncios)                   → solo el Admin, imagen/video ≤ 50 MB
--       ventas-comprobantes (comprobantes de pago)      → solo el Admin, imágenes ≤ 10 MB
--       comprobantes, comprobantes-fotos, productos-imagenes (app vieja) → nadie
--   * 'verificaciones' es privado: lo ve el Admin (y quien subió la foto,
--     para su vista previa) con enlaces firmados que vencen. En la base se
--     guarda 'privado:<archivo>' en vez de un enlace.
--   * Editar o borrar archivos: solo el Admin.
--   * La foto del recolector con su DNI va aparte (usuarios.foto_dni_url),
--     ya no como su foto de perfil (que es pública).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

-- ---------- Buckets ----------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('verificaciones', 'verificaciones', false, 10485760, array['image/*'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760, allowed_mime_types = array['image/*'];

update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['image/*']
  where id in ('conductores-fotos', 'ventas-comprobantes');
update storage.buckets set file_size_limit = 52428800, allowed_mime_types = array['image/*', 'video/*']
  where id = 'anuncios-media';

-- ---------- Políticas (se reemplazan todas las de storage.objects) ----------
do $$
declare
  v_pol record;
begin
  for v_pol in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' loop
    execute format('drop policy %I on storage.objects', v_pol.policyname);
  end loop;
end $$;

create policy archivos_subir_fotos on storage.objects for insert to authenticated
  with check (bucket_id in ('conductores-fotos', 'verificaciones'));
create policy archivos_subir_admin on storage.objects for insert to authenticated
  with check (bucket_id in ('anuncios-media', 'ventas-comprobantes') and public.taxi_es_admin());
-- Privado: el Admin todo; quien subió la foto, la suya (vista previa).
create policy archivos_ver_verificaciones on storage.objects for select to authenticated
  using (bucket_id = 'verificaciones' and (public.taxi_es_admin() or owner_id = auth.uid()::text));
create policy archivos_admin_cambiar on storage.objects for update to authenticated
  using (public.taxi_es_admin()) with check (public.taxi_es_admin());
create policy archivos_admin_borrar on storage.objects for delete to authenticated
  using (public.taxi_es_admin());

-- ---------- Foto del recolector con su DNI ------------------------------------
alter table public.usuarios add column if not exists foto_dni_url text;

-- taxi_crear_pin (cuentas exprés antiguas sin PIN que se verifican): también
-- guarda la foto con el DNI. Misma función que la de
-- 20261012130000_registro_y_verificacion_recolector.sql + foto_dni_url.
create or replace function public.taxi_crear_pin(p_usuario_id uuid, p_pin text, p_datos jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_u public.usuarios;
begin
  if exists (select 1 from public.usuarios_credenciales where usuario_id = p_usuario_id) then
    return jsonb_build_object('estado', 'ya_tiene_pin');
  end if;
  if not exists (select 1 from public.usuarios where id = p_usuario_id) then
    return jsonb_build_object('estado', 'no_existe');
  end if;
  if nullif(trim(p_datos ->> 'dni'), '') is not null
     and public.taxi_existe_cuenta(p_datos ->> 'dni', null, null, p_usuario_id) then
    return jsonb_build_object('estado', 'dni_duplicado');
  end if;
  if nullif(trim(p_datos ->> 'ruc'), '') is not null and trim(p_datos ->> 'ruc') !~ '^\d{11}$' then
    return jsonb_build_object('estado', 'ruc_invalido');
  end if;

  if p_datos is not null then
    update public.usuarios set
      nombre = coalesce(p_datos ->> 'nombre', nombre),
      apellido = coalesce(p_datos ->> 'apellido', apellido),
      edad = coalesce((p_datos ->> 'edad')::integer, edad),
      sexo = coalesce(p_datos ->> 'sexo', sexo),
      estado_verificacion = coalesce(p_datos ->> 'estado_verificacion', estado_verificacion),
      expira_en = case when p_datos ? 'expira_en' then (p_datos ->> 'expira_en')::timestamptz else expira_en end,
      dni = coalesce(dni, nullif(trim(p_datos ->> 'dni'), '')),
      foto_url = coalesce(nullif(p_datos ->> 'foto_url', ''), foto_url),
      foto_dni_url = coalesce(nullif(p_datos ->> 'foto_dni_url', ''), foto_dni_url),
      ruc = case when p_datos ? 'ruc' then nullif(trim(p_datos ->> 'ruc'), '') else ruc end
    where id = p_usuario_id;
  end if;

  perform public.taxi_guardar_pin(p_usuario_id, p_pin);
  select * into v_u from public.usuarios where id = p_usuario_id;
  return jsonb_build_object('estado', 'ok', 'usuario', to_jsonb(v_u), 'ticket', public.taxi_emitir_ticket(v_u.id, v_u.rol));
end;
$$;
