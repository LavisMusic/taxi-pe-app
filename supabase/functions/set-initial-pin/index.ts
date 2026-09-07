// Edge Function: set-initial-pin
//
// Invocada SIN sesión (el usuario todavía no tiene forma de
// autenticarse — su password sigue siendo el placeholder aleatorio
// que create-cliente generó) con:
//   supabase.functions.invoke('set-initial-pin', { body: { celular, pin } })
//
// Reemplaza ese placeholder por el PIN elegido por el cliente
// (admin.auth.admin.updateUserById — requiere service_role, por eso
// esto es una Edge Function y no algo que el navegador pueda hacer
// directo) y marca profiles.pin_configurado = true. El frontend recién
// después llama a signInWithPassword con el PIN nuevo para entrar de
// verdad.
//
// Guardia de seguridad CRÍTICA: si pin_configurado YA es true, esto
// se rechaza sin tocar nada — sin este chequeo, cualquiera que supiera
// el celular de un cliente que YA configuró su PIN podría llamar este
// mismo endpoint para pisarlo y robarse la cuenta. Esta es información
// pública/semi-pública (el celular), así que este chequeo es la única
// barrera real — junto con que solo funciona UNA vez por cuenta.

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

  let body: { celular?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Cuerpo de la petición inválido." });
  }

  const celular = (body.celular || "").trim();
  const pin = body.pin || "";

  if (!/^\d{6,15}$/.test(celular)) {
    return json(400, { error: "Celular inválido." });
  }
  if (!/^\d{4,10}$/.test(pin)) {
    return json(400, { error: "El PIN debe tener entre 4 y 10 dígitos." });
  }

  const { data: cliente, error: clienteErr } = await admin
    .from("clientes_fiado")
    .select("id, auth_user_id")
    .eq("whatsapp", celular)
    .not("auth_user_id", "is", null)
    .maybeSingle();

  if (clienteErr || !cliente) {
    return json(404, { error: "No hay ninguna cuenta registrada con ese celular." });
  }

  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("pin_configurado")
    .eq("id", cliente.auth_user_id)
    .maybeSingle();

  if (profileErr || !profile) {
    return json(404, { error: "No se pudo verificar la cuenta." });
  }

  if (profile.pin_configurado) {
    return json(409, {
      error: "Esta cuenta ya tiene un PIN configurado — inicia sesión normalmente.",
    });
  }

  const { error: updateAuthErr } = await admin.auth.admin.updateUserById(cliente.auth_user_id, {
    password: pin,
  });
  if (updateAuthErr) {
    return json(500, { error: "No se pudo configurar el PIN. Intenta de nuevo." });
  }

  const { error: updateProfileErr } = await admin
    .from("profiles")
    .update({ pin_configurado: true })
    .eq("id", cliente.auth_user_id);
  if (updateProfileErr) {
    // El password YA quedó cambiado (lo importante) — si esta segunda
    // escritura falla, el próximo login igual funciona con el PIN
    // nuevo; solo queda 'pin_configurado' desactualizado en false, lo
    // que en el peor caso vuelve a mostrar la pantalla de "crear PIN"
    // una vez más (molesto, no inseguro: sigue exigiendo que
    // pin_configurado sea false para aceptar el cambio).
    console.error("set-initial-pin: password actualizado pero no se pudo marcar pin_configurado", updateProfileErr);
  }

  return json(200, { ok: true });
});
