import { useEffect, useRef } from "react";

// Avance de un audio o video a la frecuencia de la pantalla (60 fps o más):
// `pintar(fraccion)` se llama en cada cuadro (requestAnimationFrame). Como
// el medio solo actualiza su currentTime de a ratos (cada cuadro de video, o
// menos en un audio), entre lectura y lectura se estima el tiempo con el
// reloj del navegador, como mucho 0,25 s por delante del real y quieto si
// está en pausa o cargando. Así la barra no avanza a escalones.
// `activo`: si es false pinta una sola vez (posición actual) y no sigue.
// `duracion`: respaldo si el medio no sabe cuánto dura (grabaciones webm).
export function useAvanceFluido(mediaRef, pintar, { activo = true, duracion = 0 } = {}) {
  const pintarRef = useRef(pintar);
  pintarRef.current = pintar;

  useEffect(() => {
    let id;
    let base = -1; // último currentTime real leído
    let baseEn = 0; // cuándo se leyó (performance.now)
    const paso = (ahora) => {
      const m = mediaRef.current;
      const d = m && (Number.isFinite(m.duration) && m.duration > 0 ? m.duration : duracion);
      if (m && d) {
        if (m.currentTime !== base) {
          base = m.currentTime;
          baseEn = ahora;
        }
        const corriendo = !m.paused && !m.seeking && m.readyState >= 3;
        const extra = corriendo ? Math.min(0.25, ((ahora - baseEn) / 1000) * m.playbackRate) : 0;
        pintarRef.current(Math.min(1, Math.max(0, (base + extra) / d)));
      }
      if (activo) id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [mediaRef, activo, duracion]);
}
