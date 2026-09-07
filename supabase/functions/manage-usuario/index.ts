// Edge Function: manage-usuario
//
// Invocada desde el panel de administración de Usuarios (App.jsx) con:
//   supabase.functions.invoke('manage-usuario', { body: { action: 'reset-pin', userId, pin } })
//   supabase.functions.invoke('manage-usuario', { body: { action: 'delete', userId } })
// El SDK adjunta automáticamente el JWT del admin en el header Authorization.
//
// Usa la service_role key (nunca presente en el bundle del navegador)
// para forzar un cambio de contraseña (PIN) o eliminar la cuenta de
// Auth de un cajero/cliente SIN pasar por el flujo normal de recuperar
// contraseña por correo — estas cuentas usan un "dummy email"
// (celular@tonazo.app / usuario@tonazo.staff, ver create-cliente), así
// que ese flujo ni siquiera es una opción.
//
// Eliminar SOLO borra la cuenta de Auth: 'profiles' cascadea por FK
// (profiles.id references auth.users(id) on delete cascade, ver
// migración 0001), y clientes_fiado.auth_user_id queda en NULL (on
// delete set null) — el historial de fiados/ventas de un cliente NUNCA
// se borra acá, solo pierde su acceso de login.

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

  // 1) Verificar que quien llama es admin, usando SU JWT (nunca confiar
  // en un flag que venga en el body de la petición).
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  if (!jwt) return json(401, { error: "No autenticado." });

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return json(401, { error: "No autenticado." });
  }

  const { data: callerProfile, error: callerProfileErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userData.user.id)
    .single();

  const callerRole = callerProfileErr ? null : callerProfile?.role;
  if (callerRole !== "admin") {
    return json(403, { error: "Solo el admin puede gestionar usuarios." });
  }

  // 2) Validar input
  let body: { action?: string; userId?: string; pin?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Cuerpo de la petición inválido." });
  }

  const { action, userId } = body;
  if (!userId) return json(400, { error: "Falta el usuario a modificar." });

  // Blindaje: nunca gestionar la propia cuenta desde acá — evita que el
  // admin se cambie el PIN o se elimine a sí mismo por error y quede
  // afuera del sistema sin forma de volver a entrar.
  if (userId === userData.user.id) {
    return json(400, { error: "No puedes gestionar tu propia cuenta desde acá." });
  }

  if (action === "reset-pin") {
    const pin = body.pin || "";
    if (!/^\d{4,10}$/.test(pin)) {
      return json(400, { error: "El PIN/clave debe tener entre 4 y 10 dígitos." });
    }
    const { error } = await admin.auth.admin.updateUserById(userId, { password: pin });
    if (error) return json(500, { error: error.message || "No se pudo cambiar el PIN." });
    // Si esta cuenta todavía estaba en su password placeholder (nunca
    // pasó por "crear tu PIN en el primer login"), el admin acaba de
    // ponerle un PIN real de una — sin esto, el próximo login seguiría
    // mostrando la pantalla de "crea tu PIN" y el cliente terminaría
    // pisando el que el admin recién puso.
    await admin.from("profiles").update({ pin_configurado: true }).eq("id", userId);
    return json(200, { ok: true });
  }

  if (action === "delete") {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return json(500, { error: error.message || "No se pudo eliminar el usuario." });
    return json(200, { ok: true });
  }

  return json(400, { error: "Acción no reconocida." });
});
