import { supabase } from "../supabaseClient";

// Fotos y notas de voz en los chats. Viajan DENTRO del texto del mensaje
// con una marca — así sirven igual en todos los chats (pedido, negocio,
// entrega con el repartidor de Taxi-PE) sin tocar sus tablas ni sus RPCs,
// y se borran con el mensaje a las 24 h (los archivos, la Edge Function
// limpiar-adjuntos):
//   ⟦foto⟧https://…            ⟦audio:12⟧https://…   (12 = segundos)
// Cada app sube a SU almacenamiento (bucket público 'chat-adjuntos', en
// carpetas por hora UTC para poder borrarlas enteras): el que escribe
// desde Caja, acá; el repartidor/pasajero, en Taxi-PE. Mismo formato en las
// dos apps (lib/adjuntosChat.js de Taxi-PE).
const MARCA = /^⟦(foto|audio)(?::(\d+))?⟧(https:\/\/\S+)$/;

export function codificarAdjunto({ tipo, url, duracion }) {
  return tipo === "audio" ? `⟦audio:${Math.round(duracion || 0)}⟧${url}` : `⟦foto⟧${url}`;
}

// { tipo: 'foto' | 'audio', url, duracion } o null si es texto normal.
export function leerAdjunto(texto) {
  const m = MARCA.exec(String(texto || "").trim());
  return m ? { tipo: m[1], url: m[3], duracion: Number(m[2]) || 0 } : null;
}

export const minSeg = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Texto corto para las vistas previas de las listas de chats.
export function previaMensaje(texto) {
  const a = leerAdjunto(texto);
  if (!a) return texto;
  return a.tipo === "foto" ? "📷 Foto" : `🎤 Nota de voz (${minSeg(a.duracion)})`;
}

const LADO_FOTO = 1280;
// Fotos pegadas con Ctrl + V (capturas de pantalla, PNG pesados): más
// chicas y con más compresión.
const LADO_PEGADA = 1080;
const CALIDAD_PEGADA = 0.72;
async function reducirFoto(blob, lado = LADO_FOTO, calidad = 0.85) {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const salida = await new Promise((res) => canvas.toBlob((b) => res(b || blob), "image/jpeg", calidad));
    // Un JPEG ya liviano no se agranda al volver a comprimirlo.
    return blob.type === "image/jpeg" && blob.size <= salida.size ? blob : salida;
  } catch {
    return blob;
  }
}

// Sube una foto (reducida a 1280 px; con `comprimir`, las pegadas, a
// 1080 px y más compresión) o una nota de voz y devuelve el texto del
// mensaje ya codificado.
export async function subirAdjunto({ tipo, blob, duracion = 0, comprimir = false }) {
  const archivo =
    tipo === "foto" ? await (comprimir ? reducirFoto(blob, LADO_PEGADA, CALIDAD_PEGADA) : reducirFoto(blob)) : blob;
  // Sin ";codecs=…": el bucket solo acepta el tipo base.
  const contentType = tipo === "foto" ? "image/jpeg" : (archivo.type || "audio/webm").split(";")[0];
  const ext = tipo === "foto" ? "jpg" : contentType.includes("mp4") ? "m4a" : contentType.includes("ogg") ? "ogg" : "webm";
  const hora = new Date().toISOString().slice(0, 13); // 2026-10-27T15
  const ruta = `${hora}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("chat-adjuntos").upload(ruta, archivo, { contentType });
  if (error) throw error;
  const url = supabase.storage.from("chat-adjuntos").getPublicUrl(ruta).data?.publicUrl;
  return codificarAdjunto({ tipo, url, duracion });
}

// Clase extra para la burbuja de un mensaje que es una foto o una nota de
// voz: la burbuja queda sin cuadro (la foto va sola; la nota lleva su
// propio color).
export const claseNota = (texto) => (leerAdjunto(texto) ? "is-nota" : "");
