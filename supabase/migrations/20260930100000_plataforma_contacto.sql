-- Contacto de la plataforma (copia de Caja Tonazo)
-- =================================================
-- El super admin edita los WhatsApp de pagos / soporte / afiliación en
-- el panel /superadmin de Caja; cada cambio llega acá por el webhook
-- firmado 'caja.contacto_plataforma' (función webhook-caja-contacto),
-- que escribe con service_role. Taxi-PE solo lo LEE (botón "Soporte"
-- de la cabecera y el aviso de cuenta eliminada) — así no depende de
-- que Caja esté en línea para mostrar el número.
--
-- Correr ANTES de la migración 0087 de Caja. Idempotente.

create table if not exists public.plataforma_contacto (
  id                   int primary key default 1 check (id = 1),
  whatsapp_pagos       text,
  whatsapp_soporte     text,
  whatsapp_afiliacion  text,
  updated_at           timestamptz not null default now()
);

alter table public.plataforma_contacto enable row level security;

drop policy if exists "plataforma_contacto_select" on public.plataforma_contacto;
create policy "plataforma_contacto_select" on public.plataforma_contacto
  for select using (true);

-- Valor inicial (el mismo que arranca en Caja), por si el primer
-- webhook todavía no llegó.
insert into public.plataforma_contacto (id, whatsapp_pagos, whatsapp_soporte, whatsapp_afiliacion)
values (1, '914964330', '914964330', '914964330')
on conflict (id) do nothing;
