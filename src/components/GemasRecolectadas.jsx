import { useEffect, useRef, useState } from "react";
import IconoGema from "./IconoGema";

// Caja de gemas cobradas (fase 2 de gemas) — MISMO archivo en Taxi-PE y en
// Caja (src/components/GemasRecolectadas.jsx): mantener las dos copias
// iguales.
//   - Conductor (Taxi): gemas verdes que le pagaron los pasajeros.
//   - Negocio (Caja, admin): gemas celestes que usaron sus clientes.
// "x / tope" con su valor en soles y una barra neón. Al llegar al tope ya
// no recibe más hasta canjearlas en su membresía o plan (fase 3).
// `apartadas`: en viajes/pedidos en curso, ocupan lugar pero aún no son
// suyas.
const COLORES = {
  verde: { a: "#39ffb0", b: "#2be8ff", rgb: "57,255,176", nombre: "verdes" },
  celeste: { a: "#2be8ff", b: "#8fd8ff", rgb: "43,232,255", nombre: "celestes" },
};

// `clave`: dónde se recuerda (por cuenta, en este navegador) cuántas vio.
// Así la barra solo crece desde 0 la primera vez; después arranca donde
// la dejó y solo se mueve (con su destello "+N") si entraron gemas
// mientras no estaba.
function leerVisto(clave) {
  if (!clave) return null;
  try {
    const v = window.localStorage.getItem(clave);
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
}
function guardarVisto(clave, valor) {
  if (!clave) return;
  try {
    window.localStorage.setItem(clave, String(valor));
  } catch {
    // Sin almacenamiento: la barra vuelve a crecer desde 0 al entrar.
  }
}

export default function GemasRecolectadas({ color = "verde", recolectadas = 0, apartadas = 0, tope = 50, valor = 0.1, activo = true, clave = null }) {
  const c = COLORES[color] || COLORES.verde;
  const lleno = tope > 0 && recolectadas + apartadas >= tope;
  const pctDe = (n) => (tope > 0 ? Math.min(100, (Math.max(0, n) / tope) * 100) : 0);
  const pct = pctDe(recolectadas);
  const pctApartadas = tope > 0 ? Math.min(100 - pct, (apartadas / tope) * 100) : 0;
  const [visto] = useState(() => leerVisto(clave));
  // La barra crece desde lo último que se vio (desde 0 la primera vez).
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 120);
    return () => clearTimeout(t);
  }, []);
  // Destello cuando entra una gema: al instante por Realtime o, al entrar,
  // si llegaron mientras no estaba.
  const previo = useRef(visto != null && visto < recolectadas ? visto : recolectadas);
  const [sube, setSube] = useState(0);
  const [mas, setMas] = useState(1);
  useEffect(() => {
    if (!visible) return;
    if (recolectadas > previo.current) {
      setMas(recolectadas - previo.current);
      setSube((n) => n + 1);
    }
    previo.current = recolectadas;
    guardarVisto(clave, recolectadas);
  }, [recolectadas, visible, clave]);
  const [destello, setDestello] = useState(false);
  useEffect(() => {
    if (!sube) return undefined;
    setDestello(true);
    const t = setTimeout(() => setDestello(false), 1500);
    return () => clearTimeout(t);
  }, [sube]);

  return (
    <div
      ref={ref}
      className={`tz-gemrec ${lleno ? "is-lleno" : ""} ${destello ? "is-sube" : ""}`}
      style={{ "--gr-a": c.a, "--gr-b": c.b, "--gr-rgb": c.rgb }}
    >
      <style>{ESTILO}</style>
      <div className="tz-gemrec-cabeza">
        <span className="tz-gemrec-titulo">
          <IconoGema color={color} size={15} /> Gemas {c.nombre} cobradas
        </span>
        <span className="tz-gemrec-cuenta">
          <strong key={sube}>{recolectadas}</strong>/{tope}
          {destello && <span className="tz-gemrec-mas">+{mas}</span>}
        </span>
      </div>
      <div className="tz-gemrec-barra">
        <span className="tz-gemrec-relleno" style={{ width: `${visible ? pct : pctDe(visto ?? 0)}%` }} />
        {pctApartadas > 0 && (
          <span
            className="tz-gemrec-apartadas"
            style={{ left: `${pct}%`, width: visible || visto != null ? `${pctApartadas}%` : 0 }}
          />
        )}
      </div>
      <p className="tz-gemrec-pie">
        S/ {(recolectadas * valor).toFixed(2)} de S/ {(tope * valor).toFixed(2)}
        {apartadas > 0 ? ` · ${apartadas} en curso` : ""}
        {!activo ? " · gemas en pausa" : lleno ? " · ¡Tope completo! Ya no recibes más hasta canjearlas" : ""}
      </p>
    </div>
  );
}

const ESTILO = `
.tz-gemrec {
  position: relative; margin: 10px 0; padding: 12px 14px; border-radius: 16px; overflow: hidden;
  border: 1px solid rgba(var(--gr-rgb), 0.35);
  background: linear-gradient(135deg, rgba(var(--gr-rgb), 0.1), rgba(var(--gr-rgb), 0.03));
  box-shadow: 0 0 18px rgba(var(--gr-rgb), 0.12);
  animation: tz-gemrec-in 0.55s cubic-bezier(.34,1.56,.64,1) both;
}
@keyframes tz-gemrec-in { from { opacity: 0; transform: translateY(8px) scale(0.97); filter: blur(3px); } to { opacity: 1; transform: none; filter: none; } }
.tz-gemrec.is-lleno { border-color: var(--gr-a); box-shadow: 0 0 22px rgba(var(--gr-rgb), 0.4); }
.tz-gemrec-cabeza { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.tz-gemrec-titulo { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--gr-a); }
.tz-gemrec-ico { font-size: 16px; filter: drop-shadow(0 0 6px var(--gr-a)); }
.tz-gemrec-cuenta { font-size: 13px; font-weight: 700; color: var(--text-dim, #9aa); }
.tz-gemrec-cuenta strong { font-size: 20px; color: var(--gr-a); text-shadow: 0 0 10px rgba(var(--gr-rgb), 0.6); }
.tz-gemrec-barra { position: relative; height: 10px; margin-top: 8px; border-radius: 999px; overflow: hidden; background: rgba(var(--gr-rgb), 0.12); }
.tz-gemrec-relleno, .tz-gemrec-apartadas {
  position: absolute; top: 0; bottom: 0; left: 0; border-radius: 999px;
  transition: width 1.1s cubic-bezier(.2,.9,.3,1);
}
.tz-gemrec-relleno {
  background: linear-gradient(90deg, var(--gr-a), var(--gr-b), var(--gr-a));
  background-size: 200% 100%;
  box-shadow: 0 0 10px rgba(var(--gr-rgb), 0.7);
  animation: tz-gemrec-flujo 2.4s linear infinite;
}
.tz-gemrec-apartadas {
  background: repeating-linear-gradient(45deg, rgba(var(--gr-rgb), 0.45) 0 4px, rgba(var(--gr-rgb), 0.15) 4px 8px);
  animation: tz-gemrec-apartadas 1.6s ease-in-out infinite;
}
@keyframes tz-gemrec-flujo { from { background-position: 0% 0; } to { background-position: 200% 0; } }
@keyframes tz-gemrec-apartadas { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
.tz-gemrec-pie { margin: 6px 0 0; font-size: 11.5px; color: var(--text-dim, #9aa); }
.tz-gemrec-cuenta { position: relative; }
.tz-gemrec.is-sube { animation: tz-gemrec-destello 1.5s ease-out both; }
@keyframes tz-gemrec-destello {
  0% { box-shadow: 0 0 0 rgba(var(--gr-rgb), 0); border-color: rgba(var(--gr-rgb), 0.35); }
  18% { box-shadow: 0 0 34px rgba(var(--gr-rgb), 0.85), inset 0 0 22px rgba(var(--gr-rgb), 0.35); border-color: var(--gr-a); }
  100% { box-shadow: 0 0 18px rgba(var(--gr-rgb), 0.12); border-color: rgba(var(--gr-rgb), 0.35); }
}
.tz-gemrec.is-sube .tz-gemrec-cuenta strong { display: inline-block; animation: tz-gemrec-salta 0.7s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes tz-gemrec-salta { 0% { transform: scale(1); } 40% { transform: scale(1.55); filter: drop-shadow(0 0 10px var(--gr-a)); } 100% { transform: scale(1); } }
.tz-gemrec-mas {
  position: absolute; right: 0; top: -14px; font-size: 13px; font-weight: 900; color: var(--gr-a);
  text-shadow: 0 0 10px rgba(var(--gr-rgb), 0.9); animation: tz-gemrec-mas 1.4s ease-out both; pointer-events: none;
}
@keyframes tz-gemrec-mas { 0% { opacity: 0; transform: translateY(8px) scale(0.6); } 25% { opacity: 1; transform: translateY(0) scale(1.15); } 100% { opacity: 0; transform: translateY(-14px) scale(1); } }
.tz-gemrec.is-sube .tz-gemrec-relleno { animation: tz-gemrec-flujo 0.6s linear infinite; }
.tz-gemrec.is-lleno .tz-gemrec-pie { color: var(--gr-a); font-weight: 700; }
`;
