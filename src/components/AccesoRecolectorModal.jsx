import { useState } from "react";
import { Users, X } from "lucide-react";
import StaffLoginForm from "./StaffLoginForm";
import RegistroConductorTemporalForm from "./recolector/RegistroConductorTemporalForm";

// Modal dual del botón "Recolectores" del header de la Home — mismo
// patrón que AccesoConductorModal.jsx: toggle Ingresar/Registrarse,
// "Ingresar" comparte el StaffLoginForm (Teléfono+PIN, rutea sola por
// rol real de la cuenta); "Registrarse" es el registro exprés (nombre y
// teléfono) con la verificación del recolector a continuación.
// `pagina`: como pantalla propia de /recolector (sin la X para cerrar).
export default function AccesoRecolectorModal({ onClose, pagina = false }) {
  const [modo, setModo] = useState("ingresar");

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        {!pagina && (
          <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        )}
        <div className="tz-payment-modal">
          <h2>
            <Users size={17} /> Recolectores
          </h2>

          <div className="tz-gasto-tipo-buttons" style={{ marginBottom: 14 }}>
            <button
              type="button"
              className={`tz-gasto-tipo-btn ${modo === "ingresar" ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => setModo("ingresar")}
            >
              Ingresar
            </button>
            <button
              type="button"
              className={`tz-gasto-tipo-btn ${modo === "registrar" ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => setModo("registrar")}
            >
              Registrarse
            </button>
          </div>

          {modo === "ingresar" ? (
            <StaffLoginForm onSuccess={onClose} />
          ) : (
            <RegistroConductorTemporalForm rol="recolector" onSuccess={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}
