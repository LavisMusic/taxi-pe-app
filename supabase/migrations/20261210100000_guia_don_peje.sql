-- =========================================================================
-- Don Peje en Taxi PE: progreso de la guía de bienvenida y si se muestra.
--
-- usuarios.guia_don_peje (jsonb), por rol y la mascota:
--   { "pasajero": { "paso": "radar", "terminada": false, "dormido": false },
--     "mascota": { "oculta": false } }
-- Mismas funciones que en Caja (mi_guia_leer / mi_guia_guardar): cada uno
-- lee y escribe solo su propia fila (usuarios.id = auth.uid()) y solo esta
-- columna. El admin (código maestro) tiene sesión pero no fila en usuarios:
-- lo suyo va en taxi_guia_extra (sin acceso directo, solo por estas
-- funciones).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.usuarios add column if not exists guia_don_peje jsonb not null default '{}'::jsonb;

create table if not exists public.taxi_guia_extra (
  uid uuid primary key,
  datos jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.taxi_guia_extra enable row level security;
revoke all on public.taxi_guia_extra from anon, authenticated;

create or replace function public.mi_guia_leer()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select guia_don_peje from public.usuarios where id = auth.uid()),
    (select datos from public.taxi_guia_extra where uid = auth.uid()),
    '{}'::jsonb
  );
$$;
revoke execute on function public.mi_guia_leer() from public, anon;
grant execute on function public.mi_guia_leer() to authenticated;

create or replace function public.mi_guia_guardar(p_rol text, p_estado jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sin sesión.' using errcode = '42501';
  end if;
  if p_rol is null or p_rol !~ '^[a-z_]{2,20}$' then
    raise exception 'Rol inválido.' using errcode = '22023';
  end if;
  if p_estado is null or jsonb_typeof(p_estado) <> 'object' or length(p_estado::text) > 2000 then
    raise exception 'Estado inválido.' using errcode = '22023';
  end if;
  update public.usuarios
     set guia_don_peje = coalesce(guia_don_peje, '{}'::jsonb) || jsonb_build_object(p_rol, p_estado)
   where id = auth.uid();
  if not found then
    insert into public.taxi_guia_extra (uid, datos)
    values (auth.uid(), jsonb_build_object(p_rol, p_estado))
    on conflict (uid) do update
      set datos = public.taxi_guia_extra.datos || jsonb_build_object(p_rol, p_estado), updated_at = now();
  end if;
end;
$$;
revoke execute on function public.mi_guia_guardar(text, jsonb) from public, anon;
grant execute on function public.mi_guia_guardar(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
