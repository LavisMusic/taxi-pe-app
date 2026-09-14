import { useMemo } from "react";

// Efecto de serpentinas — CSS puro (sin dependencia externa): N tiritas
// de colores del tema, posición/retraso/rotación al azar, caen y giran
// una sola vez con 'animation-fill-mode: forwards' (quedan invisibles al
// terminar, no hace falta desmontar el componente a mano). Se usa para
// celebrar momentos puntuales (ej. "entrega confirmada") — quien lo
// monta decide cuánto dura visible antes de sacarlo del DOM.
const COLORES = ["var(--cyan)", "var(--pink)", "var(--yellow)", "var(--green)"];
const PIEZAS = 36;

export default function Confetti() {
  const piezas = useMemo(
    () =>
      Array.from({ length: PIEZAS }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        delay: Math.random() * 0.35,
        duration: 1.4 + Math.random() * 0.8,
        color: COLORES[i % COLORES.length],
        rotate: Math.random() * 360,
        drift: (Math.random() - 0.5) * 120,
      })),
    []
  );

  return (
    <div className="tz-confetti-wrap" aria-hidden="true">
      {piezas.map((p) => (
        <span
          key={p.id}
          className="tz-confetti-piece"
          style={{
            left: `${p.left}%`,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            "--tz-confetti-rotate": `${p.rotate}deg`,
            "--tz-confetti-drift": `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
