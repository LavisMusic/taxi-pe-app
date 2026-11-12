import { useState } from "react";
import { Radio } from "lucide-react";
import { usePasajerosConectados } from "../../hooks/usePasajerosConectados";
import { useConductoresConectados } from "../../hooks/useConductoresConectados";
import UsuariosConectadosModal from "./UsuariosConectadosModal";

/* "Conectados ahora" (panel del Admin, al lado del Usuario estrella):
   pasajeros y conductores con la app abierta en este momento (Presencia de
   Realtime, en vivo). Al tocarlo se abre el visor con las dos listas. */
export default function ConectadosAhoraChip({ usuarios }) {
  const pasajeros = usePasajerosConectados();
  const { conectados: conductores } = useConductoresConectados();
  const [abierto, setAbierto] = useState(false);
  const total = pasajeros.length + conductores.length;

  return (
    <>
      <style>{ESTILO}</style>
      <button type="button" className="tz-stat-chip tz-conectados-chip" onClick={() => setAbierto(true)}>
        <span className="tz-stat-label">
          <span className={`tz-conectados-punto ${total > 0 ? "is-vivo" : ""}`} aria-hidden="true" />
          Conectados ahora
        </span>
        <span key={total} className="tz-stat-value tz-conectados-num">{total}</span>
        <span className="tz-stat-sub">
          {pasajeros.length} pasajero{pasajeros.length === 1 ? "" : "s"} · {conductores.length} conductor{conductores.length === 1 ? "" : "es"}
        </span>
        <span className="tz-conectados-ver">
          <Radio size={12} /> Ver quiénes
        </span>
      </button>
      {abierto && <UsuariosConectadosModal usuarios={usuarios || []} onClose={() => setAbierto(false)} />}
    </>
  );
}

const ESTILO = `
.tz-conectados-chip { cursor: pointer; text-align: left; font: inherit; color: inherit; justify-content: center;
  border-color: rgba(57,255,176,0.35); background: linear-gradient(180deg, rgba(57,255,176,0.09), var(--panel));
  transition: transform .35s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease, border-color .3s ease; }
.tz-conectados-chip:hover { transform: translateY(-2px); border-color: rgba(57,255,176,0.6); box-shadow: 0 0 20px rgba(57,255,176,0.22); }
.tz-conectados-chip:active { transform: scale(.97); }
.tz-conectados-num { color: var(--green); text-shadow: 0 0 12px rgba(57,255,176,0.45); animation: tz-conectados-pop .5s cubic-bezier(.34,1.56,.64,1); }
.tz-conectados-punto { width: 8px; height: 8px; border-radius: 50%; background: var(--text-dim); flex: none; }
.tz-conectados-punto.is-vivo { background: var(--green); box-shadow: 0 0 8px var(--green); animation: tz-conectados-late 1.6s ease-in-out infinite; }
.tz-conectados-ver { display: inline-flex; align-items: center; gap: 4px; margin-top: 2px; font-size: 10.5px; font-weight: 700; color: var(--green); opacity: .85; }
@keyframes tz-conectados-late { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: .55; } }
@keyframes tz-conectados-pop { from { transform: scale(.7); opacity: .3; } to { transform: scale(1); opacity: 1; } }
`;
