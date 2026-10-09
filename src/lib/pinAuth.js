import { supabase } from "../supabaseClient";
import { leerTokenAdmin } from "./taxiAuth";

// El PIN nunca sale de la base: el hash vive en `usuarios_credenciales`
// (sin acceso para la app) y `usuarios.pin` es solo una marca
// ('protegido' = tiene PIN, null = todavía no). Crear, comprobar y
// cambiar el PIN pasa por estas funciones de la base (security definer),
// que además frenan la fuerza bruta: 5 intentos fallidos por teléfono
// cada 15 min. Ver la migración 20261009100000.

export const MENSAJE_BLOQUEADO = "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo.";

// Inicio de sesión por teléfono + PIN. Devuelve { estado, usuario }:
// 'ok' | 'sin_pin' (la cuenta todavía no tiene PIN: hay que crearlo) |
// 'incorrecto' | 'bloqueado'.
export async function loginConPin(telefono, pin, roles) {
  const { data, error } = await supabase.rpc("taxi_login", { p_telefono: telefono, p_pin: pin || "", p_roles: roles });
  if (error) throw error;
  return data;
}

// Primer PIN de una cuenta que nació sin uno. `datos` (opcional) guarda a
// la vez los datos de verificación (nombre, apellido, edad, sexo,
// estado_verificacion, expira_en). Devuelve { estado, usuario }: 'ok' |
// 'ya_tiene_pin' | 'no_existe'.
export async function crearPin(usuarioId, pin, datos = null) {
  const { data, error } = await supabase.rpc("taxi_crear_pin", { p_usuario_id: usuarioId, p_pin: pin, p_datos: datos });
  if (error) throw error;
  return data;
}

// Paso 2 de /recuperar-pin (la petición ya la verificó el Admin).
// Devuelve { estado, usuario }: 'ok' | 'no_verificado' | 'no_existe'.
export async function fijarPinRecuperacion(peticionId, dni, pin) {
  const { data, error } = await supabase.rpc("taxi_fijar_pin_recuperacion", {
    p_peticion_id: String(peticionId),
    p_dni: dni,
    p_pin: pin,
  });
  if (error) throw error;
  return data;
}

// El Admin sobrescribe el PIN de alguien (pide su sesión de Admin).
export async function adminFijarPin(usuarioId, pin) {
  const { data, error } = await supabase.rpc("taxi_admin_fijar_pin", {
    p_token: leerTokenAdmin(),
    p_usuario_id: usuarioId,
    p_pin: pin,
  });
  if (error) throw error;
  if (data?.estado !== "ok") throw new Error("Tu sesión de Admin venció. Vuelve a entrar.");
  return data;
}

// `generarPinAleatorio` existió acá para el viejo "Generar y Enviar
// PIN" del Centro de Peticiones — el Admin generaba el PIN nuevo y se
// lo mandaba él mismo. Se eliminó (bug reportado: el dueño de la
// cuenta debe elegir su propio PIN, no el Admin) junto con esa función
// — ver useCrearPeticionPin.js/fijarNuevoPin.js para el reemplazo.
