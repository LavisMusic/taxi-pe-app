// Edge Function: mirror-a-caja
//
// Invocada por el frontend de Taxi-PE (usePasajeroAuth.js) justo
// después de que un pasajero crea o cambia su PIN, con:
//   supabase.functions.invoke('mirror-a-caja', { body: { telefono, pin, nombre } })
//
// Sin sesión (el pasajero no tiene JWT de Supabase — su auth es la
// tabla propia 'usuarios', no Supabase Auth). Antes de reenviar nada,
// RE-VERIFICA server-side que ese 'pin' en texto plano de verdad
// coincide con el hash recién guardado en usuarios.pin para ese
// teléfono — sin este chequeo, cualquiera podría llamar este endpoint
// público con un teléfono ajeno y forzar la creación/reset de una
// cuenta de Caja con un PIN de su elección.
//
// Reusa la infra HMAC de WEBHOOKS.md. La clave Taxi -> Caja se lee del
// Vault (webhook_secret_taxi_to_caja, la misma que usan los avisos que
// salen de la base) con service_role; WEBHOOK_SECRET_TAXI_TO_CAJA como
// variable de la función queda solo como alternativa. Antes solo se leía
// la variable, que nunca se configuró en este proyecto: el espejo fallaba
// siempre con 500.
//
// `motivo` ('alta' | 'login' | 'cambio_pin'): Caja solo pisa el PIN de
// una cuenta que YA existe allá si es un cambio de PIN de verdad, y eso
// se comprueba acá: el usuario tiene que haber elegido su PIN nuevo con
// el código del Admin en los últimos 10 minutos (peticiones_pin.
// restablecido_en, migración 20261017110000). Si no, Caja solo crea la
// cuenta cuando falta: nadie puede cambiar el PIN de Caja de otro con
// solo registrarse acá con su número.
//
// Deploy: supabase functions deploy mirror-a-caja --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET_ENV = Deno.env.get("WEBHOOK_SECRET_TAXI_TO_CAJA") ?? "";
const CAJA_MIRROR_URL =
  Deno.env.get("CAJA_MIRROR_CUENTA_URL") ||
  "https://xaerfywydzwifohjsvwa.supabase.co/functions/v1/webhook-taxi-mirror-cuenta";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const enc = new TextEncoder();
async function hmacB64(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  let body: { telefono?: string; pin?: string; nombre?: string; motivo?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "cuerpo inválido" });
  }

  const telefono = (body.telefono || "").trim();
  const pin = body.pin || "";
  if (!telefono || !pin) return json(400, { error: "faltan telefono/pin" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let webhookSecret = WEBHOOK_SECRET_ENV;
  if (!webhookSecret) {
    const { data: secreto } = await admin.rpc("fn_webhook_secret", { p_nombre: "webhook_secret_taxi_to_caja" });
    webhookSecret = typeof secreto === "string" ? secreto : "";
  }
  if (!webhookSecret) return json(500, { error: "falta la clave webhook_secret_taxi_to_caja" });

  // Anti-abuso: el pin en texto plano tiene que coincidir de verdad con
  // el hash que YA está guardado para ese teléfono — si no, no se
  // reenvía nada.
  // (El hash vive en usuarios_credenciales; taxi_pin_correcto compara en
  // la base, ver la migración 20261009100000.)
  const { data: match, error: findErr } = await admin
    .from("usuarios")
    .select("id, nombre, pin, creditos_disponibles, membresia_vencimiento")
    .eq("telefono", telefono)
    .eq("rol", "pasajero")
    .maybeSingle();

  if (findErr || !match?.pin) {
    return json(404, { error: "cuenta no encontrada" });
  }

  const { data: valido, error: verifyErr } = await admin.rpc("taxi_pin_correcto", {
    p_telefono: telefono,
    p_rol: "pasajero",
    p_pin: pin,
  });
  if (verifyErr || valido !== true) {
    return json(403, { error: "pin no coincide" });
  }

  // Cambio de PIN real: eligió el PIN nuevo con el código del Admin hace
  // menos de 10 minutos.
  let sobrescribirPin = false;
  if (body.motivo === "cambio_pin") {
    const desde = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: restablecido } = await admin
      .from("peticiones_pin")
      .select("id")
      .eq("usuario_id", match.id)
      .gte("restablecido_en", desde)
      .limit(1);
    sobrescribirPin = (restablecido?.length ?? 0) > 0;
  }

  const eventId = crypto.randomUUID();
  const sobre = JSON.stringify({
    event_id: eventId,
    event_type: "taxi.mirror_pasajero",
    occurred_at: new Date().toISOString(),
    source: "taxi",
    // Saldo viaja con el alta: la membresía gratis de registro nace en
    // el INSERT del pasajero (antes de que exista su fila en Caja), así
    // que el evento de saldo suelto llegaba antes y no tenía dónde
    // guardarse — ver aplicarSaldo en webhook-taxi-mirror-cuenta.
    data: {
      telefono,
      pin,
      nombre: body.nombre || match.nombre || null,
      creditos_disponibles: match.creditos_disponibles ?? 0,
      membresia_vencimiento: match.membresia_vencimiento ?? null,
      sobrescribir_pin: sobrescribirPin,
    },
  });
  const ts = Math.floor(Date.now() / 1000);
  const sig = await hmacB64(webhookSecret, `${ts}.${sobre}`);

  try {
    const r = await fetch(CAJA_MIRROR_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Id": eventId,
        "X-Webhook-Timestamp": String(ts),
        "X-Webhook-Signature": sig,
      },
      body: sobre,
    });
    if (!r.ok) {
      console.error("[mirror-a-caja] Caja respondió", r.status, await r.text());
      return json(502, { error: "Caja rechazó el espejo" });
    }
  } catch (err) {
    console.error("[mirror-a-caja] error de red", err);
    return json(502, { error: "no se pudo contactar a Caja" });
  }

  return json(200, { status: "ok" });
});
