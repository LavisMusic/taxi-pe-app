import { useState } from "react";
import { X, Target, Loader2, Save } from "lucide-react";
import { formatSoles } from "../../utils/format";

// "Meta del día": el conductor pone cuánto quiere ganar hoy y ve su avance
// (viajes + envíos de hoy, de taxi_estadisticas_conductor). La meta queda
// en su cuenta (conductores.meta_diaria) y vale para todos los días.
export function gananciaHoy(estadisticas) {
  const hoy = estadisticas?.hoy;
  if (!hoy) return null;
  return Number(hoy.ganado_viajes || 0) + Number(hoy.ganado_envios || 0);
}

export default function MetaDiaModal({ conductor, estadisticas, guardar, onClose }) {
  const [monto, setMonto] = useState(conductor.meta_diaria ? String(conductor.meta_diaria) : "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const meta = Number(conductor.meta_diaria) || 0;
  const ganado = gananciaHoy(estadisticas);
  const pct = meta > 0 && ganado != null ? Math.min(1, ganado / meta) : 0;
  const cumplida = meta > 0 && ganado != null && ganado >= meta;

  const onGuardar = async () => {
    const n = Number(String(monto).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return setError("Escribe un monto mayor a 0.");
    if (n > 100000) return setError("Ese monto es demasiado alto.");
    setError("");
    setGuardando(true);
    const { error: err } = await guardar(Math.round(n * 100) / 100);
    setGuardando(false);
    if (err) setError("No se pudo guardar tu meta. Intenta de nuevo.");
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Target size={17} /> Meta del día
          </h2>

          {meta > 0 && (
            <div className="tz-meta-progreso">
              <div className="tz-meta-progreso-cifras">
                <strong className={cumplida ? "tz-green" : "tz-cyan"}>{ganado == null ? "—" : formatSoles(ganado)}</strong>
                <span>de {formatSoles(meta)}</span>
              </div>
              <div className="tz-meta-track">
                <div className={`tz-meta-fill ${cumplida ? "is-cumplida" : ""}`} style={{ width: `${pct * 100}%` }} />
              </div>
              <p className="tz-camera-note" style={{ textAlign: "center", margin: "6px 0 0" }}>
                {cumplida
                  ? "¡Meta cumplida! 🎉"
                  : ganado == null
                    ? "Calculando tu avance…"
                    : `Te faltan ${formatSoles(meta - ganado)} · viajes + envíos de hoy`}
              </p>
            </div>
          )}

          <label className="tz-field-label" style={{ marginTop: 14 }} htmlFor="meta-dia-monto">
            {meta > 0 ? "Cambiar mi meta (S/)" : "¿Cuánto quieres ganar hoy? (S/)"}
          </label>
          <input
            id="meta-dia-monto"
            className="tz-text-input"
            inputMode="decimal"
            placeholder="Ej. 80"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
          />
          <div className="tz-recarga-vuelto-rapidos">
            {[50, 80, 100, 150, 200].map((v) => (
              <button key={v} type="button" className="tz-gasto-tipo-btn" onClick={() => setMonto(String(v))}>
                S/ {v}
              </button>
            ))}
          </div>
          {error && <p className="tz-error">{error}</p>}
          <button
            type="button"
            className="tz-scan-btn tz-payment-save"
            style={{ width: "100%", marginTop: 14 }}
            onClick={onGuardar}
            disabled={guardando}
          >
            {guardando ? <Loader2 size={15} className="tz-spin" /> : <Save size={15} />} Guardar meta
          </button>
        </div>
      </div>
    </div>
  );
}
