-- =========================================================================
-- rpc_entrega_forzar_cancelacion solo desde el servidor.
--
-- La usa únicamente la Edge Function webhook-caja-entrega-cancelar (aviso
-- firmado de Caja, con la clave de servicio). Estaba abierta a anon y
-- authenticated: cualquiera con el id de una entrega podía cancelarla.
--
-- Proyecto: Taxi-PE. Idempotente.
-- =========================================================================
revoke execute on function public.rpc_entrega_forzar_cancelacion(uuid, text) from public, anon, authenticated;
grant execute on function public.rpc_entrega_forzar_cancelacion(uuid, text) to service_role;
