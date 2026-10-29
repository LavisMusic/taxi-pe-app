import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, EllipsisVertical, Download, Gauge, PictureInPicture2 } from "lucide-react";
import { minSeg } from "../../lib/adjuntosChat";
import { useAvanceFluido } from "../../lib/avanceFluido";

// Reproductor propio del visor de video (VideoEnChat): sin los controles
// del navegador. Play/pausa, barra de avance fluida (se puede tocar y
// arrastrar), tiempo, sonido, pantalla completa y "⋮", que despliega
// Descargar / Velocidad / Ventana flotante con los mismos botones que el
// menú de las notas de voz. Los controles se esconden solos mientras se
// reproduce y vuelven al mover el cursor o tocar.
const VELOCIDADES = [1, 1.25, 1.5, 2];
const OCULTAR_MS = 2600;

export default function ReproductorVideo({ url, desde = 0, videoRef }) {
  const cajaRef = useRef(null);
  const barraRef = useRef(null);
  const rellenoRef = useRef(null);
  const puntoRef = useRef(null);
  const arrastrando = useRef(false);
  const ocultar = useRef(null);
  const [sonando, setSonando] = useState(false);
  const [actual, setActual] = useState(0);
  const [total, setTotal] = useState(0);
  const [silencio, setSilencio] = useState(false);
  const [velocidad, setVelocidad] = useState(1);
  const [menu, setMenu] = useState(false);
  const [completa, setCompleta] = useState(false);
  const [visibles, setVisibles] = useState(true);

  const pintar = (f) => {
    if (rellenoRef.current) rellenoRef.current.style.width = `${f * 100}%`;
    if (puntoRef.current) puntoRef.current.style.left = `${f * 100}%`;
  };
  useAvanceFluido(videoRef, (f) => !arrastrando.current && pintar(f), { activo: sonando, duracion: total });

  // Los controles se esconden solos mientras se reproduce.
  const mostrar = () => {
    setVisibles(true);
    clearTimeout(ocultar.current);
    ocultar.current = setTimeout(() => setVisibles(false), OCULTAR_MS);
  };
  useEffect(() => () => clearTimeout(ocultar.current), []);

  useEffect(() => {
    const alCambiar = () => setCompleta(document.fullscreenElement === cajaRef.current);
    document.addEventListener("fullscreenchange", alCambiar);
    return () => document.removeEventListener("fullscreenchange", alCambiar);
  }, []);

  useEffect(() => {
    if (!menu) return undefined;
    const cerrar = (e) => {
      if (!e.target.closest?.(".tz-repro-menu, .tz-repro-mas")) setMenu(false);
    };
    document.addEventListener("pointerdown", cerrar);
    return () => document.removeEventListener("pointerdown", cerrar);
  }, [menu]);

  const alternar = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    mostrar();
  };

  const irA = (clientX) => {
    const v = videoRef.current;
    const barra = barraRef.current?.getBoundingClientRect();
    if (!v || !barra || !total) return;
    const p = Math.min(1, Math.max(0, (clientX - barra.left) / barra.width));
    v.currentTime = p * total;
    setActual(p * total);
    pintar(p);
  };

  const alternarSonido = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setSilencio(v.muted);
  };

  const alternarCompleta = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else cajaRef.current?.requestFullscreen?.().catch(() => {});
  };

  const descargar = async () => {
    setMenu(false);
    try {
      const blob = await (await fetch(url)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `video-${Date.now()}.${(blob.type.split("/")[1] || "mp4").split(";")[0]}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch {
      window.open(url, "_blank", "noopener");
    }
  };

  const cambiarVelocidad = () => {
    const sig = VELOCIDADES[(VELOCIDADES.indexOf(velocidad) + 1) % VELOCIDADES.length];
    setVelocidad(sig);
    if (videoRef.current) videoRef.current.playbackRate = sig;
  };

  const ventanaFlotante = async () => {
    setMenu(false);
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await videoRef.current?.requestPictureInPicture();
    } catch {
      /* el navegador no lo permite */
    }
  };

  const conFlotante = typeof document !== "undefined" && document.pictureInPictureEnabled;
  const ocultos = sonando && !visibles && !menu;

  return (
    <div
      ref={cajaRef}
      className={`tz-repro ${ocultos ? "is-oculto" : ""} ${completa ? "is-completa" : ""}`}
      onClick={(e) => e.stopPropagation()}
      onPointerMove={mostrar}
    >
      <video
        ref={videoRef}
        src={url}
        autoPlay
        playsInline
        onClick={alternar}
        onPlay={() => {
          setSonando(true);
          mostrar();
        }}
        onPause={() => setSonando(false)}
        onEnded={() => setSonando(false)}
        onTimeUpdate={(e) => !arrastrando.current && setActual(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          if (Number.isFinite(v.duration) && v.duration > 0) setTotal(v.duration);
          if (desde) v.currentTime = desde;
          v.playbackRate = velocidad;
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setTotal(d);
        }}
      />
      {!sonando && (
        <button type="button" className="tz-repro-grande" onClick={alternar} aria-label="Reproducir">
          <Play size={30} />
        </button>
      )}
      <div className="tz-repro-controles">
        <div
          ref={barraRef}
          className="tz-repro-barra"
          onPointerDown={(e) => {
            arrastrando.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            irA(e.clientX);
          }}
          onPointerMove={(e) => arrastrando.current && irA(e.clientX)}
          onPointerUp={() => {
            arrastrando.current = false;
          }}
        >
          <span ref={rellenoRef} className="tz-repro-barra-relleno" style={{ width: 0 }} />
          <span ref={puntoRef} className="tz-repro-barra-punto" style={{ left: 0 }} />
        </div>
        <div className="tz-repro-fila">
          <button type="button" className="tz-repro-btn" onClick={alternar} aria-label={sonando ? "Pausar" : "Reproducir"}>
            {sonando ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <span className="tz-repro-tiempo">
            {minSeg(actual)} / {minSeg(total)}
            {velocidad !== 1 && <b> · {velocidad}×</b>}
          </span>
          <span className="tz-repro-espacio" />
          <button type="button" className="tz-repro-btn" onClick={alternarSonido} aria-label={silencio ? "Activar sonido" : "Silenciar"}>
            {silencio ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button
            type="button"
            className="tz-repro-btn"
            onClick={alternarCompleta}
            aria-label={completa ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            {completa ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
          <span className="tz-repro-mas-caja">
            <button
              type="button"
              className={`tz-repro-btn tz-repro-mas ${menu ? "is-activo" : ""}`}
              onClick={() => setMenu((m) => !m)}
              aria-label="Más opciones"
            >
              <EllipsisVertical size={18} />
            </button>
            {menu && (
              <div className="tz-entrada-menu tz-repro-menu">
                <button type="button" className="tz-entrada-menu-btn" onClick={descargar}>
                  <Download size={17} /> Descargar
                </button>
                <button type="button" className="tz-entrada-menu-btn" onClick={cambiarVelocidad}>
                  <Gauge size={17} /> Velocidad {velocidad}×
                </button>
                {conFlotante && (
                  <button type="button" className="tz-entrada-menu-btn" onClick={ventanaFlotante}>
                    <PictureInPicture2 size={17} /> Ventana flotante
                  </button>
                )}
              </div>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
