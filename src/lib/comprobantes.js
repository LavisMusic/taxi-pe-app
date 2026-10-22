import { supabase } from "../supabaseClient";
import { BUCKET_PRIVADO, esImagenPrivada, valorPrivado } from "./imagenesPrivadas";

// Sube la foto de un comprobante (gestor ⚡ del Admin) al bucket
// ventas-comprobantes, COMPRIMIDA como en Caja Tonazo: 1280 px de lado
// mayor, JPEG calidad 0.8 — se sigue leyendo el número de operación y
// el monto, pero pesa una fracción. Si la compresión falla, sube el
// original. Devuelve { url } o { error }.
async function comprimir(archivo) {
  const bitmap = await createImageBitmap(archivo);
  const escala = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * escala);
  canvas.height = Math.round(bitmap.height * escala);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  if (!blob) throw new Error("No se pudo comprimir la imagen.");
  return blob;
}

export async function subirComprobante(archivo, carpeta = "admin") {
  let blob = archivo;
  try {
    blob = await comprimir(archivo);
  } catch (err) {
    console.error("[comprobantes] no se pudo comprimir, se sube el original:", err);
  }
  const ruta = `${carpeta}/${Date.now()}.jpg`;
  const { data, error } = await supabase.storage
    .from("ventas-comprobantes")
    .upload(ruta, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  if (error) return { error };
  return { url: supabase.storage.from("ventas-comprobantes").getPublicUrl(data.path).data.publicUrl };
}

// Comprobante que sube el propio conductor (Recargar): al bucket PRIVADO
// 'verificaciones' (cualquiera con sesión sube; solo el Admin y quien lo
// subió lo ven). Devuelve { valor: "privado:<archivo>" } o { error }.
export async function subirComprobantePrivado(archivo, carpeta) {
  let blob = archivo;
  try {
    blob = await comprimir(archivo);
  } catch (err) {
    console.error("[comprobantes] no se pudo comprimir, se sube el original:", err);
  }
  const ruta = `${carpeta}/${Date.now()}.jpg`;
  const { data, error } = await supabase.storage
    .from(BUCKET_PRIVADO)
    .upload(ruta, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  if (error) return { error };
  return { valor: valorPrivado(data.path) };
}

// Foto sosteniendo el DNI de "Recuperar cuenta" (SoporteModal.jsx): quien
// la manda no tiene sesión, así que solo puede SUBIR a la carpeta
// recuperaciones/ del bucket privado (migración 20261021100000); solo el
// Admin la ve. Devuelve { valor: "privado:<archivo>" } o { error }.
export async function subirFotoRecuperacion(archivo) {
  let blob = archivo;
  try {
    blob = await comprimir(archivo);
  } catch (err) {
    console.error("[comprobantes] no se pudo comprimir, se sube el original:", err);
  }
  const ruta = `recuperaciones/${crypto.randomUUID()}.jpg`;
  const { data, error } = await supabase.storage
    .from(BUCKET_PRIVADO)
    .upload(ruta, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  if (error) return { error };
  return { valor: valorPrivado(data.path) };
}

// Al aprobar la petición, el Admin copia ese comprobante privado al bucket
// de comprobantes de ventas (donde viven los de todas las ventas).
export async function copiarComprobantePrivado(valor, carpeta = "admin") {
  if (!esImagenPrivada(valor)) return { url: valor || null };
  const { data, error } = await supabase.storage.from(BUCKET_PRIVADO).download(valor.slice("privado:".length));
  if (error || !data) return { error: error || new Error("No se pudo leer el comprobante.") };
  return subirComprobante(data, carpeta);
}
