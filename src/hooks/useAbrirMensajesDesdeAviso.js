import { useEffect, useRef } from "react";

// Al tocar una notificación emergente: si la app estaba cerrada se abre
// con "?mensajes=<canal>" en la URL; si estaba abierta, el service worker
// le avisa con un mensaje. En los dos casos se llama `onAbrir(canal)`
// para abrir Mensajes en ese chat (y se limpia la URL).
// Claves válidas: los fijados ("taxipe", "tonazo") y, desde los avisos de
// los chats de viaje (migración 20261206100000), "conductor:<id>" (lo abre
// el pasajero) y "pasajero:<id>" (lo abre el conductor).
const valido = (c) => (["taxipe", "tonazo"].includes(c) || /^(conductor|pasajero):[\w-]+$/.test(c || "") ? c : null);

export function useAbrirMensajesDesdeAviso(onAbrir, activo = true) {
  const ref = useRef(onAbrir);
  ref.current = onAbrir;

  useEffect(() => {
    if (!activo) return undefined;
    const params = new URLSearchParams(window.location.search);
    const canal = params.get("mensajes");
    if (canal) {
      params.delete("mensajes");
      const resto = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${resto ? `?${resto}` : ""}${window.location.hash}`);
      ref.current(valido(canal));
    }
    // Tocar la imagen o el video de un anuncio (AnuncioPopupModal).
    const alAnuncio = (e) => ref.current(valido(e.detail?.canal));
    window.addEventListener("tz-abrir-mensajes", alAnuncio);
    if (!("serviceWorker" in navigator)) return () => window.removeEventListener("tz-abrir-mensajes", alAnuncio);
    const alMensaje = (e) => {
      if (e.data?.tipo === "abrir-mensajes") ref.current(valido(e.data.canal));
    };
    navigator.serviceWorker.addEventListener("message", alMensaje);
    return () => {
      window.removeEventListener("tz-abrir-mensajes", alAnuncio);
      navigator.serviceWorker.removeEventListener("message", alMensaje);
    };
  }, [activo]);
}
