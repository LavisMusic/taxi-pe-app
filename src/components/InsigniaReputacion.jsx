import { BadgeCheck, Sparkles } from "lucide-react";
import { Estrellas } from "./Estrellas";

/* Insignia de reputación — MISMO archivo en Taxi-PE y Caja
   (src/components/InsigniaReputacion.jsx): mantener iguales.
   rep: { total, promedio, etiqueta } (de *_reputacion) y etiquetas: las que
   puso el admin a mano [{ etiqueta, color }]. Con menos de 3
   calificaciones se muestra "Nuevo" sin estrellas. */

export const ETIQUETAS_AUTO = {
  nuevo: { label: "Nuevo", color: "#2be8ff" },
  confiable: { label: "Confiable", color: "#39ffb0" },
  destacado: { label: "Destacado", color: "#d7ff3b" },
  top: { label: "Top", color: "#ff2f9e" },
  por_mejorar: { label: "Por mejorar", color: "#ff9500" },
  en_observacion: { label: "En observación", color: "#ff5470" },
};
export const COLORES_ETIQUETA = {
  cyan: "#2be8ff",
  green: "#39ffb0",
  yellow: "#d7ff3b",
  pink: "#ff2f9e",
  orange: "#ff9500",
};

function Chip({ color, children, brilla }) {
  return (
    <span className={`tz-rep-chip ${brilla ? "is-brilla" : ""}`} style={{ "--c": color }}>
      {children}
    </span>
  );
}

// mostrar: "todo" (por defecto), "estrellas" (solo estrellas, nada si es
// nuevo) o "etiquetas" (solo la automática y las puestas a mano).
export default function InsigniaReputacion({ rep, etiquetas = [], tamano = "normal", className = "", mostrar = "todo" }) {
  const total = Number(rep?.total || 0);
  const promedio = Number(rep?.promedio || 0);
  const clave = total < 3 ? "nuevo" : rep?.etiqueta || "confiable";
  const auto = ETIQUETAS_AUTO[clave] || ETIQUETAS_AUTO.confiable;
  const chico = tamano === "chico";
  if (mostrar === "estrellas" && total < 3) return null;
  const conEtiquetas = mostrar !== "estrellas";
  return (
    <span className={`tz-rep ${chico ? "is-chico" : ""} ${className}`}>
      <style>{ESTILO}</style>
      {total >= 3 && mostrar !== "etiquetas" && (
        <span className="tz-rep-estrellas" title={`${promedio.toFixed(1)} de 5 · ${total} calificaciones`}>
          <Estrellas valor={promedio} size={chico ? 11 : 13} />
          <b>{promedio.toFixed(1)}</b>
          {!chico && <small>({total})</small>}
        </span>
      )}
      {conEtiquetas && (
        <Chip color={auto.color} brilla={clave === "top"}>
          {clave === "nuevo" && <Sparkles size={chico ? 10 : 11} />}
          {auto.label}
        </Chip>
      )}
      {conEtiquetas && etiquetas.map((e) => (
        <Chip key={e.etiqueta} color={COLORES_ETIQUETA[e.color] || COLORES_ETIQUETA.cyan}>
          <BadgeCheck size={chico ? 10 : 11} />
          {e.etiqueta}
        </Chip>
      ))}
    </span>
  );
}

const ESTILO = `
.tz-nombre-rep { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }
.tz-nombre-rep > h3, .tz-nombre-rep > strong { margin: 0; }
.tz-card-reputacion-btn { padding: 0; border: 0; background: transparent; cursor: pointer; border-radius: 999px;
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), filter .3s ease; }
.tz-card-reputacion-btn:hover { transform: scale(1.06); filter: brightness(1.15); }
.tz-rep { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 5px; vertical-align: middle; }
.tz-rep-estrellas { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-dim); }
.tz-rep-estrellas b { color: #ffd84a; font-weight: 900; text-shadow: 0 0 8px rgba(255,216,74,0.5); }
.tz-rep-estrellas small { font-size: 11px; }
.tz-rep-chip { position: relative; overflow: hidden; display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px;
  border-radius: 999px; font-size: 11px; font-weight: 800; letter-spacing: .02em; white-space: nowrap; color: var(--c);
  background: color-mix(in srgb, var(--c) 13%, transparent); border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--c) 25%, transparent);
  animation: tz-rep-in .5s cubic-bezier(.34,1.56,.64,1) both; }
.tz-rep-chip.is-brilla::after { content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(105deg, transparent 35%, rgba(255,255,255,0.45) 50%, transparent 65%);
  animation: tz-rep-brillo 2.8s ease-in-out infinite; }
.tz-rep.is-chico { gap: 4px; }
.tz-rep.is-chico .tz-rep-chip { font-size: 10px; padding: 1px 6px; }
.tz-rep.is-chico .tz-rep-estrellas { font-size: 11px; }
@keyframes tz-rep-in { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: scale(1); } }
@keyframes tz-rep-brillo { 0%, 60% { transform: translateX(-120%); } 100% { transform: translateX(120%); } }
`;
