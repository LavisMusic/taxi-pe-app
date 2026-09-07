// Edge Function: check-pin-status
//
// Invocada SIN sesión (el usuario todavía no inició sesión — es
// justamente lo que este endpoint decide cómo resolver) con:
//   supabase.functions.invoke('check-pin-status', { body: { celular } })
//
// Devuelve ÚNICAMENTE { exists, pinConfigured } — nunca nombre, id, ni
// ningún otro dato — para que LoginModal sepa si mostrar la pantalla
// normal de "Ingresa tu PIN" o la de "Crea tu PIN" (primer login de
// una cuenta que el admin registró solo con nombre + teléfono).
//
// Nota de seguridad: al ser público, este endpoint SÍ permite
// verificar si un número de celular está registrado (un oráculo de
// existencia mínimo) — es una consecuencia inevitable de que el flujo
// de "crear PIN en el primer login" pedido tenga que decidir qué
// pantalla mostrar ANTES de autenticar a nadie. Se limita el daño no
// devolviendo ningún otro dato del cliente.

import { createClient } from "npm:@supabase/supabase-js@2";

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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: { celular?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Cuerpo de la petición inválido." });
  }

  const celular = (body.celular || "").trim();
  if (!/^\d{6,15}$/.test(celular)) {
    return json(400, { error: "Celular inválido." });
  }

  const { data: cliente, error: clienteErr } = await admin
    .from("clientes_fiado")
    .select("auth_user_id")
    .eq("whatsapp", celular)
    .not("auth_user_id", "is", null)
    .maybeSingle();

  if (clienteErr || !cliente) {
    return json(200, { exists: false, pinConfigured: false });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("pin_configurado")
    .eq("id", cliente.auth_user_id)
    .maybeSingle();

  return json(200, {
    exists: true,
    pinConfigured: profile?.pin_configurado ?? true,
  });
});
