// Manda como notificación emergente (Web Push) los mensajes de los chats
// fijados "Taxi PE" / "Tonazo" que ya llegaron a su hora y todavía no se
// enviaron (mensajes_plataforma.push_enviado_at), a cada dispositivo
// suscrito de las cuentas con ese rol y los avisos activados.
// La llaman la base al crear un mensaje "ahora" y pg_cron cada minuto
// (migración 20261022140000). Sin cuerpo ni sesión: solo despacha lo
// pendiente, así que llamarla de más no hace daño.
//
// Deploy: supabase functions deploy push-enviar --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { enviarPush, vapidDesdeJwk } from "../_shared/webpush.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUJETO = Deno.env.get("VAPID_SUBJECT") || "https://taxi-pe-app.vercel.app";

const NOMBRE_CANAL: Record<string, string> = { taxipe: "Taxi PE", tonazo: "Tonazo" };
// Al tocar el aviso se abre la pantalla de cada rol con ese chat.
const RUTA_ROL: Record<string, string> = { pasajero: "/", conductor: "/conductor", recolector: "/recolector" };

Deno.serve(async () => {
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: jwkTexto } = await db.rpc("fn_webhook_secret", { p_nombre: "vapid_private_key" });
  if (typeof jwkTexto !== "string" || !jwkTexto) {
    return new Response(JSON.stringify({ error: "faltan las claves VAPID" }), { status: 500 });
  }
  const vapid = vapidDesdeJwk(jwkTexto, SUJETO);

  const ahora = new Date().toISOString();
  const { data: pendientes } = await db
    .from("mensajes_plataforma")
    .select("id, canal, titulo, mensaje, imagen_url, video_url, roles, vence_at")
    .is("push_enviado_at", null)
    .lte("programado_para", ahora)
    .order("programado_para", { ascending: true })
    .limit(20);

  let enviados = 0;
  for (const m of pendientes ?? []) {
    // Se marca primero: si otra llamada llega a la vez, solo una lo manda.
    const { data: tomado } = await db
      .from("mensajes_plataforma")
      .update({ push_enviado_at: ahora })
      .eq("id", m.id)
      .is("push_enviado_at", null)
      .select("id");
    if (!tomado?.length) continue;
    if (m.vence_at && new Date(m.vence_at) <= new Date()) continue;

    const { data: subs } = await db
      .from("push_suscripciones")
      .select("id, endpoint, p256dh, auth, usuarios!inner(rol, notificaciones_activas)")
      .in("usuarios.rol", m.roles ?? [])
      .eq("usuarios.notificaciones_activas", true);

    await Promise.all(
      (subs ?? []).map(async (s) => {
        const rol = (s.usuarios as unknown as { rol: string }).rol;
        try {
          const status = await enviarPush(
            s,
            {
              title: m.titulo || NOMBRE_CANAL[m.canal] || "Taxi PE",
              // Una notificación con solo video (sin texto) igual dice algo.
              body: String(m.mensaje || (m.video_url ? "🎬 Te enviamos un video" : m.imagen_url ? "📷 Te enviamos una imagen" : "")).slice(0, 200),
              canal: m.canal,
              url: `${RUTA_ROL[rol] ?? "/"}?mensajes=${m.canal}`,
              tag: `msg-${m.id}`,
            },
            vapid
          );
          if (status === 404 || status === 410) await db.from("push_suscripciones").delete().eq("id", s.id);
          else if (status < 300) enviados++;
        } catch (err) {
          console.error("[push-enviar] error enviando", err);
        }
      })
    );
  }

  return new Response(JSON.stringify({ ok: true, mensajes: pendientes?.length ?? 0, enviados }), {
    headers: { "Content-Type": "application/json" },
  });
});
