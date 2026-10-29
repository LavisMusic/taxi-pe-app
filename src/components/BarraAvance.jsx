import { useEffect, useRef } from "react";

// Barra fina de avance de un video (anuncios en primer plano y videos del
// chat), a la frecuencia de la pantalla (60 fps o más). Se dibuja en cada
// cuadro (requestAnimationFrame) y, como el video solo actualiza su
// currentTime con cada cuadro de video (24–30 por segundo), entre uno y
// otro se estima el tiempo con el reloj del navegador: así no avanza a
// escalones. Usa transform (no width) para que lo mueva la GPU.
export default function BarraAvance({ videoRef }) {
  const rellenoRef = useRef(null);

  useEffect(() => {
    let id;
    let base = -1; // último currentTime real leído
    let baseEn = 0; // cuándo se leyó (performance.now)
    const paso = (ahora) => {
      const v = videoRef.current;
      const relleno = rellenoRef.current;
      if (v && relleno && Number.isFinite(v.duration) && v.duration > 0) {
        if (v.currentTime !== base) {
          base = v.currentTime;
          baseEn = ahora;
        }
        const corriendo = !v.paused && !v.seeking && v.readyState >= 3;
        // Como mucho un cuarto de segundo por delante del último real.
        const extra = corriendo ? Math.min(0.25, ((ahora - baseEn) / 1000) * v.playbackRate) : 0;
        relleno.style.transform = `scaleX(${Math.min(1, (base + extra) / v.duration)})`;
      }
      id = requestAnimationFrame(paso);
    };
    id = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(id);
  }, [videoRef]);

  return (
    <div className="tz-anuncio-progreso-track">
      <div ref={rellenoRef} className="tz-anuncio-progreso-fill tz-barra-fluida" />
    </div>
  );
}
