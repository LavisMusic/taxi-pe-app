import { useState } from "react";
import { FileText, Loader2, LogOut, Check } from "lucide-react";
import TerminosTexto from "./TerminosTexto";

// Ventana que bloquea la app hasta aceptar la versión vigente de los
// Términos y Condiciones (a quien ya tenía cuenta, o si cambian). La
// muestra TaxiAuthContext; `onAceptar` devuelve true si se guardó.
export default function TerminosAceptarModal({ onAceptar, onSalir }) {
  const [leido, setLeido] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const aceptar = async () => {
    setError("");
    setGuardando(true);
    const ok = await onAceptar();
    setGuardando(false);
    if (!ok) setError("No se pudo guardar tu aceptación. Revisa tu conexión o vuelve a iniciar sesión.");
  };

  return (
    <div className="tz-modal-backdrop" style={{ zIndex: 999998 }}>
      <div className="tz-modal tz-terminos-modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileText size={18} /> Términos y condiciones
        </h2>
        <p className="tz-stock-editor-sub">
          Para seguir usando la app, lee y acepta los Términos y Condiciones, que incluyen la autorización para
          recibir notificaciones.
        </p>
        <div className="tz-terminos-scroll">
          <TerminosTexto />
        </div>
        <label className="tz-checkbox-row" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={leido} onChange={(e) => setLeido(e.target.checked)} />
          He leído y acepto los Términos y Condiciones
        </label>
        {error && <p className="tz-error">{error}</p>}
        <button type="button" className="tz-scan-btn tz-payment-save" disabled={!leido || guardando} onClick={aceptar}>
          {guardando ? <Loader2 size={16} className="tz-spin" /> : <Check size={16} />}
          {guardando ? "Guardando…" : "Aceptar y continuar"}
        </button>
        <button
          type="button"
          className="tz-metodo-pago-change"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", margin: "10px 0 0" }}
          onClick={onSalir}
        >
          <LogOut size={13} /> Salir
        </button>
      </div>
    </div>
  );
}
