-- Descripciones de la app (texto bajo el logo) + "Mostrar a" en anuncios
-- =====================================================================
-- 1) descripciones_app: mensajes que el Admin escribe desde su panel
--    (Gestor de Descripciones) y que se escriben solos debajo del logo,
--    después de la frase de siempre ("Tu taxi, al toque" en el pasajero,
--    el nombre en el conductor). Cada una va a pasajeros, a conductores
--    o a ambos ('todos'). Máximo 40 caracteres (entra en 2 líneas en el
--    celular). En tiempo real: un cambio se ve al instante.
-- 2) anuncios.publico: a quién se muestra cada pop-up (pasajeros,
--    conductores o ambos). Por defecto 'pasajeros' = igual que hasta
--    ahora (solo en la Home del pasajero).
--
-- Permisos: Taxi-PE todavía no tiene un rol de admin en la base (el
-- panel entra con el código maestro en la app y usa la clave pública),
-- así que, igual que 'anuncios', la escritura queda abierta — mismo
-- pendiente de endurecer RLS que el resto de las tablas.
--
-- Idempotente. Correr en el SQL Editor de Taxi-PE.

create table if not exists public.descripciones_app (
  id          uuid primary key default gen_random_uuid(),
  texto       text not null check (char_length(btrim(texto)) between 1 and 40),
  publico     text not null default 'todos' check (publico in ('pasajeros', 'conductores', 'todos')),
  activo      boolean not null default true,
  orden       int not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.descripciones_app enable row level security;

drop policy if exists "descripciones_app_select" on public.descripciones_app;
create policy "descripciones_app_select" on public.descripciones_app
  for select using (true);

drop policy if exists "descripciones_app_escribir" on public.descripciones_app;
create policy "descripciones_app_escribir" on public.descripciones_app
  for all using (true) with check (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'descripciones_app'
  ) then
    execute 'alter publication supabase_realtime add table public.descripciones_app';
  end if;
end $$;

-- Anuncios: a quién se muestran.
alter table public.anuncios add column if not exists publico text not null default 'pasajeros';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'anuncios_publico_check') then
    alter table public.anuncios
      add constraint anuncios_publico_check check (publico in ('pasajeros', 'conductores', 'todos'));
  end if;
end $$;

notify pgrst, 'reload schema';
