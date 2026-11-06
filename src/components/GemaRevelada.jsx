import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Gema ganada (Gemas cruzadas, fase 1) — mismo archivo en Caja Tonazo y
// Taxi-PE.
//
// Después del conteo tipo casino (ContadorCreditos), un relleno neón sube
// y cubre toda la pantalla; al llenarse, destella y revela una gema 3D de
// verdad (corona, mesa y pabellón octogonales en CSS 3D) girando y
// brillando, con la cantidad ganada. Se cierra sola o tocando.
//
// `color`: "verde" (compras en negocios) o "celeste" (viajes en Taxi-PE).

const LADOS = 8;
// Medidas de la gema (px): radio del filetín, de la mesa, alto de la
// corona y fondo del pabellón.
const R = 70;
const R_MESA = 38;
const ALTO_CORONA = 34;
const FONDO_PABELLON = 88;

const COS = Math.cos(Math.PI / LADOS);
const TAN = Math.tan(Math.PI / LADOS);
const APOTEMA = R * COS;
const APOTEMA_MESA = R_MESA * COS;
const ANCHO_LADO = 2 * APOTEMA * TAN;
const ANCHO_MESA_LADO = 2 * APOTEMA_MESA * TAN;
const LARGO_CORONA = Math.hypot(APOTEMA - APOTEMA_MESA, ALTO_CORONA);
const ANG_CORONA = (Math.atan((APOTEMA - APOTEMA_MESA) / ALTO_CORONA) * 180) / Math.PI;
const LARGO_PABELLON = Math.hypot(APOTEMA, FONDO_PABELLON);
const ANG_PABELLON = (Math.atan(APOTEMA / FONDO_PABELLON) * 180) / Math.PI;
const RECORTE_CORONA = (((ANCHO_LADO - ANCHO_MESA_LADO) / 2 / ANCHO_LADO) * 100).toFixed(2);
// Brillo de cada faceta (fijo a la gema: al girar, las facetas destellan).
const LUZ = [1.35, 1.1, 0.8, 0.62, 0.72, 0.95, 1.2, 1.45];

const TEXTOS = {
  verde: { nombre: "gema verde", nombres: "gemas verdes", uso: "Úsala como descuento en tu próximo viaje en Taxi-PE." },
  celeste: { nombre: "gema celeste", nombres: "gemas celestes", uso: "Úsala como descuento al comprar en las tiendas." },
};

function reducirMovimiento() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// La gema sola (también se usa fuera de la animación, ej. en la
// configuración del superadmin). `tam`: escala; ocupa 160 px × tam.
export function Gema3D({ color = "verde", tam = 1 }) {
  return (
    <span className="tz-g3d-caja" style={{ width: `${160 * tam}px`, height: `${160 * tam}px` }} aria-hidden="true">
      <style>{ESTILO}</style>
      <GemaCuerpo color={color} tam={tam} />
    </span>
  );
}

function GemaCuerpo({ color, tam }) {
  return (
    <span className={`tz-g3d tz-g3d-${color}`} style={{ "--tz-g3d-escala": tam }}>
      <span className="tz-g3d-halo" />
      <span className="tz-g3d-escena">
        <span className="tz-g3d-cuerpo">
          {Array.from({ length: LADOS }, (_, k) => (
            <span
              key={`c${k}`}
              className="tz-g3d-cara tz-g3d-corona"
              style={{
                width: `${ANCHO_LADO}px`,
                height: `${LARGO_CORONA}px`,
                left: `${-ANCHO_LADO / 2}px`,
                top: `${-LARGO_CORONA}px`,
                clipPath: `polygon(${RECORTE_CORONA}% 0, ${100 - RECORTE_CORONA}% 0, 100% 100%, 0 100%)`,
                transform: `rotateY(${k * (360 / LADOS)}deg) translateZ(${APOTEMA - 0.4}px) rotateX(${ANG_CORONA}deg)`,
                filter: `brightness(${LUZ[k]})`,
              }}
            />
          ))}
          <span
            className="tz-g3d-cara tz-g3d-mesa"
            style={{
              width: `${2 * APOTEMA_MESA}px`,
              height: `${2 * APOTEMA_MESA}px`,
              left: `${-APOTEMA_MESA}px`,
              top: `${-APOTEMA_MESA}px`,
              transform: `translateY(${-ALTO_CORONA}px) rotateX(90deg)`,
            }}
          />
          {Array.from({ length: LADOS }, (_, k) => (
            <span
              key={`p${k}`}
              className="tz-g3d-cara tz-g3d-pabellon"
              style={{
                width: `${ANCHO_LADO}px`,
                height: `${LARGO_PABELLON}px`,
                left: `${-ANCHO_LADO / 2}px`,
                top: 0,
                transform: `rotateY(${k * (360 / LADOS)}deg) translateZ(${APOTEMA - 0.4}px) rotateX(${-ANG_PABELLON}deg)`,
                filter: `brightness(${LUZ[(k + 3) % LADOS] * 0.85})`,
              }}
            />
          ))}
        </span>
      </span>
      <span className="tz-g3d-chispa tz-g3d-chispa-1" />
      <span className="tz-g3d-chispa tz-g3d-chispa-2" />
    </span>
  );
}

export default function GemaRevelada({ color = "verde", cantidad = 1, onCerrar }) {
  const [fase, setFase] = useState(() => (reducirMovimiento() ? "gema" : "relleno"));
  const [saliendo, setSaliendo] = useState(false);
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;
  const textos = TEXTOS[color] || TEXTOS.verde;

  useEffect(() => {
    if (fase !== "relleno") return undefined;
    const t = setTimeout(() => setFase("gema"), 950);
    return () => clearTimeout(t);
  }, [fase]);

  const cerrar = () => {
    if (saliendo) return;
    setSaliendo(true);
    setTimeout(() => cerrarRef.current?.(), 420);
  };

  useEffect(() => {
    if (fase !== "gema") return undefined;
    const t = setTimeout(cerrar, 5200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase]);

  return createPortal(
    <div
      className={`tz-gema-overlay tz-gema-${color} tz-gema-fase-${fase}${saliendo ? " tz-gema-saliendo" : ""}`}
      role="dialog"
      aria-label={`Ganaste ${cantidad} ${cantidad === 1 ? textos.nombre : textos.nombres}`}
      onClick={cerrar}
    >
      <style>{ESTILO}</style>
      <div className="tz-gema-fondo" />
      <div className="tz-gema-relleno">
        <div className="tz-gema-borde" />
      </div>
      <div className="tz-gema-destello" />
      {fase === "gema" && (
        <div className="tz-gema-centro">
          <div className="tz-gema-rayos" />
          <div className="tz-gema-pieza">
            <span className="tz-g3d-caja" style={{ width: 160, height: 160 }} aria-hidden="true">
              <GemaCuerpo color={color} tam={1} />
            </span>
          </div>
          <div className="tz-gema-cantidad">+{cantidad}</div>
          <div className="tz-gema-titulo">
            ¡Ganaste {cantidad === 1 ? `una ${textos.nombre}` : `${cantidad} ${textos.nombres}`}!
          </div>
          <div className="tz-gema-uso">{textos.uso}</div>
          <div className="tz-gema-toca">Toca para continuar</div>
        </div>
      )}
    </div>,
    document.body
  );
}

const ESTILO = `
.tz-gema-overlay {
  --gc: #39ffb0;
  --gc-rgb: 57, 255, 176;
  --gc-claro: #c4ffe3;
  --gc-medio: #16c25a;
  --gc-oscuro: #075c2a;
  position: fixed;
  inset: 0;
  z-index: 10050;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
  font-family: 'Orbitron', 'Rajdhani', sans-serif;
  animation: tz-gema-entra 0.25s ease-out both;
}
.tz-gema-overlay.tz-gema-celeste {
  --gc: #2be8ff;
  --gc-rgb: 43, 232, 255;
  --gc-claro: #c8f6ff;
  --gc-medio: #1689f5;
  --gc-oscuro: #08307d;
}
.tz-gema-saliendo { animation: tz-gema-sale 0.42s ease-in forwards; }
.tz-gema-fondo {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 38%, rgba(var(--gc-rgb), 0.2), transparent 45%),
    rgba(2, 6, 12, 0.95);
  backdrop-filter: blur(6px);
}
/* Relleno neón que sube y cubre la pantalla. */
.tz-gema-relleno {
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.07) 0 1px, transparent 1px 4px),
    linear-gradient(0deg, rgba(var(--gc-rgb), 0.62), rgba(var(--gc-rgb), 0.22) 70%, rgba(var(--gc-rgb), 0.08));
  clip-path: inset(100% 0 0 0);
  animation: tz-gema-sube 0.9s cubic-bezier(0.65, 0, 0.35, 1) forwards;
}
.tz-gema-borde {
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  bottom: 0;
  background: #fff;
  box-shadow: 0 0 12px 3px var(--gc), 0 0 40px 10px rgba(var(--gc-rgb), 0.6);
  animation: tz-gema-borde 0.9s cubic-bezier(0.65, 0, 0.35, 1) forwards;
}
.tz-gema-fase-gema .tz-gema-relleno {
  clip-path: inset(0 0 0 0);
  animation: tz-gema-relleno-se-abre 0.7s ease-out forwards;
}
.tz-gema-fase-gema .tz-gema-borde { display: none; }
.tz-gema-destello {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle, #fff, rgba(var(--gc-rgb), 0.8) 40%, transparent 75%);
  opacity: 0;
  pointer-events: none;
}
.tz-gema-fase-gema .tz-gema-destello { animation: tz-gema-destello 0.55s ease-out; }
.tz-gema-centro {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 24px;
  text-align: center;
}
.tz-gema-rayos {
  position: absolute;
  top: 120px;
  left: 50%;
  width: 520px;
  height: 520px;
  margin: -260px 0 0 -260px;
  background: repeating-conic-gradient(from 0deg, rgba(var(--gc-rgb), 0.24) 0 7deg, transparent 7deg 22.5deg);
  -webkit-mask-image: radial-gradient(circle, #000 18%, transparent 62%);
  mask-image: radial-gradient(circle, #000 18%, transparent 62%);
  animation: tz-gema-rayos 14s linear infinite, tz-gema-aparece 0.6s ease-out both;
  pointer-events: none;
}
.tz-gema-pieza {
  height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: tz-gema-pop 0.85s cubic-bezier(0.2, 1.6, 0.4, 1) both;
}
.tz-gema-cantidad {
  margin-top: 8px;
  font-size: 64px;
  font-weight: 900;
  line-height: 1;
  background: linear-gradient(180deg, #fff 10%, var(--gc) 60%, var(--gc-medio));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 10px rgba(var(--gc-rgb), 0.85)) drop-shadow(0 0 28px rgba(var(--gc-rgb), 0.5));
  animation: tz-gema-pop 0.7s 0.25s cubic-bezier(0.2, 1.7, 0.4, 1) both;
}
.tz-gema-titulo {
  margin-top: 14px;
  color: #fff;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-shadow: 0 0 12px rgba(var(--gc-rgb), 0.9);
  animation: tz-gema-sube-texto 0.5s 0.45s ease-out both;
}
.tz-gema-uso {
  margin-top: 8px;
  max-width: 320px;
  color: rgba(255, 255, 255, 0.78);
  font-family: 'Rajdhani', sans-serif;
  font-size: 16px;
  font-weight: 600;
  animation: tz-gema-sube-texto 0.5s 0.6s ease-out both;
}
.tz-gema-toca {
  margin-top: 22px;
  color: rgba(var(--gc-rgb), 0.8);
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  animation: tz-gema-sube-texto 0.5s 1.2s ease-out both, tz-gema-latido 1.6s 1.7s ease-in-out infinite;
}

/* ---- Gema 3D ---- */
.tz-g3d {
  --g3d-c: #39ffb0;
  --g3d-rgb: 57, 255, 176;
  --g3d-claro: #d6ffec;
  --g3d-medio: #19c860;
  --g3d-oscuro: #064d22;
  position: relative;
  display: inline-block;
  width: 160px;
  height: 160px;
  transform: scale(var(--tz-g3d-escala, 1));
  transform-origin: 0 0;
}
.tz-g3d-caja { position: relative; display: inline-block; flex-shrink: 0; }
.tz-g3d-celeste {
  --g3d-c: #2be8ff;
  --g3d-rgb: 43, 232, 255;
  --g3d-claro: #dcf9ff;
  --g3d-medio: #1a8cf5;
  --g3d-oscuro: #072a72;
}
.tz-g3d-halo {
  position: absolute;
  inset: -30px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(var(--g3d-rgb), 0.55), rgba(var(--g3d-rgb), 0.12) 45%, transparent 70%);
  animation: tz-g3d-halo 2.4s ease-in-out infinite;
}
.tz-g3d-escena {
  position: absolute;
  left: 50%;
  top: 38%;
  width: 0;
  height: 0;
  perspective: 700px;
}
.tz-g3d-cuerpo {
  position: absolute;
  left: 0;
  top: 0;
  transform-style: preserve-3d;
  animation: tz-g3d-gira 3.4s linear infinite;
}
.tz-g3d-cara {
  position: absolute;
  backface-visibility: visible;
}
.tz-g3d-corona {
  transform-origin: 50% 100%;
  background:
    linear-gradient(200deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0) 38%),
    linear-gradient(180deg, var(--g3d-claro), var(--g3d-c) 45%, var(--g3d-medio));
  opacity: 0.93;
}
.tz-g3d-mesa {
  clip-path: polygon(29.29% 0, 70.71% 0, 100% 29.29%, 100% 70.71%, 70.71% 100%, 29.29% 100%, 0 70.71%, 0 29.29%);
  background:
    radial-gradient(circle at 40% 35%, #fff, rgba(255, 255, 255, 0) 45%),
    conic-gradient(from 22.5deg, var(--g3d-claro), var(--g3d-c), var(--g3d-medio), var(--g3d-c), var(--g3d-claro), var(--g3d-c), var(--g3d-medio), var(--g3d-c), var(--g3d-claro));
  opacity: 0.95;
}
.tz-g3d-pabellon {
  transform-origin: 50% 0;
  clip-path: polygon(0 0, 100% 0, 50% 100%);
  background:
    linear-gradient(170deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0) 30%),
    linear-gradient(180deg, var(--g3d-c), var(--g3d-medio) 45%, var(--g3d-oscuro));
  opacity: 0.9;
}
.tz-g3d-chispa {
  position: absolute;
  width: 18px;
  height: 18px;
  background: #fff;
  clip-path: polygon(50% 0, 60% 40%, 100% 50%, 60% 60%, 50% 100%, 40% 60%, 0 50%, 40% 40%);
  filter: drop-shadow(0 0 6px #fff) drop-shadow(0 0 10px var(--g3d-c));
  opacity: 0;
}
.tz-g3d-chispa-1 { top: 6px; right: 18px; animation: tz-g3d-chispa 2.2s 0.4s ease-in-out infinite; }
.tz-g3d-chispa-2 { bottom: 26px; left: 14px; width: 12px; height: 12px; animation: tz-g3d-chispa 2.2s 1.4s ease-in-out infinite; }

@keyframes tz-gema-entra { from { opacity: 0; } to { opacity: 1; } }
@keyframes tz-gema-sale { to { opacity: 0; transform: scale(1.04); } }
@keyframes tz-gema-sube { to { clip-path: inset(0 0 0 0); } }
@keyframes tz-gema-borde { to { bottom: 100%; } }
@keyframes tz-gema-relleno-se-abre {
  from { opacity: 1; clip-path: circle(150% at 50% 45%); }
  to { opacity: 0.2; clip-path: circle(0% at 50% 45%); }
}
@keyframes tz-gema-destello { 0% { opacity: 0; } 25% { opacity: 0.85; } 100% { opacity: 0; } }
@keyframes tz-gema-pop {
  from { opacity: 0; transform: scale(0.2) rotate(-25deg); }
  to { opacity: 1; transform: scale(1) rotate(0deg); }
}
@keyframes tz-gema-sube-texto { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes tz-gema-latido { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
@keyframes tz-gema-rayos { to { transform: rotate(360deg); } }
@keyframes tz-gema-aparece { from { opacity: 0; } to { opacity: 1; } }
@keyframes tz-g3d-gira {
  from { transform: rotateX(-16deg) rotateY(0deg); }
  to { transform: rotateX(-16deg) rotateY(360deg); }
}
@keyframes tz-g3d-halo { 0%, 100% { opacity: 0.7; transform: scale(0.92); } 50% { opacity: 1; transform: scale(1.08); } }
@keyframes tz-g3d-chispa {
  0%, 55%, 100% { opacity: 0; transform: scale(0.3) rotate(-30deg); }
  70% { opacity: 1; transform: scale(1) rotate(0deg); }
  85% { opacity: 0; transform: scale(0.5) rotate(30deg); }
}
@media (prefers-reduced-motion: reduce) {
  .tz-gema-relleno, .tz-gema-borde { display: none; }
  .tz-g3d-cuerpo { animation-duration: 12s; }
  .tz-gema-rayos { animation: none; }
}
`;
