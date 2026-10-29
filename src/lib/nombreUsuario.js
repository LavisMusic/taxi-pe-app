import { supabase } from "../supabaseClient";

// Nombre de usuario (lo que se muestra de cada persona en chats y Mensajes):
// 3 a 20 de a-z, 0-9, punto o guion bajo, único sin distinguir mayúsculas
// (taxi_nombre_usuario_libre, migración 20261027110000).
export const FORMATO_USUARIO = /^[a-z0-9._]{3,20}$/;

export function normalizarUsuario(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._]/g, "")
    .slice(0, 20);
}

// Las cuentas que llegan de Caja usan el teléfono como nombre de usuario:
// eso no es un nombre elegido, se le propone uno.
export const esUsuarioProvisional = (nombreUsuario, telefono) =>
  !nombreUsuario || /^\d{6,}$/.test(nombreUsuario) || nombreUsuario === telefono;

export async function usuarioLibre(nombre, excluirId = null) {
  const { data, error } = await supabase.rpc("taxi_nombre_usuario_libre", { p_nombre: nombre, p_excluir: excluirId });
  if (error) return null; // no se pudo saber
  return !!data;
}

// Propone uno libre a partir del nombre de la persona: "kevin.rivera", y si
// está tomado, con números al final. null si no se pudo consultar.
export async function sugerirUsuarioLibre(nombreBase, excluirId = null) {
  const base = normalizarUsuario(nombreBase).replace(/^[._]+|[._]+$/g, "").slice(0, 14) || "usuario";
  const candidatos = [base.length >= 3 ? base : `${base}.tz`];
  for (let i = 0; i < 6; i++) candidatos.push(`${base}${Math.floor(10 + Math.random() * 990)}`);
  for (const c of candidatos) {
    const libre = await usuarioLibre(c, excluirId);
    if (libre === null) return null;
    if (libre) return c;
  }
  return null;
}

// Guarda el nombre de usuario de un campo (CampoUsuario) en la cuenta, si
// cambió — formularios de verificación (taxi_crear_pin no lo toca).
// Devuelve un mensaje de error o null.
export async function guardarNombreUsuario(usuarioId, campo) {
  if (!campo.cambio) return null;
  const { error } = await supabase.from("usuarios").update({ nombre_usuario: campo.valor }).eq("id", usuarioId);
  if (!error) return null;
  return error.code === "23505" ? "Ese nombre de usuario ya lo usa otra persona." : "No se pudo guardar tu nombre de usuario.";
}
