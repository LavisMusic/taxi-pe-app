import { useEffect, useRef } from "react";

// Barra fina de avance de un video (anuncios en primer plano y videos del
// chat). Se mueve en cada cuadro de pantalla (requestAnimationFrame) en vez
// de con 'timeupdate', que llega ~4 veces por segundo y la hacía avanzar a
// saltos. Usa transform (no width) para que el navegador la anime suave.
export default function BarraAvance({ videoRef }) {
  const rellenoRef = useRef(null);

  useEffect(() => {
    let id;
    const paso = () => {
      const v = videoRef.current;
      const relleno = rellenoRef.current;
      if (v && relleno && Number.isFinite(v.duration) && v.duration > 0) {
        relleno.style.transform = `scaleX(${Math.min(1, v.currentTime / v.duration)})`;
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
