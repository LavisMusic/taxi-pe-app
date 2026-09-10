// Receptor de `caja.entrega_cancelar` (Caja → Taxi-PE). Ver DELIVERY.md §5.
//
// El cliente o el cajero cancelaron un pedido de la Caja que tenía una
// entrega en curso → hay que cerrar esa entrega acá (el conductor deja de
// tenerla activa en su próximo poll).
//
//   data = { entrega_id, motivo? }
//
// Deploy: supabase functions deploy webhook-caja-entrega-cancelar --no-verify-jwt --project-ref silfhbdmfdryjdzpwzvh

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse, verifyWebhook } from "../_shared/webhook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET_CAJA_TO_TAXI")!;

const EXPECTED_EVENT = "caja.entrega_cancelar";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });

  const v = await verifyWebhook(req, WEBHOOK_SECRET);
  if (!v.ok) return jsonResponse(v.status, { error: v.error });

  const env = v.envelope!;
  if (env.event_type !== EXPECTED_EVENT) {
    return jsonResponse(400, { error: `event_type inesperado: ${env.event_type}` });
  }

  const entregaId = String((env.data as Record<string, unknown>)?.entrega_id ?? "");
  const motivo = ((env.data as Record<string, unknown>)?.motivo as string) ?? null;
  if (!entregaId) return jsonResponse(400, { error: "sin entrega_id" });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await supabase.rpc("rpc_entrega_forzar_cancelacion", {
    p_entrega_id: entregaId,
    p_motivo: motivo,
  });

  if (error) {
    console.error("[webhook-caja-entrega-cancelar] RPC error:", error);
    return jsonResponse(500, { error: "fallo al cancelar la entrega", detail: error.message });
  }

  // status ∈ { ok, no_encontrada }. Ambos 200: el emisor no reintenta.
  return jsonResponse(200, data ?? { status: "ok" });
});
