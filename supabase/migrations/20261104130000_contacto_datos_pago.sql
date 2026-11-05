-- =========================================================================
-- Datos de pago de la plataforma en Taxi-PE (Yape/Plin, titular, cuenta).
--
-- El superadmin los guarda en Caja; hasta ahora a Taxi-PE solo llegaban los
-- WhatsApp. Con estas columnas (y webhook-caja-contacto actualizado) el
-- conductor, el recolector y el cliente ven a dónde pagar en sus modales de
-- recarga y compra.
--
-- Orden: 1) esta migración, 2) publicar webhook-caja-contacto, 3) correr la
-- 0134 de Caja (que reenvía los datos).
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================

alter table public.plataforma_contacto add column if not exists yape_plin text;
alter table public.plataforma_contacto add column if not exists titular text;
alter table public.plataforma_contacto add column if not exists cuenta_bancaria text;

notify pgrst, 'reload schema';
