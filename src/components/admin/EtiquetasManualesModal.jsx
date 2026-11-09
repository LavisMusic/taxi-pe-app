import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Plus, Loader2, BadgeCheck, Trash2 } from "lucide-react";
import { supabase } from "../../supabaseClient";
import { useReputacion, avisarCambioReputacion } from "../../lib/reputacion";
import InsigniaReputacion, { COLORES_ETIQUETA } from "../InsigniaReputacion";

/* Etiquetas que el admin pone a mano (fase 1a de Reportes y reputación):
   "Verificado", "Puntual"… además de la automática por estrellas. */
const SUGERIDAS = ["Verificado", "Puntual", "Amable", "Vehículo impecable"];

export default function EtiquetasManualesModal({ tipo, id, nombre, onClose }) {
  const { rep, etiquetas } = useReputacion(tipo, id);
  const [texto, setTexto] = useState("");
  const [color, setColor] = useState("cyan");
  const [ocupado, setOcupado] = useState(null);
  const [error, setError] = useState("");

  const llamar = async (etiqueta, quitar) => {
    setOcupado(quitar ? etiqueta : "nueva");
    setError("");
    const { error: e } = await supabase.rpc("taxi_poner_etiqueta", {
      p_tipo: tipo, p_id: id, p_etiqueta: etiqueta, p_color: color, p_quitar: quitar,
    });
    setOcupado(null);
    if (e) return setError(e.message || "No se pudo guardar.");
    if (!quitar) setTexto("");
    avisarCambioReputacion();
  };

  return createPortal(
    <div className="tz-etq-fondo" onClick={onClose}>
      <style>{ESTILO}</style>
      <div className="tz-etq" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button type="button" className="tz-etq-cerrar" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <h3><BadgeCheck size={18} /> Reputación de {nombre}</h3>
        <InsigniaReputacion rep={rep} etiquetas={etiquetas} />
        <p className="tz-etq-ayuda">
          {Number(rep?.total || 0)} calificaciones. La etiqueta automática sale de las estrellas; acá agregas las tuyas.
        </p>
        <ul className="tz-etq-lista">
          {etiquetas.map((e) => (
            <li key={e.etiqueta} style={{ "--c": COLORES_ETIQUETA[e.color] || COLORES_ETIQUETA.cyan }}>
              <BadgeCheck size={14} /> {e.etiqueta}
              <button type="button" onClick={() => llamar(e.etiqueta, true)} disabled={!!ocupado} aria-label={`Quitar ${e.etiqueta}`}>
                {ocupado === e.etiqueta ? <Loader2 size={14} className="tz-spin" /> : <Trash2 size={14} />}
              </button>
            </li>
          ))}
        </ul>
        <div className="tz-etq-sugeridas">
          {SUGERIDAS.filter((s) => !etiquetas.some((e) => e.etiqueta.toLowerCase() === s.toLowerCase())).map((s) => (
            <button key={s} type="button" onClick={() => setTexto(s)}>{s}</button>
          ))}
        </div>
        <div className="tz-etq-colores">
          {Object.entries(COLORES_ETIQUETA).map(([k, c]) => (
            <button key={k} type="button" aria-label={k} className={color === k ? "is-activo" : ""} style={{ "--c": c }} onClick={() => setColor(k)} />
          ))}
        </div>
        <div className="tz-etq-nueva">
          <input className="tz-text-input" value={texto} maxLength={24} placeholder="Nueva etiqueta" onChange={(e) => setTexto(e.target.value)} />
          <button type="button" className="tz-pw-submit" onClick={() => llamar(texto, false)} disabled={!!ocupado || texto.trim().length < 2}>
            {ocupado === "nueva" ? <Loader2 size={16} className="tz-spin" /> : <Plus size={16} />} Agregar
          </button>
        </div>
        {error && <p className="tz-error">{error}</p>}
      </div>
    </div>,
    document.body
  );
}

const ESTILO = `
.tz-etq-fondo { position: fixed; inset: 0; z-index: 9000; display: grid; place-items: center; padding: 16px;
  background: rgba(5,3,12,0.7); backdrop-filter: blur(6px); animation: tz-etq-fade .3s ease both; }
.tz-etq { position: relative; width: min(420px, 100%); display: flex; flex-direction: column; gap: 10px; padding: 20px; border-radius: 22px;
  background: var(--panel-solid, #140d28); border: 1px solid rgba(43,232,255,0.35); box-shadow: 0 0 34px rgba(43,232,255,0.18);
  color: var(--text); animation: tz-etq-in .5s cubic-bezier(.34,1.56,.64,1) both; }
.tz-etq h3 { display: flex; align-items: center; gap: 8px; margin: 0; padding-right: 30px; font-size: 16px; color: var(--cyan); }
.tz-etq-cerrar { position: absolute; top: 12px; right: 12px; width: 30px; height: 30px; border-radius: 50%; border: 0; cursor: pointer;
  display: grid; place-items: center; color: var(--text-dim); background: rgba(255,255,255,0.06); transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
.tz-etq-cerrar:hover { transform: rotate(90deg); }
.tz-etq-ayuda { margin: 0; font-size: 12px; color: var(--text-dim); }
.tz-etq-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.tz-etq-lista li { display: flex; align-items: center; gap: 6px; padding: 7px 10px; border-radius: 12px; font-weight: 800; font-size: 13px;
  color: var(--c); border: 1px solid color-mix(in srgb, var(--c) 40%, transparent); background: color-mix(in srgb, var(--c) 10%, transparent);
  animation: tz-etq-in .4s cubic-bezier(.34,1.56,.64,1) both; }
.tz-etq-lista li button { margin-left: auto; border: 0; background: transparent; color: var(--text-dim); cursor: pointer; display: grid; place-items: center; }
.tz-etq-lista li button:hover { color: #ff5470; }
.tz-etq-sugeridas { display: flex; flex-wrap: wrap; gap: 6px; }
.tz-etq-sugeridas button { border: 1px dashed rgba(255,255,255,0.25); background: transparent; color: var(--text-dim); border-radius: 999px;
  padding: 4px 10px; font-size: 12px; cursor: pointer; transition: color .2s ease, border-color .2s ease, transform .3s cubic-bezier(.34,1.56,.64,1); }
.tz-etq-sugeridas button:hover { color: var(--text); border-color: var(--cyan); transform: translateY(-1px); }
.tz-etq-colores { display: flex; gap: 8px; }
.tz-etq-colores button { width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; background: var(--c);
  box-shadow: 0 0 8px var(--c); transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
.tz-etq-colores button.is-activo { border-color: #fff; transform: scale(1.2); }
.tz-etq-nueva { display: flex; gap: 8px; }
.tz-etq-nueva input { flex: 1; min-width: 0; }
.tz-etq-nueva button { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
@keyframes tz-etq-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes tz-etq-in { from { opacity: 0; transform: translateY(16px) scale(.95); } to { opacity: 1; transform: none; } }
`;
