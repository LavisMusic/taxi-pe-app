-- =========================================================================
-- Anuncios (los crea el superadmin desde Caja Tonazo): vistos por persona
-- y botón con enlace — igual que la migración 0125 de Caja.
--
--   * anuncios_vistos: con sesión, "Una sola vez" se recuerda por persona
--     (antes, por navegador) y "Programado (una vez al día)", cada 24 h.
--   * anuncios.boton_url / boton_texto: botón al pie del anuncio que abre
--     el enlace en otra pestaña (hasta 16 letras; por defecto "VAMOS").
--     Llegan por webhook-caja-superadmin.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.anuncios add column if not exists boton_url text;
alter table public.anuncios add column if not exists boton_texto text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'anuncios_boton_valido') then
    alter table public.anuncios add constraint anuncios_boton_valido check (
      (boton_url is null or boton_url ~* '^https?://\S+$')
      and (boton_texto is null or char_length(boton_texto) between 1 and 16)
    );
  end if;
end $$;

create table if not exists public.anuncios_vistos (
  anuncio_id uuid not null references public.anuncios(id) on delete cascade,
  usuario_id uuid not null default auth.uid(),
  visto_at   timestamptz not null default now(),
  primary key (anuncio_id, usuario_id)
);
alter table public.anuncios_vistos enable row level security;
drop policy if exists anuncios_vistos_propios on public.anuncios_vistos;
create policy anuncios_vistos_propios on public.anuncios_vistos
  for all to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());
grant select, insert, update on public.anuncios_vistos to authenticated;

notify pgrst, 'reload schema';
