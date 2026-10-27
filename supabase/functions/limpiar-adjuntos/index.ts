// Edge Function: limpiar-adjuntos
//
// Regla de las 24 h de los chats: borra del bucket 'chat-adjuntos' las
// carpetas de hora (2026-10-27T15/…, ver src/lib/adjuntosChat.js) de hace
// más de 24 horas. La llama pg_cron cada hora (migración 20261027160000). Sin datos
// que proteger: solo borra lo vencido, así que no pide credenciales.
//
// Deploy: supabase functions deploy limpiar-adjuntos --no-verify-jwt --project-ref silfhbdmfdryjdzpwzvh

import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "chat-adjuntos";
const DIA_MS = 24 * 60 * 60 * 1000;

Deno.serve(async () => {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    (Deno.env.get("SB_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!
  );
  const storage = admin.storage.from(BUCKET);
  const corte = Date.now() - DIA_MS;

  const { data: carpetas, error } = await storage.list("", { limit: 1000 });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let borrados = 0;
  for (const c of carpetas ?? []) {
    const m = /^(\d{4}-\d{2}-\d{2}T\d{2})$/.exec(c.name);
    if (!m) continue;
    // Todo lo de esa carpeta es anterior al fin de su hora.
    const finDeLaHora = new Date(`${m[1]}:00:00Z`).getTime() + 60 * 60 * 1000;
    if (finDeLaHora > corte) continue;
    // Puede haber más de 1000 archivos: se borra por tandas.
    for (;;) {
      const { data: archivos } = await storage.list(c.name, { limit: 1000 });
      if (!archivos?.length) break;
      const rutas = archivos.map((a) => `${c.name}/${a.name}`);
      const { error: errBorrar } = await storage.remove(rutas);
      if (errBorrar) break;
      borrados += rutas.length;
      if (archivos.length < 1000) break;
    }
  }
  return new Response(JSON.stringify({ status: "ok", borrados }), { headers: { "Content-Type": "application/json" } });
});
