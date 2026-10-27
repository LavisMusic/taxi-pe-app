import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { toYoutubeEmbedUrl } from "../../lib/youtube";

// Video de un anuncio dentro del chat (fijados "Taxi PE" / "Tonazo"): se
// reproduce solo apenas se ve en pantalla y se pausa al salir. Arranca sin
// sonido (los navegadores no dejan reproducir solo con sonido) y con un
// botón para activarlo. YouTube igual, por su API de mensajes
// (enablejsapi=1).
export default function VideoEnChat({ url, titulo }) {
  const embed = toYoutubeEmbedUrl(url);
  const cajaRef = useRef(null);
  const videoRef = useRef(null);
  const iframeRef = useRef(null);
  const [silencio, setSilencio] = useState(true);

  const ordenYoutube = (func, args = []) =>
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");

  useEffect(() => {
    const el = cajaRef.current;
    if (!el) return undefined;
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
  }, [embed]);

  const alternarSonido = () => {
    const nuevo = !silencio;
    setSilencio(nuevo);
    if (embed) ordenYoutube(nuevo ? "mute" : "unMute");
    else if (videoRef.current) videoRef.current.muted = nuevo;
  };

  return (
    <div ref={cajaRef} className="tz-chatfijo-video-caja">
      {embed ? (
        <div className="tz-chatfijo-video">
          <iframe
            ref={iframeRef}
            src={`${embed}?enablejsapi=1&autoplay=1&mute=1&playsinline=1&controls=1&rel=0`}
            title={titulo || "Anuncio"}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <video ref={videoRef} src={url} muted playsInline loop preload="metadata" className="tz-chatfijo-media" />
      )}
      <button
        type="button"
        className={`tz-chatfijo-sonido ${silencio ? "" : "is-activo"}`}
        onClick={alternarSonido}
        aria-label={silencio ? "Activar sonido" : "Silenciar"}
      >
        {silencio ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
    </div>
  );
}
