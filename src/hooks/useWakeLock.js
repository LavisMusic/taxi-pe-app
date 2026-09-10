import { useEffect, useRef } from "react";

// Mantiene la pantalla ENCENDIDA mientras `activo` sea true (viaje o
// entrega en curso). Sin esto, al bloquearse la pantalla el SO suspende
// `navigator.geolocation.watchPosition` y el conductor/pasajero "deja de
// moverse" en el mapa del otro lado.
//
// Límites (son del navegador, no del código):
//   - El lock se suelta al cambiar de app/pestaña → se re-pide al volver
//     a primer plano (visibilitychange).
//   - Solo funciona con la app en primer plano. GPS de fondo real (app
//     minimizada / pantalla apagada) necesita Capacitor + plugin nativo.
export function useWakeLock(activo) {
  const lockRef = useRef(null);

  useEffect(() => {
    if (!activo || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let cancelado = false;

    const pedir = async () => {
      if (cancelado || document.visibilityState !== "visible" || lockRef.current) return;
      try {
        lockRef.current = await navigator.wakeLock.request("screen");
        lockRef.current.addEventListener("release", () => {
          lockRef.current = null;
        });
      } catch {
        /* denegado / no soportado — se sigue sin lock */
      }
    };

    const alVolver = () => {
      if (document.visibilityState === "visible") pedir();
    };

    pedir();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      cancelado = true;
      document.removeEventListener("visibilitychange", alVolver);
      lockRef.current?.release?.().catch(() => {});
      lockRef.current = null;
    };
  }, [activo]);
}
