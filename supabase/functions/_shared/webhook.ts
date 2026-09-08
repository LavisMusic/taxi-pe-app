// Verificación HMAC compartida por todas las Edge Functions receptoras de
// webhooks (Taxi-PE ↔ Caja). Ver WEBHOOKS.md §2.
//
// El que llama es un servidor (trigger + pg_net del otro proyecto
// Supabase), no un usuario — estas funciones se despliegan con
// `--no-verify-jwt` y ESTA firma es la única autenticación.

const encoder = new TextEncoder();

const MAX_SKEW_SECONDS = 300; // ventana anti-replay

export interface WebhookEnvelope {
  event_id: string;
  event_type: string;
  occurred_at: string;
  source: "taxi" | "caja";
  data: Record<string, unknown>;
}

export interface VerifyResult {
  ok: boolean;
  status: number; // 200 si ok, 401 si falla la auth, 400 si el sobre está mal
  error?: string;
  envelope?: WebhookEnvelope;
  eventId?: string;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacBase64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/**
 * Lee el cuerpo crudo de la request, valida timestamp + firma HMAC y
 * parsea el sobre. NO toca la base de datos.
 *
 * @param req      la Request entrante
 * @param secret   el secreto compartido de ESTA dirección
 *                 (Deno.env.get("WEBHOOK_SECRET_CAJA_TO_TAXI") en Taxi-PE)
 */
export async function verifyWebhook(req: Request, secret: string): Promise<VerifyResult> {
  if (!secret) return { ok: false, status: 500, error: "falta WEBHOOK_SECRET en el entorno" };

  const sigHeader = req.headers.get("X-Webhook-Signature") ?? "";
  const tsHeader = req.headers.get("X-Webhook-Timestamp") ?? "";
  const idHeader = req.headers.get("X-Webhook-Id") ?? "";

  if (!sigHeader || !tsHeader || !idHeader) {
    return { ok: false, status: 401, error: "faltan headers de firma" };
  }

  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) return { ok: false, status: 401, error: "timestamp inválido" };
  const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (skew > MAX_SKEW_SECONDS) {
    return { ok: false, status: 401, error: `timestamp fuera de ventana (${skew}s)` };
  }

  const rawBody = await req.text();
  const expected = await hmacBase64(secret, `${ts}.${rawBody}`);
  if (!timingSafeEqual(sigHeader, expected)) {
    return { ok: false, status: 401, error: "firma no coincide" };
  }

  let envelope: WebhookEnvelope;
  try {
    envelope = JSON.parse(rawBody);
  } catch {
    return { ok: false, status: 400, error: "cuerpo no es JSON" };
  }
  if (!envelope?.event_id || !envelope?.event_type || !envelope?.data) {
    return { ok: false, status: 400, error: "sobre incompleto" };
  }
  if (envelope.event_id !== idHeader) {
    return { ok: false, status: 400, error: "X-Webhook-Id ≠ event_id del cuerpo" };
  }

  return { ok: true, status: 200, envelope, eventId: envelope.event_id };
}

export function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
