import { useEffect, useRef, useState } from "react";

// Dos paneles del conductor (Viajes y Delivery) en un cubo 3D: deslizando
// hacia la derecha entra el panel de Delivery (cara izquierda del cubo)
// siguiendo el dedo; hacia la izquierda se vuelve a Viajes. También se
// cambia tocando las pestañas de arriba. Solo se mueve el contenido de
// debajo de la cabecera: el fondo y el pie de página quedan fijos.
const UMBRAL_ARRASTRE = 12; // px antes de decidir que es un deslizamiento horizontal
const DURACION_MS = 600;

export default function PanelesConductor({ panel, onCambiar, viajes, delivery }) {
  const contRef = useRef(null);
  const [ancho, setAncho] = useState(360);
  const [arrastre, setArrastre] = useState(null); // px mientras se desliza
  const [enMovimiento, setEnMovimiento] = useState(false);
  const gesto = useRef(null);
  const suprimirClic = useRef(false);

  useEffect(() => {
    const el = contRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setAncho(el.clientWidth || 360));
    ro.observe(el);
    setAncho(el.clientWidth || 360);
    return () => ro.disconnect();
  }, []);

  // Las dos caras se dibujan solo mientras gira; quieto, solo la visible
  // (así el alto de la página es el del panel que se ve).
  useEffect(() => {
    setEnMovimiento(true);
    const t = setTimeout(() => setEnMovimiento(false), DURACION_MS + 50);
    return () => clearTimeout(t);
  }, [panel]);

  const base = panel === "delivery" ? 90 : 0;
  const extra = arrastre == null ? 0 : (arrastre / Math.max(ancho, 1)) * 90;
  const angulo = Math.max(0, Math.min(90, base + extra));
  const ambas = enMovimiento || arrastre != null;

  const onPointerDown = (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Arrastrar un mapa, escribir o elegir en una lista no gira el cubo.
    if (e.target.closest?.(".leaflet-container, input, textarea, select, .tz-dropdown")) return;
    gesto.current = { x: e.clientX, y: e.clientY, horizontal: null };
  };
  const onPointerMove = (e) => {
    const g = gesto.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (g.horizontal == null) {
      if (Math.abs(dx) < UMBRAL_ARRASTRE && Math.abs(dy) < UMBRAL_ARRASTRE) return;
      g.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!g.horizontal) {
        gesto.current = null;
        return;
      }
    }
    setArrastre(dx);
  };
  const terminar = () => {
    const g = gesto.current;
    gesto.current = null;
    if (!g?.horizontal || arrastre == null) {
      setArrastre(null);
      return;
    }
    suprimirClic.current = true;
    setTimeout(() => {
      suprimirClic.current = false;
    }, 50);
    const destino = angulo > 45 ? "delivery" : "viajes";
    setArrastre(null);
    if (destino !== panel) onCambiar(destino);
  };

  return (
    <div className="tz-paneles-wrap">
      <div className="tz-paneles-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={panel === "delivery"}
          className={panel === "delivery" ? "is-activa" : ""}
          onClick={() => onCambiar("delivery")}
        >
          Delivery
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={panel === "viajes"}
          className={panel === "viajes" ? "is-activa" : ""}
          onClick={() => onCambiar("viajes")}
        >
          Viajes
        </button>
      </div>
      <div
        ref={contRef}
        className="tz-paneles"
        style={{ "--tz-panel-ancho": `${ancho}px` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={terminar}
        onPointerCancel={terminar}
        onClickCapture={(e) => {
          if (suprimirClic.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <div
          className="tz-paneles-cubo"
          style={{
            transform: `translateZ(calc(var(--tz-panel-ancho) / -2)) rotateY(${angulo}deg)`,
            transition: arrastre != null ? "none" : `transform ${DURACION_MS}ms cubic-bezier(0.22, 0.8, 0.2, 1)`,
          }}
        >
          {(ambas || panel === "viajes") && (
            <section className="tz-panel-cara" style={{ transform: "rotateY(0deg) translateZ(calc(var(--tz-panel-ancho) / 2))" }}>
              {viajes}
            </section>
          )}
          {(ambas || panel === "delivery") && (
            <section className="tz-panel-cara" style={{ transform: "rotateY(-90deg) translateZ(calc(var(--tz-panel-ancho) / 2))" }}>
              {delivery}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
