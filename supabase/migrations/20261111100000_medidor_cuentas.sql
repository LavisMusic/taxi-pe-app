-- =========================================================================
-- Fase 5a: medidor de cuentas verificadas (Taxi-PE).
--
--   * Por rol (pasajero, conductor, recolector): verificadas (aprobadas,
--     estado_verificacion 'permanente'), en revisión y temporales; nuevas
--     verificadas de la semana y temporales por vencer (3 días).
--   * Meta por rol (100 al empezar), editable por el admin o por el
--     superadmin de Caja (puente firmado, service_role).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================
create table if not exists public.taxi_metas_cuentas (
  rol text primary key check (rol in ('pasajero', 'conductor', 'recolector')),
  meta integer not null default 100 check (meta > 0),
  actualizado timestamptz not null default now()
);
insert into public.taxi_metas_cuentas (rol) values ('pasajero'), ('conductor'), ('recolector')
on conflict (rol) do nothing;
alter table public.taxi_metas_cuentas enable row level security;
revoke all on public.taxi_metas_cuentas from anon, authenticated;

create or replace function public.taxi__puede_ver_metricas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.taxi_es_admin() or coalesce(auth.role(), '') = 'service_role';
$$;
revoke execute on function public.taxi__puede_ver_metricas() from public, anon, authenticated;

create or replace function public.taxi_resumen_cuentas()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.taxi__puede_ver_metricas() then
    raise exception 'Solo el admin.' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'rol', m.rol,
      'meta', m.meta,
      'verificadas', coalesce(c.verificadas, 0),
      'en_revision', coalesce(c.en_revision, 0),
      'temporales', coalesce(c.temporales, 0),
      'nuevas_semana', coalesce(c.nuevas_semana, 0),
      'por_vencer', coalesce(c.por_vencer, 0)
    ) order by array_position(array['pasajero', 'conductor', 'recolector'], m.rol)), '[]'::jsonb)
    from public.taxi_metas_cuentas m
    left join (
      select u.rol,
             count(*) filter (where u.estado_verificacion = 'permanente') as verificadas,
             count(*) filter (where u.estado_verificacion = 'en_revision') as en_revision,
             count(*) filter (where u.estado_verificacion = 'temporal'
                               and (u.expira_en is null or u.expira_en > now())) as temporales,
             count(*) filter (where u.estado_verificacion = 'permanente'
                               and u.created_at > now() - interval '7 days') as nuevas_semana,
             count(*) filter (where u.estado_verificacion = 'temporal'
                               and u.expira_en > now() and u.expira_en < now() + interval '3 days') as por_vencer
        from public.usuarios u
       where u.rol in ('pasajero', 'conductor', 'recolector')
       group by u.rol
    ) c on c.rol = m.rol
  );
end;
$$;
revoke execute on function public.taxi_resumen_cuentas() from public, anon;
grant execute on function public.taxi_resumen_cuentas() to authenticated, service_role;

create or replace function public.taxi_guardar_meta_cuentas(p_rol text, p_meta integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.taxi__puede_ver_metricas() then
    raise exception 'Solo el admin.' using errcode = '42501';
  end if;
  if p_meta is null or p_meta < 1 or p_meta > 1000000 then
    raise exception 'La meta no es válida.' using errcode = '22023';
  end if;
  update public.taxi_metas_cuentas set meta = p_meta, actualizado = now() where rol = p_rol;
  if not found then
    raise exception 'Rol no válido.' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.taxi_guardar_meta_cuentas(text, integer) from public, anon;
grant execute on function public.taxi_guardar_meta_cuentas(text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
