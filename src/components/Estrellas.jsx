import { useId, useState } from "react";

/* Estrellas de reputación — MISMO archivo en Taxi-PE y Caja
   (src/components/Estrellas.jsx): mantener iguales.
   - <Estrellas valor={4.6} size={14} />: muestra, con la última estrella
     llena a medias según el decimal.
   - <EstrellasElegir valor onCambiar size />: para calificar; al tocar,
     las estrellas se encienden una por una con un rebote y un destello.
   Colores en literales (Taxi-PE no tiene las variables --*-rgb). */

export const RUTA_ESTRELLA = "M12 2.6l2.85 6.05 6.6.78-4.88 4.55 1.3 6.55L12 17.3l-5.87 3.23 1.3-6.55L2.55 9.43l6.6-.78z";
const ORO = "#ffd84a";

export function Estrellas({ valor = 0, size = 14, className = "" }) {
  const base = useId().replace(/:/g, "");
  return (
    <span className={`tz-estrellas ${className}`} aria-label={`${Number(valor).toFixed(1)} de 5 estrellas`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const relleno = Math.max(0, Math.min(1, valor - i));
        const id = `${base}-${i}`;
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <linearGradient id={id}>
                <stop offset={`${relleno * 100}%`} stopColor={ORO} />
                <stop offset={`${relleno * 100}%`} stopColor="rgba(255,255,255,0.14)" />
              </linearGradient>
            </defs>
            <path d={RUTA_ESTRELLA} fill={`url(#${id})`} stroke={relleno > 0 ? ORO : "rgba(255,255,255,0.25)"} strokeWidth="1" strokeLinejoin="round" />
          </svg>
        );
      })}
      <style>{`.tz-estrellas { display: inline-flex; gap: 1px; vertical-align: middle; }
.tz-estrellas svg { filter: drop-shadow(0 0 3px rgba(255,216,74,0.45)); }`}</style>
    </span>
  );
}

export function EstrellasElegir({ valor = 0, onCambiar, size = 40, disabled = false }) {
  const [sobre, setSobre] = useState(0);
  const mostrado = sobre || valor;
  return (
    <div className="tz-estrellas-elegir" onMouseLeave={() => setSobre(0)} role="radiogroup" aria-label="Calificación">
      {[1, 2, 3, 4, 5].map((n) => {
        const encendida = n <= mostrado;
        return (
          <button
            key={`${n}-${valor >= n ? valor : 0}`}
            type="button"
            role="radio"
            aria-checked={valor === n}
            aria-label={`${n} estrella${n > 1 ? "s" : ""}`}
            disabled={disabled}
            className={`tz-estrella-btn ${encendida ? "is-on" : ""} ${valor >= n ? "is-elegida" : ""}`}
            style={{ "--d": `${(n - 1) * 70}ms`, width: size, height: size }}
            onMouseEnter={() => setSobre(n)}
            onFocus={() => setSobre(n)}
            onBlur={() => setSobre(0)}
            onClick={() => onCambiar?.(n)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={RUTA_ESTRELLA} />
            </svg>
          </button>
        );
      })}
      <style>{ESTILO_ELEGIR}</style>
    </div>
  );
}

const ESTILO_ELEGIR = `
.tz-estrellas-elegir { display: inline-flex; gap: 6px; }
.tz-estrella-btn { position: relative; padding: 0; border: 0; background: transparent; cursor: pointer;
  transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
.tz-estrella-btn:hover:not(:disabled) { transform: scale(1.15) rotate(-6deg); }
.tz-estrella-btn:disabled { cursor: default; }
.tz-estrella-btn svg { width: 100%; height: 100%; overflow: visible; }
.tz-estrella-btn path { fill: rgba(255,255,255,0.08); stroke: rgba(255,255,255,0.32); stroke-width: 1.2; stroke-linejoin: round;
  transition: fill .3s ease, stroke .3s ease, filter .3s ease; }
.tz-estrella-btn.is-on path { fill: #ffd84a; stroke: #fff2a8; filter: drop-shadow(0 0 6px rgba(255,216,74,0.85)); }
.tz-estrella-btn.is-elegida { animation: tz-estrella-pop .55s var(--d) cubic-bezier(.34,1.56,.64,1) both; }
.tz-estrella-btn.is-elegida::after { content: ""; position: absolute; inset: -30%; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle, rgba(255,216,74,0.55), transparent 65%); opacity: 0;
  animation: tz-estrella-destello .7s var(--d) ease-out both; }
@keyframes tz-estrella-pop { 0% { transform: scale(.6) rotate(-25deg); } 60% { transform: scale(1.3) rotate(8deg); } 100% { transform: scale(1) rotate(0); } }
@keyframes tz-estrella-destello { 0% { opacity: 0; transform: scale(.3); } 40% { opacity: 1; } 100% { opacity: 0; transform: scale(1.5); } }
`;
