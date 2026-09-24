// Consulta en vivo (Caja -> Taxi-PE) del saldo de un pasajero/cliente:
// créditos disponibles y vencimiento de membresía. Lo llama Caja Tonazo
// server a servidor cada vez que un cliente abre la tienda, para pintar
// el mini-badge de membresía+créditos en su header (unificación
// pasajero/cliente) — nada se guarda de este lado ni del otro, es una
// lectura al vuelo, sin caché.
//
// Misma infra HMAC que el resto de webhooks Taxi-PE<->Caja
// (WEBHOOK_SECRET_CAJA_TO_TAXI, ya configurado para esta dirección) —
// reusa verifyWebhook aunque esto no sea un evento con efectos que
// deduplicar, solo para no tener dos esquemas de firma distintos en el
// mismo repo.
//
// Deploy: supabase functions deploy saldo-pasajero --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse, verifyWebhook } from "../_shared/webhook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET_CAJA_TO_TAXI")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });

  const v = await verifyWebhook(req, WEBHOOK_SECRET);
  if (!v.ok) return jsonResponse(v.status, { error: v.error });

  const env = v.envelope!;
  if (env.event_type !== "caja.consultar_saldo") {
    return jsonResponse(400, { error: `event_type inesperado: ${env.event_type}` });
  }

  const telefono = String((env.data as Record<string, unknown>)?.telefono || "").trim();
  if (!telefono) return jsonResponse(400, { error: "falta telefono" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await admin
    .from("usuarios")
    .select("creditos_disponibles, membresia_vencimiento")
    .eq("telefono", telefono)
    .eq("rol", "pasajero")
    .maybeSingle();

  if (error) {
    console.error("[saldo-pasajero] error consultando usuarios:", error);
    return jsonResponse(500, { error: "no se pudo consultar el saldo" });
  }

  // Sin fila (cliente que nunca puso PIN en Caja, o nunca entró a
  // Taxi-PE): no es un error, simplemente todavía no tiene cuenta
  // espejada — el badge del lado de Caja lo muestra en 0/sin membresía.
  return jsonResponse(200, {
    creditos_disponibles: data?.creditos_disponibles ?? 0,
    membresia_vencimiento: data?.membresia_vencimiento ?? null,
  });
});
