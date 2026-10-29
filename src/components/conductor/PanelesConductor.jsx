import { useEffect, useRef, useState } from "react";

// Dos paneles del conductor (Viajes y Delivery) en un cubo 3D. Arranca en
// Viajes; deslizando hacia la izquierda entra el panel de Delivery (cara
// derecha del cubo) siguiendo el dedo, y hacia la derecha se vuelve a
// Viajes. También se cambia tocando las pestañas de arriba. Solo se mueve
// el contenido de debajo de la cabecera: el fondo y el pie de página no.
//
// El 3D (perspective / preserve-3d / transform) existe SOLO mientras gira:
// cualquiera de esas propiedades convierte al panel en el "marco" de los
// position: fixed de adentro, y los avisos a pantalla completa (ej. "¡Alguien
// necesita tu servicio!") quedaban encerrados en la columna. Quieto, la
// cara visible no lleva ninguna transformación. En reposo la transformación
// del cubo + la de la cara dan la identidad, así que el cambio no se nota.
// `fijo` ("delivery" mientras reparte): el cubo gira solo a esa cara y queda
// ahí — sin deslizar ni la otra pestaña — hasta que se libera.
const UMBRAL_ARRASTRE = 12; // px antes de decidir que es un deslizamiento horizontal
const DURACION_MS = 600;
const ANGULO = { viajes: 0, delivery: -90 };

export default function PanelesConductor({ panel, onCambiar, viajes, delivery, fijo = null }) {
  const contRef = useRef(null);
  const [ancho, setAncho] = useState(360);
  const [arrastre, setArrastre] = useState(null); // px mientras se desliza
  const [anim, setAnim] = useState(null); // { angulo, transicion } mientras gira
  const gesto = useRef(null);
  const suprimirClic = useRef(false);
  const finAnim = useRef(null);

  useEffect(() => {
    const el = contRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setAncho(el.clientWidth || 360));
    ro.observe(el);
    setAncho(el.clientWidth || 360);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => clearTimeout(finAnim.current), []);

  const reposo = ANGULO[panel] ?? 0;
  const anguloArrastre =
    arrastre == null ? reposo : Math.max(-90, Math.min(0, reposo + (arrastre / Math.max(ancho, 1)) * 90));
  const en3d = arrastre != null || anim != null;
  const angulo = arrastre != null ? anguloArrastre : anim ? anim.angulo : reposo;

  // Gira desde `desde` hasta la cara de `destino`: un frame en el ángulo de
  // partida (sin transición) y después la transición hasta el destino.
  const ir = (destino, desde) => {
    clearTimeout(finAnim.current);
    setAnim({ angulo: desde, transicion: false });
    if (destino !== panel) onCambiar(destino);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setAnim({ angulo: ANGULO[destino], transicion: true }))
    );
    finAnim.current = setTimeout(() => setAnim(null), DURACION_MS + 80);
  };

  // Al fijarse (empezó a repartir) gira solo hasta esa cara.
  useEffect(() => {
    if (fijo && panel !== fijo) ir(fijo, ANGULO[panel] ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fijo]);

  const onPointerDown = (e) => {
    if (fijo) return;
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
      clearTimeout(finAnim.current);
      setAnim(null);
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
    const desde = anguloArrastre;
    setArrastre(null);
    ir(desde < -45 ? "delivery" : "viajes", desde);
  };

  const estiloCara = (rot) =>
    en3d ? { transform: `rotateY(${rot}deg) translateZ(calc(var(--tz-panel-ancho) / 2))` } : undefined;

  return (
    <div className="tz-paneles-wrap">
      <div className="tz-paneles-tabs" role="tablist">
        {[
          ["viajes", "Viajes"],
          ["delivery", "Delivery"],
        ].map(([id, etiqueta]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={panel === id}
            className={panel === id ? "is-activa" : ""}
            disabled={!!fijo && id !== fijo}
            title={fijo && id !== fijo ? "Termina tus repartos para volver a Viajes" : undefined}
            onClick={() => panel !== id && ir(id, reposo)}
          >
            {etiqueta}
          </button>
        ))}
      </div>
      <div
        ref={contRef}
        className={`tz-paneles ${en3d ? "is-3d" : ""}`}
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
          style={
            en3d
              ? {
                  transform: `translateZ(calc(var(--tz-panel-ancho) / -2)) rotateY(${angulo}deg)`,
                  transition:
                    anim?.transicion && arrastre == null
                      ? `transform ${DURACION_MS}ms cubic-bezier(0.22, 0.8, 0.2, 1)`
                      : "none",
                }
              : undefined
          }
        >
          {/* Las dos caras siempre montadas (las ofertas de reparto siguen
              llegando estando en Viajes); quieta, la otra cara queda oculta
              y sin alto, pero sus avisos a pantalla completa sí se ven. */}
          <section className={`tz-panel-cara ${!en3d && panel !== "viajes" ? "is-oculta" : ""}`} style={estiloCara(0)}>
            {viajes}
          </section>
          <section className={`tz-panel-cara ${!en3d && panel !== "delivery" ? "is-oculta" : ""}`} style={estiloCara(90)}>
            {delivery}
          </section>
        </div>
      </div>
    </div>
  );
}
