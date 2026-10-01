import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// Misma animación que Caja Tonazo (src/components/AnimacionExitoNeon.jsx
// allá) — mantener las dos copias iguales. Reemplaza el "confetti +
// listo" que antes se veía DENTRO del escáner QR (Confetti.jsx
// superpuesto al modal, que seguía abierto detrás) — mismo objeto (serpentinas) y misma paleta
// neón que ya usa el resto de la app, pero ahora es una capa a
// PANTALLA COMPLETA propia (igual que AnimacionNeonBienvenida.jsx):
// el padre cierra los modales de seguimiento (QR, chat, mapa) ANTES de
// montar esto, así la celebración es lo único que se ve, no algo
// flotando encima de una ventana que sigue ahí. Se anima con
// variants orquestados (aro que se dibuja + check que aparece con
// resorte + 3 tandas de serpentinas escalonadas) y se autodestruye
// sola tras MS_VISIBLE, avisando a 'onTerminar' — igual que la
// bienvenida, para que el padre nunca tenga que adivinar el timing.
const MS_VISIBLE = 2600;

const variantesOverlay = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.35, ease: "easeOut" } },
  exit: { opacity: 0, transition: { duration: 0.45, ease: "easeIn" } },
};

const variantesAro = {
  initial: { scale: 0.4, opacity: 0 },
  animate: {
    scale: 1,
    opacity: 1,
    transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
  },
  exit: { scale: 0.85, opacity: 0, transition: { duration: 0.3 } },
};

const variantesCheck = {
  initial: { pathLength: 0, opacity: 0 },
  animate: {
    pathLength: 1,
    opacity: 1,
    transition: { delay: 0.4, duration: 0.45, ease: "easeOut" },
  },
};

const variantesTexto = {
  initial: { opacity: 0, y: 14 },
  animate: (i) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.7 + i * 0.12, duration: 0.5, ease: "easeOut" },
  }),
};

// 3 tandas de piezas, cada una con su propio delay — en vez de las 36
// piezas cayendo todas juntas de arriba (Confetti.jsx original), acá
// ESTALLAN desde el centro en oleadas sucesivas, más parecido a un
// festejo real que a una sola lluvia pareja.
const COLORES = ["var(--tz-exito-cyan)", "var(--tz-exito-pink)", "var(--tz-exito-yellow)", "var(--tz-exito-green)"];
function crearOleada(cantidad, delayBase) {
  return Array.from({ length: cantidad }, (_, i) => {
    const angulo = (i / cantidad) * Math.PI * 2 + Math.random() * 0.3;
    const distancia = 38 + Math.random() * 42;
    return {
      id: i,
      color: COLORES[i % COLORES.length],
      dx: Math.cos(angulo) * distancia,
      dy: Math.sin(angulo) * distancia - 10,
      rotate: Math.random() * 520 - 260,
      delay: delayBase + Math.random() * 0.15,
      duration: 1.1 + Math.random() * 0.5,
      size: 7 + Math.random() * 5,
    };
  });
}
const OLEADAS = [crearOleada(18, 0.15), crearOleada(16, 0.45), crearOleada(14, 0.75)];

export default function AnimacionExitoNeon({ titulo = "¡Listo!", descripcion, onTerminar }) {
  const [presente, setPresente] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setPresente(false), MS_VISIBLE);
    return () => clearTimeout(t);
  }, []);

  return (
    <AnimatePresence onExitComplete={onTerminar}>
      {presente && (
        <motion.div
          className="tz-exito-overlay"
          variants={variantesOverlay}
          initial="initial"
          animate="animate"
          exit="exit"
          role="status"
          aria-live="polite"
        >
          <div className="tz-exito-glow" />

          {OLEADAS.map((oleada, oi) => (
            <div key={oi} className="tz-exito-confetti-field">
              {oleada.map((p) => (
                <motion.span
                  key={p.id}
                  className="tz-exito-confetti-piece"
                  style={{ background: p.color, width: p.size, height: p.size * 1.5 }}
                  initial={{ opacity: 0, x: 0, y: 0, rotate: 0, scale: 0.5 }}
                  animate={{
                    opacity: [0, 1, 1, 0],
                    x: `${p.dx}vmin`,
                    y: [`0vmin`, `${p.dy}vmin`, `${p.dy + 30}vmin`],
                    rotate: p.rotate,
                    scale: 1,
                  }}
                  transition={{ delay: p.delay, duration: p.duration, ease: "easeOut", times: [0, 0.15, 0.6, 1] }}
                />
              ))}
            </div>
          ))}

          <motion.div className="tz-exito-badge" variants={variantesAro} initial="initial" animate="animate" exit="exit">
            <svg className="tz-exito-aro" viewBox="0 0 120 120" aria-hidden="true">
              <circle className="tz-exito-aro-fondo" cx="60" cy="60" r="52" />
              <motion.circle
                className="tz-exito-aro-trazo"
                cx="60"
                cy="60"
                r="52"
                variants={variantesCheck}
                initial="initial"
                animate="animate"
              />
              <motion.path
                className="tz-exito-check"
                d="M38 62 L54 78 L84 42"
                variants={variantesCheck}
                initial="initial"
                animate="animate"
              />
            </svg>
          </motion.div>

          <motion.h1 className="tz-exito-titulo" custom={0} variants={variantesTexto} initial="initial" animate="animate">
            {titulo}
          </motion.h1>
          {descripcion && (
            <motion.p className="tz-exito-desc" custom={1} variants={variantesTexto} initial="initial" animate="animate">
              {descripcion}
            </motion.p>
          )}

          <style>{`
            .tz-exito-overlay {
              --tz-exito-cyan: #2be8ff;
              --tz-exito-pink: #ff2f9e;
              --tz-exito-yellow: #ffe066;
              --tz-exito-green: #4dffa0;
              position: fixed;
              inset: 0;
              z-index: 999999;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: 14px;
              overflow: hidden;
              background: radial-gradient(circle at 50% 45%, rgba(10,30,26,0.95) 0%, rgba(3,8,9,0.98) 60%, #000 100%);
            }
            .tz-exito-glow {
              position: absolute;
              width: 60vmin;
              height: 60vmin;
              border-radius: 50%;
              background: radial-gradient(circle, rgba(43,232,255,0.35), transparent 70%);
              filter: blur(20px);
              animation: tz-exito-glow-pulse 1.8s ease-in-out infinite;
              pointer-events: none;
            }
            @keyframes tz-exito-glow-pulse {
              0%, 100% { transform: scale(1); opacity: 0.7; }
              50% { transform: scale(1.15); opacity: 1; }
            }

            .tz-exito-confetti-field {
              position: absolute;
              top: 45%;
              left: 50%;
              width: 0;
              height: 0;
              pointer-events: none;
            }
            .tz-exito-confetti-piece {
              position: absolute;
              top: 0;
              left: 0;
              border-radius: 2px;
            }

            .tz-exito-badge {
              position: relative;
              z-index: 2;
              width: min(34vmin, 150px);
              height: min(34vmin, 150px);
            }
            .tz-exito-aro { width: 100%; height: 100%; overflow: visible; }
            .tz-exito-aro-fondo {
              fill: rgba(255,255,255,0.04);
              stroke: rgba(255,255,255,0.12);
              stroke-width: 3;
            }
            .tz-exito-aro-trazo {
              fill: none;
              stroke: var(--tz-exito-green);
              stroke-width: 5;
              stroke-linecap: round;
              transform-origin: 60px 60px;
              transform: rotate(-90deg);
              filter: drop-shadow(0 0 10px var(--tz-exito-green)) drop-shadow(0 0 22px var(--tz-exito-green));
            }
            .tz-exito-check {
              fill: none;
              stroke: #eafcff;
              stroke-width: 7;
              stroke-linecap: round;
              stroke-linejoin: round;
              filter: drop-shadow(0 0 8px rgba(255,255,255,0.8));
            }

            .tz-exito-titulo {
              position: relative;
              z-index: 2;
              margin: 6px 0 0;
              text-align: center;
              font-family: 'Orbitron', sans-serif;
              font-weight: 900;
              font-size: clamp(24px, 6vw, 44px);
              background: linear-gradient(90deg, var(--tz-exito-green), #eafcff 45%, var(--tz-exito-cyan));
              -webkit-background-clip: text;
              background-clip: text;
              color: transparent;
              text-shadow: 0 0 18px rgba(77,255,160,0.5), 0 0 30px rgba(43,232,255,0.35);
            }
            .tz-exito-desc {
              position: relative;
              z-index: 2;
              margin: 0;
              text-align: center;
              max-width: 320px;
              font-family: 'Rajdhani', sans-serif;
              font-weight: 600;
              font-size: clamp(13px, 3vw, 17px);
              color: #dffcff;
              text-shadow: 0 0 12px rgba(43,232,255,0.35);
            }

            @media (prefers-reduced-motion: reduce) {
              .tz-exito-overlay * { animation-duration: 0.01ms !important; }
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
