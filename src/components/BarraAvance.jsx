import { useRef } from "react";
import { useAvanceFluido } from "../lib/avanceFluido";

// Barra fina de avance de un video (anuncios en primer plano y videos del
// chat), a la frecuencia de la pantalla (lib/avanceFluido). Usa transform
// (no width) para que la mueva la GPU.
export default function BarraAvance({ videoRef }) {
  const rellenoRef = useRef(null);
  useAvanceFluido(videoRef, (f) => {
    if (rellenoRef.current) rellenoRef.current.style.transform = `scaleX(${f})`;
  });

  return (
    <div className="tz-anuncio-progreso-track">
      <div ref={rellenoRef} className="tz-anuncio-progreso-fill tz-barra-fluida" />
    </div>
  );
}
