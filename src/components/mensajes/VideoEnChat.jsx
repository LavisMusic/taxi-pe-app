import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Volume2, VolumeX, X } from "lucide-react";
import { toYoutubeEmbedUrl } from "../../lib/youtube";

// Video de un mensaje dentro del chat (fijados "Taxi PE" / "Tonazo"): se
// reproduce solo apenas se ve en pantalla y se pausa al salir. Arranca sin
// sonido (los navegadores no dejan reproducir solo con sonido) y con un
// botón para activarlo. Se ve con su resolución original y con la misma
// barra fina de avance que los anuncios en primer plano. Al tocarlo (o el
// botón de ampliar) se abre en un visor aparte con todos los controles.
// YouTube igual, por su API de mensajes (enablejsapi=1).
export default function VideoEnChat({ url, titulo }) {
  const embed = toYoutubeEmbedUrl(url);
  const cajaRef = useRef(null);
  const videoRef = useRef(null);
  const iframeRef = useRef(null);
  const [silencio, setSilencio] = useState(true);
  const [progreso, setProgreso] = useState(0);
  const [visor, setVisor] = useState(null); // { desde } mientras está abierto

  const ordenYoutube = (func, args = []) =>
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");

  useEffect(() => {
    const el = cajaRef.current;
    if (!el || visor) return undefined;
    const obs = new IntersectionObserver(
      ([e]) => {
        const visible = e.isIntersecting && e.intersectionRatio >= 0.5;
        if (embed) ordenYoutube(visible ? "playVideo" : "pauseVideo");
        else if (videoRef.current) {
          if (visible) videoRef.current.play().catch(() => {});
          else videoRef.current.pause();
        }
      },
      { threshold: [0, 0.5, 1] }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [embed, visor]);

  const alternarSonido = () => {
    const nuevo = !silencio;
    setSilencio(nuevo);
    if (embed) ordenYoutube(nuevo ? "mute" : "unMute");
    else if (videoRef.current) videoRef.current.muted = nuevo;
  };

  const abrirVisor = () => {
    if (embed) ordenYoutube("pauseVideo");
    else videoRef.current?.pause();
    setVisor({ desde: videoRef.current?.currentTime ?? 0 });
  };

  // Al cerrar sigue en el chat desde donde quedó en el visor.
  const cerrarVisor = (hasta) => {
    if (!embed && videoRef.current && Number.isFinite(hasta)) videoRef.current.currentTime = hasta;
    setVisor(null);
  };

  return (
    <div ref={cajaRef} className={`tz-chatfijo-video-caja ${embed ? "is-youtube" : ""}`}>
      {embed ? (
        <div className="tz-chatfijo-video">
          <iframe
            ref={iframeRef}
            src={`${embed}?enablejsapi=1&autoplay=1&mute=1&playsinline=1&controls=1&rel=0`}
            title={titulo || "Video"}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            src={url}
            muted
            playsInline
            loop
            preload="metadata"
            className="tz-chatfijo-media"
            onClick={abrirVisor}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              if (v.duration) setProgreso((v.currentTime / v.duration) * 100);
            }}
          />
          <div className="tz-anuncio-progreso-track">
            <div className="tz-anuncio-progreso-fill" style={{ width: `${progreso}%` }} />
          </div>
        </>
      )}
      <div className="tz-chatfijo-video-botones">
        <button type="button" className="tz-chatfijo-sonido" onClick={abrirVisor} aria-label="Ver en grande">
          <Maximize2 size={15} />
        </button>
        <button
          type="button"
          className={`tz-chatfijo-sonido ${silencio ? "" : "is-activo"}`}
          onClick={alternarSonido}
          aria-label={silencio ? "Activar sonido" : "Silenciar"}
        >
          {silencio ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>
      {visor && <VisorVideo url={url} embed={embed} titulo={titulo} desde={visor.desde} onCerrar={cerrarVisor} />}
    </div>
  );
}

// Visor aparte: el video con todos sus controles (play, barra, volumen,
// pantalla completa, ventana flotante…) y con sonido.
function VisorVideo({ url, embed, titulo, desde, onCerrar }) {
  const ref = useRef(null);
  const cerrar = () => onCerrar(ref.current?.currentTime);

  useEffect(() => {
    const alTeclado = (e) => e.key === "Escape" && cerrar();
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  });

  return createPortal(
    <div className="tz-adjunto-visor tz-video-visor" onClick={cerrar}>
      {embed ? (
        <div className="tz-video-visor-yt" onClick={(e) => e.stopPropagation()}>
          <iframe
            src={`${embed}?autoplay=1&playsinline=1&controls=1&rel=0`}
            title={titulo || "Video"}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
      ) : (
        <video
          ref={ref}
          src={url}
          controls
          autoPlay
          playsInline
          onClick={(e) => e.stopPropagation()}
          onLoadedMetadata={(e) => {
            if (desde) e.currentTarget.currentTime = desde;
          }}
        />
      )}
      <div className="tz-adjunto-visor-acciones" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="tz-entrada-menu-btn" onClick={cerrar} aria-label="Cerrar">
          <X size={17} /> Cerrar
        </button>
      </div>
    </div>,
    document.body
  );
}
