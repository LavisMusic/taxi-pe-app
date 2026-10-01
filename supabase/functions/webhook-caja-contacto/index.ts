// Receptor de `caja.contacto_plataforma` (Caja → Taxi-PE).
//
// El super admin cambió los WhatsApp de contacto de la plataforma en el
// panel /superadmin de Caja → se copian a public.plataforma_contacto de
// Taxi-PE (una sola fila, id = 1).
//
//   data = { whatsapp_pagos, whatsapp_soporte, whatsapp_afiliacion }
//
// Deploy: supabase functions deploy webhook-caja-contacto --no-verify-jwt --project-ref silfhbdmfdryjdzpwzvh

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse, verifyWebhook } from "../_shared/webhook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET_CAJA_TO_TAXI")!;

const EXPECTED_EVENT = "caja.contacto_plataforma";

const limpiar = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.replace(/\D/g, "") : "";
  return s ? s : null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });

  const v = await verifyWebhook(req, WEBHOOK_SECRET);
  if (!v.ok) return jsonResponse(v.status, { error: v.error });

  const env = v.envelope!;
  if (env.event_type !== EXPECTED_EVENT) {
    return jsonResponse(400, { error: `event_type inesperado: ${env.event_type}` });
  }

  const data = (env.data ?? {}) as Record<string, unknown>;
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { error } = await supabase.from("plataforma_contacto").upsert({
    id: 1,
    whatsapp_pagos: limpiar(data.whatsapp_pagos),
    whatsapp_soporte: limpiar(data.whatsapp_soporte),
    whatsapp_afiliacion: limpiar(data.whatsapp_afiliacion),
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[webhook-caja-contacto] upsert error:", error);
    return jsonResponse(500, { error: "no se pudo guardar el contacto", detail: error.message });
  }
  return jsonResponse(200, { status: "ok" });
});
