// Handshake de una entrega delivery: la app de Caja Tonazo llama acá
// (firma HMAC, igual que los webhooks) cuando el cajero va a asignar un
// repartidor. Reemplaza al webhook 3.2 `caja.pedido_delivery`.
// Ver DELIVERY.md §2.
//
// Entrada (sobre firmado, event_type = "caja.entrega_crear"):
//   data.pedido = { caja_pedido_ref, sucursal, cliente_nombre,
//                   cliente_telefono, direccion_entrega, entrega_lat,
//                   entrega_lng, items, total }
// Salida:
//   { entrega_id, session_token, pin, qr_payload }
//   - session_token: la app de Caja lo usa como parámetro de los RPCs
//     rpc_entrega_* (no hay JWT — el proyecto usa llaves asimétricas).
//   - qr_payload = pin (el QR codifica el PIN, DELIVERY.md §6).
//
// Deploy: supabase functions deploy entrega-crear --no-verify-jwt --project-ref silfhbdmfdryjdzpwzvh
// Secrets: WEBHOOK_SECRET_CAJA_TO_TAXI (ya está). SUPABASE_URL /
//          SUPABASE_SERVICE_ROLE_KEY son automáticos.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse, verifyWebhook } from "../_shared/webhook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET_CAJA_TO_TAXI")!;

const EXPECTED_EVENT = "caja.entrega_crear";

function pin6(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });

  const v = await verifyWebhook(req, WEBHOOK_SECRET);
  if (!v.ok) return jsonResponse(v.status, { error: v.error });

  const env = v.envelope!;
  if (env.event_type !== EXPECTED_EVENT) {
    return jsonResponse(400, { error: `event_type inesperado: ${env.event_type}` });
  }

  const p = (env.data?.pedido ?? {}) as Record<string, unknown>;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const pin = pin6();

  const { data: row, error } = await supabase
    .from("entregas")
    .insert({
      caja_sucursal: p.sucursal ?? null,
      caja_pedido_ref: p.caja_pedido_ref ?? null,
      cliente_nombre: p.cliente_nombre ?? null,
      cliente_telefono: p.cliente_telefono ?? null,
      direccion_entrega: p.direccion_entrega ?? null,
      entrega_lat: p.entrega_lat ?? null,
      entrega_lng: p.entrega_lng ?? null,
      origen_lat: p.origen_lat ?? null,
      origen_lng: p.origen_lng ?? null,
      items: p.items ?? [],
      total: p.total ?? null,
      pin,
    })
    .select("id, session_token")
    .single();

  if (error) {
    console.error("[entrega-crear] insert error:", error);
    return jsonResponse(500, { error: "no se pudo crear la entrega", detail: error.message });
  }

  return jsonResponse(200, {
    entrega_id: row.id,
    session_token: row.session_token,
    pin,
    qr_payload: pin,
  });
});
