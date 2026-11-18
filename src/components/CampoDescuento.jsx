import { Sparkles } from "lucide-react";

// Descuento programado — MISMO archivo en Taxi-PE y Caja
// (src/components/CampoDescuento.jsx). Lo usan el formulario de planes
// (Caja) y el de membresías (Taxi-PE): % de descuento y, opcional, desde y
// hasta cuándo rige (vacíos = siempre). Debajo dice si está vigente,
// programado o ya terminó.
//   pct / desde / hasta: textos ("50", "2026-11-20T00:00").

// ISO → "YYYY-MM-DDTHH:mm" (hora local) para el campo de fecha.
export function aFechaLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
// "YYYY-MM-DDTHH:mm" (hora local) → ISO, o null si está vacío.
export const aIso = (local) => (local ? new Date(local).toISOString() : null);

// Error de validación o null.
export function validarDescuento(pct, desde, hasta) {
  const d = Number(String(pct || 0).replace(",", "."));
  if (!Number.isFinite(d) || d < 0 || d >= 100) return "El descuento va de 0 a 99 %.";
  if (desde && hasta && new Date(hasta) <= new Date(desde)) return "El fin del descuento debe ser después del inicio.";
  return null;
}

const fecha = (local) =>
  new Date(local).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function estado(pct, desde, hasta) {
  const d = Number(String(pct || 0).replace(",", "."));
  if (!d) return null;
  const ahora = Date.now();
  if (hasta && new Date(hasta).getTime() <= ahora) return { clase: "is-fin", texto: `Terminó el ${fecha(hasta)}` };
  if (desde && new Date(desde).getTime() > ahora) return { clase: "is-prog", texto: `Empieza el ${fecha(desde)}` };
  return { clase: "is-vigente", texto: hasta ? `Vigente hasta el ${fecha(hasta)}` : "Vigente siempre" };
}

export default function CampoDescuento({ pct, desde, hasta, onPct, onDesde, onHasta }) {
  const e = estado(pct, desde, hasta);
  return (
    <div className="tz-cdesc">
      <style>{ESTILO}</style>
      <span className="tz-cdesc-titulo">
        <Sparkles size={14} /> Descuento
      </span>
      <div className="tz-cdesc-fila">
        <label className="tz-cdesc-campo tz-cdesc-pct">
          <span>%</span>
          <input className="tz-text-input" inputMode="decimal" placeholder="0" value={pct} onChange={(ev) => onPct(ev.target.value)} />
        </label>
        <label className="tz-cdesc-campo">
          <span>Desde (opcional)</span>
          <input type="datetime-local" className="tz-text-input" value={desde} onChange={(ev) => onDesde(ev.target.value)} />
        </label>
        <label className="tz-cdesc-campo">
          <span>Hasta (opcional)</span>
          <input type="datetime-local" className="tz-text-input" value={hasta} onChange={(ev) => onHasta(ev.target.value)} />
        </label>
      </div>
      {e && <span className={`tz-cdesc-estado ${e.clase}`}>{e.texto}</span>}
    </div>
  );
}

const ESTILO = `
.tz-cdesc {
  display: flex; flex-direction: column; gap: 8px; margin: 10px 0 4px; padding: 12px; border-radius: 14px;
  border: 1px solid rgba(255,47,158,0.35); background: linear-gradient(160deg, rgba(255,47,158,0.08), rgba(215,255,59,0.03));
}
.tz-cdesc-titulo { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: #ff7ac4; }
.tz-cdesc-fila { display: grid; grid-template-columns: 90px 1fr 1fr; gap: 8px; }
@media (max-width: 520px) { .tz-cdesc-fila { grid-template-columns: 1fr; } }
.tz-cdesc-campo { display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--text-dim, #a9a3c9); min-width: 0; }
.tz-cdesc-campo .tz-text-input { margin: 0; width: 100%; box-sizing: border-box; }
.tz-cdesc-pct .tz-text-input { text-align: center; font-weight: 800; }
.tz-cdesc-estado {
  align-self: flex-start; padding: 3px 10px; border-radius: 999px; font-size: 11.5px; font-weight: 800;
  animation: tz-cdesc-entra 0.45s cubic-bezier(.34,1.56,.64,1) both;
}
.tz-cdesc-estado.is-vigente { color: #39ffb0; border: 1px solid rgba(57,255,176,0.5); background: rgba(57,255,176,0.08); box-shadow: 0 0 12px rgba(57,255,176,0.25); }
.tz-cdesc-estado.is-prog { color: #2be8ff; border: 1px solid rgba(43,232,255,0.5); background: rgba(43,232,255,0.08); }
.tz-cdesc-estado.is-fin { color: var(--text-dim, #a9a3c9); border: 1px solid rgba(255,255,255,0.15); }
@keyframes tz-cdesc-entra { from { opacity: 0; transform: translateY(4px) scale(0.9); } to { opacity: 1; transform: none; } }
`;
