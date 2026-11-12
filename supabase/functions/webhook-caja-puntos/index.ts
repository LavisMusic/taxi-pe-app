// Receptor de `caja.puntos_cliente` (Caja → Taxi-PE): puntos del cliente
// por un pedido online terminado ('suma') o cancelado/revertido después
// ('resta'). Créditos, fase B — ver migración 20261014120000_puntos_clientes.sql.
//
// Flujo: verificar HMAC → llamar rpc_webhook_caja_puntos (idempotencia,
// registro del movimiento y acreditación al cliente). Toda la lógica de
// dominio vive en el RPC.
//
// Deploy: supabase functions deploy webhook-caja-puntos --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse, verifyWebhook } from "../_shared/webhook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET_CAJA_TO_TAXI")!;

const EXPECTED_EVENT = "caja.puntos_cliente";
// Gemas cruzadas (migración 20261106100000_gemas.sql): mismo receptor.
const EVENTOS_GEMAS = ["caja.gema_verde", "caja.gemas_celestes", "caja.gemas_config"];
// Contrato negocio–repartidor y pago del envío (20261107100000).
const EVENTOS_REPARTO = ["caja.contrato_invitar", "caja.contrato_terminar", "caja.envio_pagado"];
// Reputación 1b (20261115100000): el cliente o el negocio califican al repartidor.
const EVENTO_CALIFICACION = "caja.calificacion";
// Reportes 4b-2 (20261121100000): el cliente o el negocio reportan al
// repartidor, y el resultado de un reporte que el repartidor hizo.
const EVENTOS_REPORTE = ["caja.reporte", "caja.reporte_resuelto"];

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });

  const v = await verifyWebhook(req, WEBHOOK_SECRET);
  if (!v.ok) return jsonResponse(v.status, { error: v.error });

  const env = v.envelope!;
  const esGemas = EVENTOS_GEMAS.includes(env.event_type);
  const esReparto = EVENTOS_REPARTO.includes(env.event_type);
  const esCalificacion = env.event_type === EVENTO_CALIFICACION;
  const esReporte = EVENTOS_REPORTE.includes(env.event_type);
  if (env.event_type !== EXPECTED_EVENT && !esGemas && !esReparto && !esCalificacion && !esReporte) {
    return jsonResponse(400, { error: `event_type inesperado: ${env.event_type}` });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const rpc = esReporte
    ? "rpc_webhook_caja_reporte"
    : esCalificacion
    ? "rpc_webhook_caja_calificacion"
    : esReparto
    ? "rpc_webhook_caja_reparto"
    : esGemas
    ? "rpc_webhook_caja_gemas"
    : "rpc_webhook_caja_puntos";
  const { data, error } = await supabase.rpc(rpc, {
    p_event_id: env.event_id,
    p_payload: env,
  });

  if (error) {
    console.error("[webhook-caja-puntos] RPC error:", error);
    return jsonResponse(500, { error: "fallo al aplicar el evento", detail: error.message });
  }

  // data.status ∈ { ok, duplicado, pendiente, sin_suma, invalido }. Todos son
  // 200: el emisor no debe reintentar (el evento llegó y se procesó).
  return jsonResponse(200, data ?? { status: "ok" });
});
