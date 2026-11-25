-- =========================================================================
-- Ajustes de la plataforma de Taxi PE (una sola fila): modo mantenimiento
-- y umbral de reportes. Los cambia el superadmin desde Caja (puente
-- webhook-caja-superadmin, acción "ajustes.guardar") o el admin de Taxi.
--
--   mantenimiento / mantenimiento_mensaje  mientras está prendido, la app
--     muestra "Estamos haciendo mejoras" a todos menos al panel del admin.
--   umbral_reportes  cuántos reportes marcan a un usuario (0 = apagado).
--
-- Todos pueden LEER (la app lo revisa antes de iniciar sesión).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create table if not exists public.taxi_plataforma_ajustes (
  id int primary key default 1 check (id = 1),
  mantenimiento boolean not null default false,
  mantenimiento_mensaje text,
  umbral_reportes int not null default 0 check (umbral_reportes between 0 and 100),
  updated_at timestamptz not null default now()
);
insert into public.taxi_plataforma_ajustes (id) values (1) on conflict (id) do nothing;

alter table public.taxi_plataforma_ajustes enable row level security;
revoke all on public.taxi_plataforma_ajustes from anon, authenticated;
grant select on public.taxi_plataforma_ajustes to anon, authenticated;
drop policy if exists taxi_plataforma_ajustes_leer on public.taxi_plataforma_ajustes;
create policy taxi_plataforma_ajustes_leer on public.taxi_plataforma_ajustes for select using (true);

do $$
begin
  alter publication supabase_realtime add table public.taxi_plataforma_ajustes;
exception when duplicate_object then null;
end $$;

create or replace function public.taxi_guardar_ajustes_plataforma(p jsonb)
returns public.taxi_plataforma_ajustes
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.taxi_plataforma_ajustes;
begin
  if not public.taxi__admin_o_puente() then
    raise exception 'Solo el administrador puede cambiar los ajustes de la plataforma.' using errcode = '42501';
  end if;
  update public.taxi_plataforma_ajustes set
    mantenimiento = coalesce((p ->> 'mantenimiento')::boolean, mantenimiento),
    mantenimiento_mensaje = case when p ? 'mantenimiento_mensaje'
      then nullif(left(trim(p ->> 'mantenimiento_mensaje'), 300), '') else mantenimiento_mensaje end,
    umbral_reportes = coalesce((p ->> 'umbral_reportes')::int, umbral_reportes),
    updated_at = now()
  where id = 1
  returning * into v;
  return v;
end;
$$;
revoke execute on function public.taxi_guardar_ajustes_plataforma(jsonb) from public, anon;
grant execute on function public.taxi_guardar_ajustes_plataforma(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
