import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toYoutubeEmbedUrl } from "../lib/youtube";

// Pop-up de marketing — Vista Cliente. Layouts según tenga o no texto
// (ver useAnuncioActivo.js para cuándo le toca aparecer a este
// visitante en particular; el Gestor de Anuncios ya se encarga de que
// un anuncio vertical 9:16 nunca tenga título/descripción, ver
// GestorAnunciosModal.jsx):
//   A) Solo multimedia Y vertical (9:16, sin título NI descripción): el
//      modal ABANDONA el ancho genérico y toma forma de teléfono
//      (aspect-ratio 9:16, ver .tz-anuncio-modal-vertical en
//      Styles.jsx) — el video/imagen la llena entera (object-fit:
//      cover), sin franjas negras ni recortes raros. La orientación se
//      mide en el cliente (naturalWidth/Height o videoWidth/Height)
//      porque no se persiste en la base — ver el useEffect de abajo.
//   A') Solo multimedia pero horizontal (sin texto, ancho normal): igual
//      que antes, llena el ancho del modal sin forzar 16:9.
//   B) Con texto (siempre 16:9 — YouTube o una subida horizontal):
//      SIEMPRE en columna (media arriba a ancho completo, texto abajo).
// Ver los .tz-anuncio-* en Styles.jsx.
export default function AnuncioPopupModal({ anuncio, onClose }) {
  const [esVertical, setEsVertical] = useState(false);

  const soloMultimedia = !!anuncio && !anuncio.titulo && !anuncio.descripcion;
  const embedUrl = anuncio ? toYoutubeEmbedUrl(anuncio.video_url) : null;
  // video_url que NO es un link de YouTube reconocible = archivo de
  // video subido directo (Subir Video en el Gestor) — se renderiza con
  // <video>, no con el iframe de YouTube.
  const esVideoArchivo = !!anuncio?.video_url && !embedUrl;

  // YouTube siempre se trata como 16:9 (nunca toma la forma de
  // teléfono) — solo mide imagen/video propio, y solo cuando además va
  // a ir en modo "solo multimedia" (si hay texto, por construcción del
  // Gestor ya sabemos que es horizontal, no hace falta medir).
  useEffect(() => {
    setEsVertical(false);
    if (!anuncio || !soloMultimedia || embedUrl) return;
    let cancelado = false;
    if (esVideoArchivo) {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        if (!cancelado) setEsVertical(video.videoHeight > video.videoWidth);
      };
      video.src = anuncio.video_url;
    } else if (anuncio.imagen_url) {
      const img = new Image();
      img.onload = () => {
        if (!cancelado) setEsVertical(img.naturalHeight > img.naturalWidth);
      };
      img.src = anuncio.imagen_url;
    }
    return () => {
      cancelado = true;
    };
  }, [anuncio, soloMultimedia, embedUrl, esVideoArchivo]);

  if (!anuncio) return null;

  const hayMedia = !!embedUrl || esVideoArchivo || !!anuncio.imagen_url;
  const modalVertical = soloMultimedia && esVertical;

  return (
    <div className="tz-modal-backdrop" onClick={onClose}>
      <div
        className={`tz-anuncio-modal ${soloMultimedia ? "tz-anuncio-modal-media-only" : ""} ${modalVertical ? "tz-anuncio-modal-vertical" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="tz-anuncio-close" onClick={onClose} aria-label="Cerrar anuncio">
          <X size={18} />
        </button>

        <div className={`tz-anuncio-layout ${soloMultimedia ? "tz-anuncio-layout-fill" : ""}`}>
          {hayMedia && (
            <div className="tz-anuncio-media">
              {embedUrl ? (
                <div className="tz-anuncio-video-wrap">
                  <iframe
                    src={embedUrl}
                    title={anuncio.titulo || "Anuncio"}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : esVideoArchivo ? (
                <video src={anuncio.video_url} controls playsInline />
              ) : (
                <img src={anuncio.imagen_url} alt={anuncio.titulo || "Anuncio"} />
              )}
            </div>
          )}

          {!soloMultimedia && (
            <div className="tz-anuncio-text">
              {anuncio.titulo && <h3>{anuncio.titulo}</h3>}
              {anuncio.descripcion && <p>{anuncio.descripcion}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
