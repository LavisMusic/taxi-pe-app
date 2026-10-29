import { useEffect, useRef, useState } from "react";
import { Play, Pause, Download, Gauge } from "lucide-react";
import { minSeg } from "../../lib/adjuntosChat";

// Nota de voz dentro del chat: una píldora con el color de las burbujas del
// tema (`claseBurbuja`: las mismas clases que la burbuja de ese chat), sin
// el reproductor del navegador — play/pausa, barra de avance (se puede
// tocar y arrastrar) y el tiempo. Manteniéndola presionada se despliega el
// menú (Descargar / Velocidad), con el mismo diseño que "Subir foto".
// `duracion` viene del mensaje: las grabaciones webm no traen su duración.
const VELOCIDADES = [1, 1.5, 2];
const MANTENER_MS = 480;

export default function NotaDeVoz({ url, duracion = 0, claseBurbuja = "" }) {
  const audioRef = useRef(null);
  const barraRef = useRef(null);
  const [sonando, setSonando] = useState(false);
  const [actual, setActual] = useState(0);
  const [total, setTotal] = useState(duracion);
  const [velocidad, setVelocidad] = useState(1);
  const [menu, setMenu] = useState(false);
  const mantener = useRef(null);
  const arrastrando = useRef(false);

  useEffect(() => {
    if (!menu) return undefined;
    const cerrar = (e) => {
      if (!e.target.closest?.(".tz-nota-menu")) setMenu(false);
    };
    document.addEventListener("pointerdown", cerrar);
    return () => document.removeEventListener("pointerdown", cerrar);
  }, [menu]);

  const alternar = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  const irA = (clientX) => {
    const a = audioRef.current;
    const barra = barraRef.current?.getBoundingClientRect();
    if (!a || !barra || !total) return;
    const p = Math.min(1, Math.max(0, (clientX - barra.left) / barra.width));
    a.currentTime = p * total;
    setActual(p * total);
  };

  const empezarMantener = () => {
    clearTimeout(mantener.current);
    mantener.current = setTimeout(() => {
      setMenu(true);
      navigator.vibrate?.(30);
    }, MANTENER_MS);
  };
  const soltarMantener = () => clearTimeout(mantener.current);

  const descargar = async () => {
    setMenu(false);
    try {
      const blob = await (await fetch(url)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `nota-de-voz-${Date.now()}.${(blob.type.split("/")[1] || "webm").split(";")[0]}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch {
      window.open(url, "_blank", "noopener");
    }
  };

  const cambiarVelocidad = () => {
    const sig = VELOCIDADES[(VELOCIDADES.indexOf(velocidad) + 1) % VELOCIDADES.length];
    setVelocidad(sig);
    if (audioRef.current) audioRef.current.playbackRate = sig;
  };

  const progreso = total ? Math.min(1, actual / total) : 0;

  return (
    <div
      className={`tz-nota ${claseBurbuja} ${sonando ? "is-sonando" : ""}`}
      onPointerDown={empezarMantener}
      onPointerUp={soltarMantener}
      onPointerLeave={soltarMantener}
      onPointerCancel={soltarMantener}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(true);
      }}
    >
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setSonando(true)}
        onPause={() => setSonando(false)}
        onEnded={() => {
          setSonando(false);
          setActual(0);
        }}
        onTimeUpdate={(e) => !arrastrando.current && setActual(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setTotal(d);
          e.currentTarget.playbackRate = velocidad;
        }}
      />
      <button type="button" className="tz-nota-play" onClick={alternar} aria-label={sonando ? "Pausar" : "Reproducir"}>
        {sonando ? <Pause size={17} /> : <Play size={17} />}
      </button>
      <div
        ref={barraRef}
        className="tz-nota-barra"
        onPointerDown={(e) => {
          e.stopPropagation();
          arrastrando.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          irA(e.clientX);
        }}
        onPointerMove={(e) => arrastrando.current && irA(e.clientX)}
        onPointerUp={() => {
          arrastrando.current = false;
        }}
      >
        <span className="tz-nota-barra-relleno" style={{ width: `${progreso * 100}%` }} />
        <span className="tz-nota-barra-punto" style={{ left: `${progreso * 100}%` }} />
      </div>
      <span className="tz-nota-tiempo">
        {velocidad !== 1 && <b>{velocidad}×</b>} {minSeg(sonando || actual ? actual : total)}
      </span>
      {menu && (
        <div className="tz-entrada-menu tz-nota-menu">
          <button type="button" className="tz-entrada-menu-btn" onClick={descargar}>
            <Download size={17} /> Descargar
          </button>
          <button type="button" className="tz-entrada-menu-btn" onClick={cambiarVelocidad}>
            <Gauge size={17} /> Velocidad {velocidad}×
          </button>
        </div>
      )}
    </div>
  );
}
