import { useEffect, useState } from "react";
import { Pencil, Check, Loader2, X } from "lucide-react";

// Medidor de cuentas verificadas (fase 5a) — MISMO archivo en Taxi-PE y
// Caja (src/components/MedidorCuentas.jsx): mantener iguales.
// Anillo neón con tres franjas: verificadas (aprobadas), en revisión y
// temporales/pendientes; en el centro verificadas / meta. Al alcanzar la
// meta el anillo se completa con un destello. La meta se edita con el
// lápiz (`onGuardarMeta`, opcional).
const R = 46;
const C = 2 * Math.PI * R;

export default function MedidorCuentas({
  titulo,
  verificadas = 0,
  enRevision = 0,
  temporales = 0,
  meta = 100,
  nuevasSemana = 0,
  porVencer = 0,
  etiquetas = { verificadas: "Verificadas", enRevision: "En revisión", temporales: "Temporales" },
  onGuardarMeta,
}) {
  const [dibujado, setDibujado] = useState(false);
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(String(meta));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDibujado(true), 120);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => setValor(String(meta)), [meta]);

  const base = Math.max(meta, verificadas + enRevision + temporales, 1);
  const largo = (n) => (dibujado ? (Math.max(n, 0) / base) * C : 0);
  const lV = largo(verificadas);
  const lR = largo(enRevision);
  const lT = largo(temporales);
  const logrado = verificadas >= meta && meta > 0;
  const pct = meta > 0 ? Math.min(100, Math.round((verificadas / meta) * 100)) : 0;

  const guardar = async () => {
    const n = Number(valor);
    if (!Number.isInteger(n) || n < 1) return setError("La meta debe ser un número entero mayor que 0.");
    setGuardando(true);
    setError("");
    const r = await onGuardarMeta(n);
    setGuardando(false);
    if (r?.error) return setError(r.error.message || "No se pudo guardar.");
    setEditando(false);
  };

  return (
    <div className={`tz-medidor ${logrado ? "is-logrado" : ""}`}>
      <style>{ESTILO}</style>
      <span className="tz-medidor-titulo">{titulo}</span>
      <div className="tz-medidor-anillo">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="tz-medidor-fondo" cx="60" cy="60" r={R} />
          {/* Verificadas, luego en revisión, luego temporales, seguidas. */}
          <circle className="tz-medidor-arco is-v" cx="60" cy="60" r={R} strokeDasharray={`${lV} ${C}`} strokeDashoffset={0} />
          <circle className="tz-medidor-arco is-r" cx="60" cy="60" r={R} strokeDasharray={`${lR} ${C}`} strokeDashoffset={-lV} />
          <circle className="tz-medidor-arco is-t" cx="60" cy="60" r={R} strokeDasharray={`${lT} ${C}`} strokeDashoffset={-(lV + lR)} />
        </svg>
        <div className="tz-medidor-centro">
          <strong>
            {verificadas}
            <small>/{meta}</small>
          </strong>
          <span>{logrado ? "¡Meta!" : `${pct}%`}</span>
        </div>
      </div>
      <ul className="tz-medidor-leyenda">
        <li className="is-v">
          <i /> {etiquetas.verificadas} <b>{verificadas}</b>
        </li>
        {etiquetas.enRevision !== "—" && (
          <li className="is-r">
            <i /> {etiquetas.enRevision} <b>{enRevision}</b>
          </li>
        )}
        <li className="is-t">
          <i /> {etiquetas.temporales} <b>{temporales}</b>
        </li>
      </ul>
      {(nuevasSemana > 0 || porVencer > 0) && (
        <p className="tz-medidor-extra">
          {nuevasSemana > 0 && <span className="is-sube">+{nuevasSemana} esta semana</span>}
          {porVencer > 0 && <span className="is-vence">{porVencer} por vencer</span>}
        </p>
      )}
      {onGuardarMeta &&
        (editando ? (
          <div className="tz-medidor-meta-edit">
            <input
              className="tz-text-input"
              inputMode="numeric"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              aria-label={`Meta de ${titulo}`}
            />
            <button type="button" onClick={guardar} disabled={guardando} aria-label="Guardar meta">
              {guardando ? <Loader2 size={13} className="tz-spin" /> : <Check size={13} />}
            </button>
            <button type="button" onClick={() => setEditando(false)} aria-label="Cancelar">
              <X size={13} />
            </button>
          </div>
        ) : (
          <button type="button" className="tz-medidor-meta-btn" onClick={() => setEditando(true)}>
            <Pencil size={12} /> Meta: {meta}
          </button>
        ))}
      {error && <p className="tz-medidor-error">{error}</p>}
    </div>
  );
}

const ESTILO = `
.tz-medidor {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 14px 12px; border-radius: 18px; min-width: 0;
  border: 1px solid rgba(43,232,255,0.22); background: linear-gradient(160deg, rgba(43,232,255,0.07), rgba(57,255,176,0.03));
  animation: tz-medidor-in 0.55s cubic-bezier(.34,1.56,.64,1) both;
}
@keyframes tz-medidor-in { from { opacity: 0; transform: translateY(8px) scale(0.96); filter: blur(3px); } to { opacity: 1; transform: none; filter: none; } }
.tz-medidor.is-logrado { border-color: #39ffb0; animation: tz-medidor-in 0.55s cubic-bezier(.34,1.56,.64,1) both, tz-medidor-logro 2.4s ease-in-out 0.6s infinite; }
@keyframes tz-medidor-logro { 0%, 100% { box-shadow: 0 0 14px rgba(57,255,176,0.25); } 50% { box-shadow: 0 0 34px rgba(57,255,176,0.65); } }
.tz-medidor-titulo { font-size: 12px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #2be8ff; }
.tz-medidor-anillo { position: relative; width: 132px; height: 132px; }
.tz-medidor-anillo svg { width: 100%; height: 100%; transform: rotate(-90deg); overflow: visible; }
.tz-medidor-fondo { fill: none; stroke: rgba(255,255,255,0.07); stroke-width: 11; }
.tz-medidor-arco { fill: none; stroke-width: 11; stroke-linecap: butt; transition: stroke-dasharray 1.2s cubic-bezier(.2,.9,.3,1), stroke-dashoffset 1.2s cubic-bezier(.2,.9,.3,1); }
.tz-medidor-arco.is-v { stroke: #39ffb0; filter: drop-shadow(0 0 6px rgba(57,255,176,0.8)); }
.tz-medidor-arco.is-r { stroke: #ffd23d; filter: drop-shadow(0 0 4px rgba(255,210,61,0.6)); }
.tz-medidor-arco.is-t { stroke: rgba(43,232,255,0.45); }
.tz-medidor.is-logrado .tz-medidor-arco.is-v { animation: tz-medidor-pulso 1.6s ease-in-out infinite; }
@keyframes tz-medidor-pulso { 0%, 100% { stroke-width: 11; } 50% { stroke-width: 14; } }
.tz-medidor-centro { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.tz-medidor-centro strong { font-size: 26px; font-weight: 900; color: #39ffb0; text-shadow: 0 0 12px rgba(57,255,176,0.55); line-height: 1; }
.tz-medidor-centro strong small { font-size: 13px; color: rgba(255,255,255,0.55); font-weight: 700; margin-left: 1px; }
.tz-medidor-centro span { font-size: 11px; font-weight: 700; color: rgba(255,255,255,0.65); margin-top: 3px; }
.tz-medidor.is-logrado .tz-medidor-centro span { color: #39ffb0; }
.tz-medidor-leyenda { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; width: 100%; }
.tz-medidor-leyenda li { display: flex; align-items: center; gap: 6px; font-size: 12px; opacity: 0.85; }
.tz-medidor-leyenda li b { margin-left: auto; }
.tz-medidor-leyenda i { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.tz-medidor-leyenda .is-v i { background: #39ffb0; box-shadow: 0 0 6px #39ffb0; }
.tz-medidor-leyenda .is-r i { background: #ffd23d; }
.tz-medidor-leyenda .is-t i { background: rgba(43,232,255,0.55); }
.tz-medidor-extra { margin: 0; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; font-size: 11.5px; font-weight: 700; }
.tz-medidor-extra .is-sube { color: #39ffb0; }
.tz-medidor-extra .is-vence { color: #ff9d3d; }
.tz-medidor-meta-btn {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
  font-size: 11.5px; font-weight: 700; color: #2be8ff; background: rgba(43,232,255,0.08); border: 1px solid rgba(43,232,255,0.35);
}
.tz-medidor-meta-edit { display: flex; gap: 6px; align-items: center; width: 100%; }
.tz-medidor-meta-edit input { flex: 1; min-width: 0; padding: 6px 8px; }
.tz-medidor-meta-edit button {
  width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  color: #39ffb0; background: rgba(57,255,176,0.1); border: 1px solid rgba(57,255,176,0.4);
}
.tz-medidor-error { margin: 0; font-size: 11.5px; color: #ff5470; text-align: center; }
`;
