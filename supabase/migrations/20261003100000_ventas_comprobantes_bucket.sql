-- Bucket para las fotos de comprobante de las ventas que registra el
-- Admin desde el gestor ⚡ del conductor (Recarga rápida, igual que el
-- super admin de Caja): Tomar foto / Adjuntar → se comprime y se guarda
-- acá, y su URL va a ventas.voucher_url (se ve en Historial, Pagos y en
-- el gestor). El recolector sigue solo escaneando, sin guardar la foto.
-- Lectura pública (las URLs se muestran en la app); subida con la misma
-- clave anónima con la que trabaja toda la app (Taxi-PE no usa Supabase
-- Auth), acotada a este bucket.
-- Idempotente. Correr en el SQL Editor de Taxi-PE.

insert into storage.buckets (id, name, public)
values ('ventas-comprobantes', 'ventas-comprobantes', true)
on conflict (id) do update set public = true;

drop policy if exists "ventas_comprobantes_select" on storage.objects;
create policy "ventas_comprobantes_select" on storage.objects
  for select using (bucket_id = 'ventas-comprobantes');

drop policy if exists "ventas_comprobantes_insert" on storage.objects;
create policy "ventas_comprobantes_insert" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'ventas-comprobantes');
