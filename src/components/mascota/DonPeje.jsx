import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Don Peje en pantalla: un lienzo fijo (sin fondo) con el robot 3D. El
// motor (three.js + el modelo) se carga recién acá, con import dinámico.
// `pos`: { x, y } en px (esquina superior izquierda del lienzo; puede quedar
// en parte fuera de la pantalla). Despierto, al moverse lejos salta y gira
// hacia donde va. `dormido`: se echa a dormir (con "Zzz") y se desliza sin
// saltar. `onListo(motor)`: entrega el motor (hacer, mirar, girar, hablar,
// emocion, dormir). `onClick`: qué hacer al tocarlo dormido (despertarlo).
export default function DonPeje({ pos, tam = 336, dormido = false, onListo, onClick, etiqueta = "Don Peje" }) {
  const lienzo = useRef(null);
  const motor = useRef(null);
  const [listo, setListo] = useState(false);
  const anterior = useRef(null);
  const gesto = useRef(null);
  const alto = Math.round(tam * 1.15);

  // Dormido, cualquier toque lo despierta (`onClick`). Despierto: tocarlo lo
  // incomoda (se queja y sacude la cabeza); deslizar el dedo hacia arriba
  // sobre él lo hace impulsarse con las ruedas y dar una voltereta.
  const alTocar = () => {
    if (dormido) onClick?.();
    else motor.current?.hacer("molesto");
  };
  const alDeslizarArriba = () => {
    if (dormido) onClick?.();
    else motor.current?.hacer("voltereta");
  };

  useEffect(() => {
    let vivo = true;
    let m = null;
    import("./motorDonPeje.js")
      .then((mod) => mod.crearDonPeje(lienzo.current))
      .then((creado) => {
        if (!vivo) {
          creado.destruir();
          return;
        }
        m = creado;
        motor.current = creado;
        creado.dormir(dormido);
        setListo(true);
        onListo?.(creado);
      })
      .catch(() => {
        /* sin WebGL o sin red: la guía sigue con el globo de texto */
        onListo?.(null);
      });
    return () => {
      vivo = false;
      m?.destruir();
      motor.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    motor.current?.redimensionar(tam, alto);
  }, [tam, alto, listo]);

  useEffect(() => {
    motor.current?.dormir(dormido);
  }, [dormido, listo]);

  // Despierto: se mueve saltando y mirando hacia donde va.
  useEffect(() => {
    const m = motor.current;
    const a = anterior.current;
    anterior.current = pos;
    if (!m || !a || !pos || dormido) return;
    const dx = pos.x - a.x;
    const dy = pos.y - a.y;
    if (Math.hypot(dx, dy) > 60) {
      m.girar(dx > 0 ? 1.2 : dx < 0 ? -1.2 : 0.35);
      m.hacer("saltar", () => m.girar(0.35));
    }
  }, [pos?.x, pos?.y, listo]); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div
      className={`tz-donpeje ${listo ? "is-listo" : ""} ${dormido ? "is-dormido" : ""}`}
      style={{ left: pos?.x ?? -600, top: pos?.y ?? -600, width: tam, height: alto }}
    >
      <canvas ref={lienzo} className="tz-donpeje-lienzo" />
      <span className="tz-donpeje-sombra" aria-hidden="true" />
      {dormido && (
        <span className="tz-donpeje-zzz" aria-hidden="true">
          <i>Z</i>
          <i>z</i>
          <i>z</i>
        </span>
      )}
      <button
        type="button"
        className="tz-donpeje-toque"
        aria-label={etiqueta}
        onPointerDown={(e) => {
          gesto.current = { x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerUp={(e) => {
          const g = gesto.current;
          gesto.current = null;
          if (!g) return;
          const dx = e.clientX - g.x;
          const dy = e.clientY - g.y;
          if (dy < -40 && -dy > Math.abs(dx)) alDeslizarArriba();
          else if (Math.hypot(dx, dy) < 16) alTocar();
        }}
        onPointerCancel={() => (gesto.current = null)}
        onClick={(e) => {
          // Solo teclado (Enter/Espacio): con dedo o mouse ya lo hizo pointerup.
          if (e.detail === 0) alTocar();
        }}
      />
    </div>,
    document.body
  );
}
