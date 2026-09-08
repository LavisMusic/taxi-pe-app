// Receptor de `caja.venta_fiado_conductor` (Caja → Taxi-PE). Ver WEBHOOKS.md §3.1.
//
// Flujo: verificar HMAC → llamar rpc_webhook_caja_venta_fiado (que hace
// idempotencia + resuelve conductor + inserta el cargo en
// fiados_conductores). Toda la lógica de dominio vive en el RPC.
//
// Deploy: supabase functions deploy webhook-caja-fiado-conductor --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse, verifyWebhook } from "../_shared/webhook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET_CAJA_TO_TAXI")!;

const EXPECTED_EVENT = "caja.venta_fiado_conductor";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });

  const v = await verifyWebhook(req, WEBHOOK_SECRET);
  if (!v.ok) return jsonResponse(v.status, { error: v.error });

  const env = v.envelope!;
  if (env.event_type !== EXPECTED_EVENT) {
    return jsonResponse(400, { error: `event_type inesperado: ${env.event_type}` });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data, error } = await supabase.rpc("rpc_webhook_caja_venta_fiado", {
    p_event_id: env.event_id,
    p_payload: env,
  });

  if (error) {
    console.error("[webhook-caja-fiado-conductor] RPC error:", error);
    return jsonResponse(500, { error: "fallo al aplicar el evento", detail: error.message });
  }

  // data.status ∈ { ok, duplicado, sin_match }. Todos son 200: el emisor
  // no debe reintentar (el evento llegó y se procesó o quedó para
  // conciliación manual).
  return jsonResponse(200, data ?? { status: "ok" });
});
