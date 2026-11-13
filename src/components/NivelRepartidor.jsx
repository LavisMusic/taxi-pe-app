import { ShieldCheck, TrendingUp, AlertTriangle } from "lucide-react";

/* Nivel de confianza del repartidor (fase C) — MISMO archivo en Taxi-PE y
   Caja (src/components/NivelRepartidor.jsx): mantener iguales.
   Por entregas completadas, con un límite por pedido (valor de la
   mercadería): Nuevo 0–9 (S/ 50), Confiable 10–29 (S/ 100), Destacado
   30–59 (S/ 200), Certificado 60+ (S/ 300). Un reclamo confirmado en 90
   días baja un nivel. Los datos salen de taxi__nivel_repartidor:
   { nivel, limite, entregas, reclamos, bajado, siguiente, faltan,
   limite_siguiente }. */

export const NIVELES = {
  nuevo: { label: "Nuevo", color: "#2be8ff", desde: 0 },
  confiable: { label: "Confiable", color: "#39ffb0", desde: 10 },
  destacado: { label: "Destacado", color: "#d7ff3b", desde: 30 },
  certificado: { label: "Certificado", color: "#ff2f9e", desde: 60 },
};

const soles = (n) => `S/ ${Number(n || 0).toFixed(0)}`;

// Etiqueta chica: "Confiable · hasta S/ 100".
export function ChipNivel({ nivel, limite, conLimite = true }) {
  const n = NIVELES[nivel] || NIVELES.nuevo;
  return (
    <span className="tz-nivrep-chip" style={{ "--c": n.color }}>
      <style>{ESTILO}</style>
      <ShieldCheck size={11} /> {n.label}
      {conLimite && limite != null && <small>hasta {soles(limite)}</small>}
    </span>
  );
}

// Tarjeta del panel del repartidor: su nivel, su límite y cuánto le falta.
export default function TarjetaNivel({ datos }) {
  if (!datos) return null;
  const n = NIVELES[datos.nivel] || NIVELES.nuevo;
  const sig = datos.siguiente ? NIVELES[datos.siguiente] : null;
  const desde = NIVELES[Object.keys(NIVELES)[Math.max(0, Object.keys(NIVELES).indexOf(datos.siguiente) - 1)]]?.desde ?? 0;
  const pct = sig ? Math.max(0, Math.min(100, ((datos.entregas - desde) / Math.max(1, sig.desde - desde)) * 100)) : 100;
  return (
    <div className="tz-nivrep" style={{ "--c": n.color }}>
      <style>{ESTILO}</style>
      <div className="tz-nivrep-cab">
        <span className="tz-nivrep-escudo"><ShieldCheck size={20} /></span>
        <span className="tz-nivrep-titulo">
          <small>Tu nivel de repartidor</small>
          <b>{n.label}</b>
        </span>
        <span className="tz-nivrep-limite">
          <small>Pedidos de hasta</small>
          <b>{soles(datos.limite)}</b>
        </span>
      </div>
      <div className="tz-nivrep-barra"><span style={{ width: `${pct}%` }} /></div>
      <p className="tz-nivrep-pie">
        {sig ? (
          <>
            <TrendingUp size={13} /> {datos.entregas} entregas · te faltan <b>{Math.max(0, datos.faltan)}</b> para{" "}
            <b style={{ color: sig.color }}>{sig.label}</b> (hasta {soles(datos.limite_siguiente)})
          </>
        ) : (
          <>
            <TrendingUp size={13} /> {datos.entregas} entregas · nivel máximo
          </>
        )}
      </p>
      {datos.bajado && (
        <p className="tz-nivrep-aviso">
          <AlertTriangle size={13} /> Bajaste un nivel por un reclamo confirmado (cuenta 90 días).
        </p>
      )}
    </div>
  );
}

const ESTILO = `
.tz-nivrep-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; white-space: nowrap;
  font-size: 10.5px; font-weight: 800; letter-spacing: .02em; color: var(--c);
  background: color-mix(in srgb, var(--c) 12%, transparent); border: 1px solid color-mix(in srgb, var(--c) 45%, transparent);
  box-shadow: 0 0 10px color-mix(in srgb, var(--c) 22%, transparent); animation: tz-nivrep-in .5s cubic-bezier(.34,1.56,.64,1) both; }
.tz-nivrep-chip small { font-size: 10px; font-weight: 700; opacity: .85; }
.tz-nivrep { margin: 10px 0 4px; padding: 12px 14px; border-radius: 16px; position: relative; overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
  background: linear-gradient(135deg, color-mix(in srgb, var(--c) 12%, transparent), color-mix(in srgb, var(--c) 3%, transparent));
  box-shadow: 0 0 22px color-mix(in srgb, var(--c) 18%, transparent); animation: tz-nivrep-in .6s cubic-bezier(.34,1.56,.64,1) both; }
.tz-nivrep-cab { display: flex; align-items: center; gap: 10px; }
.tz-nivrep-escudo { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; flex: none; color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, transparent); box-shadow: 0 0 14px color-mix(in srgb, var(--c) 40%, transparent);
  animation: tz-nivrep-late 2.6s ease-in-out infinite; }
.tz-nivrep-titulo { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.tz-nivrep-titulo small, .tz-nivrep-limite small { font-size: 10.5px; color: var(--text-dim); text-transform: uppercase; letter-spacing: .06em; }
.tz-nivrep-titulo b { font-size: 18px; color: var(--c); text-shadow: 0 0 12px color-mix(in srgb, var(--c) 50%, transparent); }
.tz-nivrep-limite { display: flex; flex-direction: column; align-items: flex-end; }
.tz-nivrep-limite b { font-size: 17px; color: var(--text); }
.tz-nivrep-barra { height: 7px; margin: 10px 0 6px; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,0.08); }
.tz-nivrep-barra span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--c), #fff);
  box-shadow: 0 0 10px var(--c); animation: tz-nivrep-llena 1.1s .2s cubic-bezier(.34,1.56,.64,1) both; transform-origin: left; }
.tz-nivrep-pie, .tz-nivrep-aviso { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin: 0; font-size: 12px; color: var(--text-dim); }
.tz-nivrep-pie b { color: var(--text); }
.tz-nivrep-aviso { margin-top: 6px; color: #ff9500; }
@keyframes tz-nivrep-in { from { opacity: 0; transform: translateY(6px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes tz-nivrep-llena { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes tz-nivrep-late { 0%, 100% { box-shadow: 0 0 10px color-mix(in srgb, var(--c) 30%, transparent); } 50% { box-shadow: 0 0 20px color-mix(in srgb, var(--c) 60%, transparent); } }
`;
