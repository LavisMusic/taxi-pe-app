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
        .select("id, canal, titulo, mensaje, imagen_url, video_url, roles, programado_para, vence_at, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) return jsonResponse(500, { error: error.message });
      return jsonResponse(200, { ok: true, filas: data ?? [] });
    }
    case "mensajes.crear": {
      const id = uuid(d.id);
      const r = roles(d.roles);
      const mensaje = texto(d.mensaje, 2000);
      // Con imagen o video (subido o de YouTube) el texto es opcional
      // (migraciones 20261029130000 y 20261029140000).
      const videoUrl = /^https:\/\/\S+$/i.test(String(d.video_url || "")) ? String(d.video_url).slice(0, 1000) : null;
      const imagenUrl = /^https:\/\/\S+$/i.test(String(d.imagen_url || "")) ? String(d.imagen_url).slice(0, 1000) : null;
      if (!id || !CANALES.includes(String(d.canal)) || (!mensaje && !videoUrl && !imagenUrl) || r.length === 0) {
        return jsonResponse(400, { error: "datos inválidos" });
      }
      const { error } = await db.from("mensajes_plataforma").insert({
        id,
        canal: String(d.canal),
        titulo: texto(d.titulo, 200),
        mensaje: mensaje ?? "",
        video_url: videoUrl,
        imagen_url: imagenUrl,
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
        .select("id, titulo, descripcion, imagen_url, video_url, boton_url, boton_texto, fecha_inicio, fecha_fin, frecuencia_mostrar, activo, orden, roles, created_at")
        // Como el carrusel: del más antiguo al más nuevo, o como se reordenó.
        .order("orden", { ascending: true })
        .order("created_at", { ascending: true });
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
    // Orden del carrusel (arrastrando en el gestor): posición = orden.
    case "anuncios.ordenar": {
      const ids = Array.isArray(d.ids) ? d.ids.map(uuid).filter(Boolean) : [];
      if (ids.length === 0) return jsonResponse(400, { error: "datos inválidos" });
      for (let i = 0; i < ids.length; i++) {
        const { error } = await db.from("anuncios").update({ orden: i + 1 }).eq("id", ids[i]);
        if (error) return jsonResponse(500, { error: error.message });
      }
      return jsonResponse(200, { ok: true });
    }
    // Limpieza diaria (Edge Function limpiar-anuncios de Caja): borra los
    // anuncios que ya caducaron y devuelve las imágenes/videos que se siguen
    // usando acá (anuncios y notificaciones), para que Caja borre del
    // almacenamiento solo lo que nadie usa.
    case "anuncios.limpiar": {
      const ahora = new Date().toISOString();
      const { error: errBorrar } = await db.from("anuncios").delete().lt("fecha_fin", ahora);
      if (errBorrar) return jsonResponse(500, { error: errBorrar.message });
      const [a, m] = await Promise.all([
        db.from("anuncios").select("imagen_url, video_url"),
        db.from("mensajes_plataforma").select("imagen_url, video_url"),
      ]);
      if (a.error || m.error) return jsonResponse(500, { error: (a.error || m.error)!.message });
      const urls = [...(a.data ?? []), ...(m.data ?? [])].flatMap((f) => [f.imagen_url, f.video_url]).filter(Boolean);
      return jsonResponse(200, { ok: true, urls });
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
