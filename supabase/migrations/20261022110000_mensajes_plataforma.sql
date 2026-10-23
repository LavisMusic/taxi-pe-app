-- =========================================================================
-- Chats fijados "Taxi PE" y "Tonazo" (Mensajes, fase 2b).
--
-- Las notificaciones de la plataforma llegan como mensajes de solo lectura
-- de dos chats fijados que ve todo usuario con sesión:
--   * canal 'taxipe' -> chat "Taxi PE"
--   * canal 'tonazo' -> chat "Tonazo"
-- `roles` dice a quién va (pasajero, conductor, recolector) y
-- `programado_para` cuándo aparece (envío programado); `vence_at`, hasta
-- cuándo. Los escribe el gestor del superadmin (fase 2c, por el puente
-- firmado desde Caja); acá solo se leen.
-- mensajes_plataforma_leidos guarda hasta dónde leyó cada usuario cada
-- chat (para el contador de no leídos).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

create table if not exists public.mensajes_plataforma (
  id              uuid primary key default gen_random_uuid(),
  canal           text not null check (canal in ('taxipe', 'tonazo')),
  titulo          text,
  mensaje         text not null,
  roles           text[] not null,
  programado_para timestamptz not null default now(),
  vence_at        timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists mensajes_plataforma_canal_idx
  on public.mensajes_plataforma (canal, programado_para desc);

alter table public.mensajes_plataforma enable row level security;
revoke all on public.mensajes_plataforma from anon;
drop policy if exists mensajes_plataforma_leer on public.mensajes_plataforma;
create policy mensajes_plataforma_leer on public.mensajes_plataforma for select to authenticated
  using (
    public.taxi_es_admin()
    or (
      public.taxi_rol() = any (roles)
      and programado_para <= now()
      and (vence_at is null or vence_at > now())
    )
  );

create table if not exists public.mensajes_plataforma_leidos (
  usuario_id  uuid not null references public.usuarios(id) on delete cascade,
  canal       text not null check (canal in ('taxipe', 'tonazo')),
  leido_hasta timestamptz not null default now(),
  primary key (usuario_id, canal)
);
alter table public.mensajes_plataforma_leidos enable row level security;
revoke all on public.mensajes_plataforma_leidos from anon;
drop policy if exists mensajes_plataforma_leidos_propios on public.mensajes_plataforma_leidos;
create policy mensajes_plataforma_leidos_propios on public.mensajes_plataforma_leidos for select to authenticated
  using (usuario_id = auth.uid());

-- Marca como leído todo lo que hay hasta ahora en ese chat.
create or replace function public.taxi_marcar_mensajes_leidos(p_canal text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_canal not in ('taxipe', 'tonazo') then
    return false;
  end if;
  insert into public.mensajes_plataforma_leidos (usuario_id, canal, leido_hasta)
  values (auth.uid(), p_canal, now())
  on conflict (usuario_id, canal) do update set leido_hasta = now();
  return true;
end;
$$;
revoke execute on function public.taxi_marcar_mensajes_leidos(text) from public, anon;
grant execute on function public.taxi_marcar_mensajes_leidos(text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mensajes_plataforma'
  ) then
    alter publication supabase_realtime add table public.mensajes_plataforma;
  end if;
end $$;

-- Mensaje de bienvenida en cada chat (una sola vez).
insert into public.mensajes_plataforma (canal, titulo, mensaje, roles)
select 'taxipe', '¡Bienvenido a Taxi PE!',
       'Aquí te llegarán las novedades, avisos y actualizaciones de Taxi PE.',
       array['pasajero', 'conductor', 'recolector']
where not exists (select 1 from public.mensajes_plataforma where canal = 'taxipe');
insert into public.mensajes_plataforma (canal, titulo, mensaje, roles)
select 'tonazo', '¡Bienvenido a Tonazo!',
       'Aquí te llegarán las novedades, promociones y actualizaciones de Tonazo.',
       array['pasajero', 'conductor', 'recolector']
where not exists (select 1 from public.mensajes_plataforma where canal = 'tonazo');

notify pgrst, 'reload schema';
