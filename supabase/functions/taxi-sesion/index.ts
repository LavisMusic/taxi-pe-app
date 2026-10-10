// Edge Function: taxi-sesion
//
// Canjea un TICKET de un solo uso (lo emite la base al entrar: taxi_login,
// taxi_crear_pin, taxi_fijar_pin_recuperacion, taxi_registrar_temporal,
// taxi_admin_login…; dura 2 minutos) por una sesión normal de Supabase
// Auth. Ver la migración 20261010100000_sesiones_reales.sql.
//
//   supabase.functions.invoke('taxi-sesion', { body: { ticket } })
//   → { access_token, refresh_token, expires_at, ... }
//
// Cada usuario de 'usuarios' tiene una cuenta interna en auth.users con
// el MISMO id (así auth.uid() = usuarios.id) y el rol en app_metadata;
// el Admin tiene una cuenta fija aparte. El correo es interno (dominio
// .invalid, nunca se envía nada): la sesión se crea con un enlace mágico
// generado y verificado acá mismo, sin manejar ninguna clave de firma.
//
// Deploy: supabase functions deploy taxi-sesion --project-ref silfhbdmfdryjdzpwzvh

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Cuenta interna fija del Admin (no tiene fila en 'usuarios').
const ADMIN_AUTH_ID = "00000000-0000-4000-8000-0000000a0001";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  let ticket = "";
  try {
    ticket = String((await req.json())?.ticket || "");
  } catch {
    return json(400, { error: "cuerpo inválido" });
  }
  if (!/^[0-9a-f-]{36}$/i.test(ticket)) return json(400, { error: "ticket inválido" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: canje, error: canjeErr } = await admin.rpc("taxi_canjear_ticket", { p_ticket: ticket });
  if (canjeErr || !canje) return json(401, { error: "ticket vencido o usado" });

  const rol: string = canje.rol;
  const id: string = rol === "admin" ? ADMIN_AUTH_ID : canje.usuario_id;
  const email = rol === "admin" ? "admin@taxipe.invalid" : `${id}@usuarios.taxipe.invalid`;
  const app_metadata = { rol, usuario_id: rol === "admin" ? null : id };

  // La cuenta interna existe o se crea; el rol se mantiene al día.
  const { error: crearErr } = await admin.auth.admin.createUser({ id, email, email_confirm: true, app_metadata });
  if (crearErr) {
    const { error: actErr } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true, app_metadata });
    if (actErr) return json(500, { error: "no se pudo preparar la cuenta" });
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return json(500, { error: "no se pudo crear la sesión" });

  const publico = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { data: sesion, error: otpErr } = await publico.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
  if (otpErr || !sesion?.session) return json(500, { error: "no se pudo crear la sesión" });

  const s = sesion.session;
  return json(200, {
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_in: s.expires_in,
    expires_at: s.expires_at,
    token_type: s.token_type,
  });
});
