// Puente del superadmin (Caja -> Taxi-PE). El panel del superadmin vive en
// Caja Tonazo; para gestionar lo que se guarda en Taxi-PE (notificaciones
// de los chats fijados y anuncios) su Edge Function `superadmin-taxi`
// comprueba que quien llama es el superadmin y firma el pedido con
// WEBHOOK_SECRET_CAJA_TO_TAXI. Acá se verifica esa firma y se ejecuta
// SOLO una de las acciones de la lista, con service_role.
//
// Sobre: event_type 'caja.superadmin', data { accion, datos }.
// Responde { ok: true, ... } o { error }.
//
// Deploy: supabase functions deploy webhook-caja-superadmin --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";
import { jsonResponse, verifyWebhook } from "../_shared/webhook.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET_CAJA_TO_TAXI") ?? "";

const ROLES_TAXI = ["pasajero", "conductor", "recolector"];
const CANALES = ["taxipe", "tonazo"];
const FRECUENCIAS = ["una_vez_total", "una_vez_dia", "siempre"];

type Datos = Record<string, unknown>;

const texto = (v: unknown, max = 2000) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const fecha = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const roles = (v: unknown) =>
  Array.isArray(v) ? [...new Set(v.filter((r) => typeof r === "string" && ROLES_TAXI.includes(r)))] : [];
const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

// Solo columnas conocidas de un anuncio, validadas.
function camposAnuncio(d: Datos) {
  const r = roles(d.roles);
  return {
    titulo: texto(d.titulo, 200),
    descripcion: texto(d.descripcion, 10000),
    imagen_url: texto(d.imagen_url, 1000),
    video_url: texto(d.video_url, 1000),
    fecha_inicio: fecha(d.fecha_inicio),
    fecha_fin: fecha(d.fecha_fin),
    frecuencia_mostrar: FRECUENCIAS.includes(String(d.frecuencia_mostrar)) ? String(d.frecuencia_mostrar) : "una_vez_total",
    activo: d.activo !== false,
    // Botón opcional con enlace al pie del anuncio (migración 20261029110000).
    boton_url: /^https?:\/\/\S+$/i.test(String(d.boton_url || "")) ? String(d.boton_url).slice(0, 1000) : null,
    boton_texto: /^https?:\/\//i.test(String(d.boton_url || "")) ? (texto(d.boton_texto, 16) || "VAMOS") : null,
    roles: r,
    // Compatibilidad con la columna vieja (ya no decide nada).
    publico: r.length === 1 && r[0] === "pasajero" ? "pasajeros" : r.length === 1 && r[0] === "conductor" ? "conductores" : "todos",
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });

  const v = await verifyWebhook(req, WEBHOOK_SECRET);
  if (!v.ok) return jsonResponse(v.status, { error: v.error });
  const env = v.envelope!;
  if (env.event_type !== "caja.superadmin") {
    return jsonResponse(400, { error: `event_type inesperado: ${env.event_type}` });
  }

  const accion = String(env.data?.accion ?? "");
  const d = (env.data?.datos ?? {}) as Datos;
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  switch (accion) {
    case "mensajes.listar": {
      const { data, error } = await db
        .from("mensajes_plataforma")
        .select("id, canal, titulo, mensaje, roles, programado_para, vence_at, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true, filas: data ?? [] });
    }
    case "mensajes.crear": {
      const id = uuid(d.id);
      const r = roles(d.roles);
      const mensaje = texto(d.mensaje, 2000);
      if (!id || !CANALES.includes(String(d.canal)) || !mensaje || r.length === 0) {
        return jsonResponse(400, { error: "datos inválidos" });
      }
      const { error } = await db.from("mensajes_plataforma").insert({
        id,
        canal: String(d.canal),
        titulo: texto(d.titulo, 200),
        mensaje,
        roles: r,
        programado_para: fecha(d.programado_para) ?? new Date().toISOString(),
        vence_at: fecha(d.vence_at),
      });
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true });
    }
    case "mensajes.eliminar": {
      const id = uuid(d.id);
      if (!id) return jsonResponse(400, { error: "datos inválidos" });
      const { error } = await db.from("mensajes_plataforma").delete().eq("id", id);
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true });
    }
    case "anuncios.listar": {
      const { data, error } = await db
        .from("anuncios")
        .select("id, titulo, descripcion, imagen_url, video_url, fecha_inicio, fecha_fin, frecuencia_mostrar, activo, orden, roles, created_at")
        .order("created_at", { ascending: false });
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true, filas: data ?? [] });
    }
    case "anuncios.crear": {
      const id = uuid(d.id);
      const campos = camposAnuncio(d);
      if (!id || campos.roles.length === 0 || (!campos.imagen_url && !campos.video_url)) {
        return jsonResponse(400, { error: "datos inválidos" });
      }
      const { error } = await db.from("anuncios").insert({ id, ...campos });
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true });
    }
    case "anuncios.actualizar": {
      const id = uuid(d.id);
      const campos = camposAnuncio(d);
      if (!id || campos.roles.length === 0 || (!campos.imagen_url && !campos.video_url)) {
        return jsonResponse(400, { error: "datos inválidos" });
      }
      const { error } = await db.from("anuncios").update(campos).eq("id", id);
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true });
    }
    case "anuncios.eliminar": {
      const id = uuid(d.id);
      if (!id) return jsonResponse(400, { error: "datos inválidos" });
      const { error } = await db.from("anuncios").delete().eq("id", id);
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true });
    }
    default:
      return jsonResponse(400, { error: `acción desconocida: ${accion}` });
  }
});
