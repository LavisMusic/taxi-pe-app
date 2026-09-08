// Receptor de `caja.pedido_delivery` (Caja → Taxi-PE). Ver WEBHOOKS.md §3.2.
//
// Verifica HMAC → llama rpc_webhook_caja_pedido_delivery (idempotencia +
// insert en pedidos_delivery_entrantes, que está en supabase_realtime →
// el panel de despacho lo ve en vivo). La asignación de vehículo es
// acción del lado Taxi-PE, no de este webhook.
//
// Deploy: supabase functions deploy webhook-caja-pedido-delivery --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse, verifyWebhook } from "../_shared/webhook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET_CAJA_TO_TAXI")!;

const EXPECTED_EVENT = "caja.pedido_delivery";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });

  const v = await verifyWebhook(req, WEBHOOK_SECRET);
  if (!v.ok) return jsonResponse(v.status, { error: v.error });

  const env = v.envelope!;
  if (env.event_type !== EXPECTED_EVENT) {
    return jsonResponse(400, { error: `event_type inesperado: ${env.event_type}` });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data, error } = await supabase.rpc("rpc_webhook_caja_pedido_delivery", {
    p_event_id: env.event_id,
    p_payload: env,
  });

  if (error) {
    console.error("[webhook-caja-pedido-delivery] RPC error:", error);
    return jsonResponse(500, { error: "fallo al aplicar el evento", detail: error.message });
  }

  return jsonResponse(200, data ?? { status: "ok" });
});
