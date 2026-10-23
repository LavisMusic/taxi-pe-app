import { supabase } from "../supabaseClient";

// Notificaciones emergentes (Web Push) de este dispositivo: registro del
// service worker (public/sw.js), permiso del navegador y suscripción
// (taxi_push_suscribir, migración 20261022140000). Además, la instalación
// de la app: en iPhone los avisos solo funcionan con la app instalada en
// la pantalla de inicio.
const RPC_SUSCRIBIR = "taxi_push_suscribir";

export function registrarServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("[push] service worker:", err?.message || err));
}

export const esIOS = () =>
  typeof navigator !== "undefined" &&
  (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export const esAppInstalada = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);

const soportaPush = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// 'activo' | 'pedir' | 'bloqueado' | 'instalar' (iPhone sin instalar) | 'no_soportado'
export function estadoPush() {
  if (esIOS() && !esAppInstalada()) return "instalar";
  if (!soportaPush()) return "no_soportado";
  if (Notification.permission === "granted") return "activo";
  if (Notification.permission === "denied") return "bloqueado";
  return "pedir";
}

function claveABytes(base64url) {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((base64url.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// Suscribe este dispositivo a la cuenta abierta (o la actualiza). Solo si
// el navegador ya dio permiso; devuelve true si quedó guardada.
export async function asegurarSuscripcion() {
  if (!soportaPush() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { data: clave } = await supabase.rpc("push_clave_publica");
      if (!clave) return false;
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveABytes(clave) });
    }
    const { endpoint, keys } = sub.toJSON();
    const { data } = await supabase.rpc(RPC_SUSCRIBIR, { p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth });
    return data === true;
  } catch (err) {
    console.warn("[push] no se pudo suscribir:", err?.message || err);
    return false;
  }
}

// Pide el permiso (tiene que ser dentro de un toque) y suscribe.
export async function activarPush() {
  if (!soportaPush()) return estadoPush();
  const permiso = await Notification.requestPermission();
  if (permiso === "granted") await asegurarSuscripcion();
  return estadoPush();
}

// Al cerrar sesión: este dispositivo deja de recibir avisos de esa cuenta
// (el servicio de push responde 410 y push-enviar borra la fila).
export function cancelarPushDispositivo() {
  if (!soportaPush()) return;
  navigator.serviceWorker.ready
    .then((reg) => reg.pushManager.getSubscription())
    .then((sub) => sub?.unsubscribe())
    .catch(() => {});
}

// ---- Instalar la app (Android/Chrome: aviso nativo; iPhone: instrucciones)
let avisoInstalacion = null;
const oyentes = new Set();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    avisoInstalacion = e;
    oyentes.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    avisoInstalacion = null;
    oyentes.forEach((fn) => fn());
  });
}
export const puedeInstalarNativo = () => !!avisoInstalacion;
export function alCambiarInstalacion(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}
export async function instalarNativo() {
  if (!avisoInstalacion) return false;
  avisoInstalacion.prompt();
  const { outcome } = await avisoInstalacion.userChoice;
  avisoInstalacion = null;
  oyentes.forEach((fn) => fn());
  return outcome === "accepted";
}
