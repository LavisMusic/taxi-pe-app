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
  // `terminado` ya NO controla si la "X" existe (ver el bug reportado:
  // el usuario debe poder cerrar el anuncio cuando quiera) — solo
  // decide si ya se puede dejar de proteger el video contra pausa/
  // adelantado (ver onPause/onSeeking más abajo). `progreso` alimenta
  // la barra fina de abajo, como contador de tiempo visual sin números.
  const [terminado, setTerminado] = useState(false);
  const [progreso, setProgreso] = useState(0);

  const soloMultimedia = !!anuncio && !anuncio.titulo && !anuncio.descripcion;
  const embedUrl = anuncio ? toYoutubeEmbedUrl(anuncio.video_url) : null;
  // video_url que NO es un link de YouTube reconocible = archivo de
  // video subido directo (Subir Video en el Gestor) — se renderiza con
  // <video>, no con el iframe de YouTube.
  const esVideoArchivo = !!anuncio?.video_url && !embedUrl;

  // Reinicia el candado cada vez que cambia el anuncio mostrado — sin
  // esto, un segundo anuncio en la misma sesión heredaría `terminado`
  // del anterior y la "X" aparecería de entrada.
  useEffect(() => {
    setTerminado(false);
    setProgreso(0);
  }, [anuncio]);

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
    <div className="tz-modal-backdrop">
      <div
        className={`tz-anuncio-modal ${soloMultimedia ? "tz-anuncio-modal-media-only" : ""} ${modalVertical ? "tz-anuncio-modal-vertical" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Bug reportado: el usuario debe poder cerrar el anuncio en
           cualquier momento — antes la "X" no existía en el DOM
           mientras un video de archivo corría sin terminar ("in-
           saltable"). Ahora se monta siempre; lo que sí se conserva es
           la protección de pausa/adelantado del propio <video> mientras
           no terminó (ver onPause/onSeeking más abajo). */}
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
                <video
                  src={anuncio.video_url}
                  playsInline
                  autoPlay
                  // Bug reportado ("se queda estancado, sin
                  // reproducirse"): todos los navegadores (Chrome,
                  // Safari, Firefox) BLOQUEAN el autoplay de un <video>
                  // con sonido — el video quedaba congelado en el
                  // primer frame porque el navegador nunca dejaba
                  // arrancar el play() de `autoPlay`, sin ningún error
                  // visible. `muted` es lo que de verdad habilita el
                  // autoplay real; sin esto no hay forma de que
                  // reproduzca solo, sin importar qué más se configure.
                  muted
                  disablePictureInPicture
                  controlsList="nodownload noplaybackrate nofullscreen"
                  onContextMenu={(e) => e.preventDefault()}
                  onTimeUpdate={(e) => {
                    const v = e.currentTarget;
                    if (v.duration) setProgreso((v.currentTime / v.duration) * 100);
                  }}
                  onEnded={() => {
                    setProgreso(100);
                    setTerminado(true);
                  }}
                  // Bloqueo real de "pausar/adelantar": sin `controls`
                  // nativos no hay botones de por medio, pero un gesto
                  // del sistema (barra de medios del SO, atajo de
                  // teclado si el elemento tiene foco) todavía puede
                  // pausarlo — si eso pasa y el video NO terminó
                  // todavía, se reanuda solo al toque.
                  onPause={(e) => {
                    if (!e.currentTarget.ended) e.currentTarget.play().catch(() => {});
                  }}
                  onSeeking={(e) => {
                    // Cinturón extra contra "adelantar": si algo mueve
                    // currentTime hacia adelante del punto ya
                    // reproducido, lo devuelve — normalmente esto ni se
                    // dispara (no hay controles para arrastrar), pero
                    // cubre atajos de teclado tipo flecha derecha.
                    const v = e.currentTarget;
                    if (v.currentTime > progreso && v.duration) {
                      const maxSeguro = (progreso / 100) * v.duration;
                      if (v.currentTime > maxSeguro + 0.5) v.currentTime = maxSeguro;
                    }
                  }}
                />
              ) : (
                <img src={anuncio.imagen_url} alt={anuncio.titulo || "Anuncio"} />
              )}
              {/* Barra de progreso — el "contador de tiempo" visual
                 pedido, sin números, pegada al borde inferior del
                 propio bloque de media. */}
              {esVideoArchivo && (
                <div className="tz-anuncio-progreso-track">
                  <div className="tz-anuncio-progreso-fill" style={{ width: `${progreso}%` }} />
                </div>
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
