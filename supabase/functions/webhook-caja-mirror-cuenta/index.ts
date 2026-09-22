// Receptor de eventos de espejo de cuenta (Caja -> Taxi-PE). Ver
// migración 20260918140000_mirror_cuenta_caja.sql (alta/PIN) y
// 20260922130000_mirror_cuenta_eliminar.sql (borrado).
//
// Flujo: verificar HMAC -> despachar al RPC correspondiente (idempotencia
// + upsert/delete en 'usuarios'). Toda la lógica de dominio vive en el RPC.
//
// Deploy: supabase functions deploy webhook-caja-mirror-cuenta --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse, verifyWebhook } from "../_shared/webhook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET_CAJA_TO_TAXI")!;

const RPC_POR_EVENTO: Record<string, string> = {
  "caja.mirror_cliente": "rpc_webhook_caja_mirror_cliente",
  "caja.mirror_cliente_eliminado": "rpc_webhook_caja_eliminar_cliente",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });

  const v = await verifyWebhook(req, WEBHOOK_SECRET);
  if (!v.ok) return jsonResponse(v.status, { error: v.error });

  const env = v.envelope!;
  const rpcName = RPC_POR_EVENTO[env.event_type];
  if (!rpcName) {
    return jsonResponse(400, { error: `event_type inesperado: ${env.event_type}` });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data, error } = await supabase.rpc(rpcName, {
    p_event_id: env.event_id,
    p_payload: env,
  });

  if (error) {
    console.error("[webhook-caja-mirror-cuenta] RPC error:", error);
    return jsonResponse(500, { error: "fallo al aplicar el evento", detail: error.message });
  }

  return jsonResponse(200, data ?? { status: "ok" });
});
