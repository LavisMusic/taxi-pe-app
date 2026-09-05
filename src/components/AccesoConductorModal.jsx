import { useState } from "react";
import { Car, X } from "lucide-react";
import StaffLoginForm from "./StaffLoginForm";
import RegistroConductorTemporalForm from "./recolector/RegistroConductorTemporalForm";

// Modal dual del botón "Conductores" del header de la Home: toggle
// Ingresar/Registrarse en un solo modal, en vez de dos flujos sueltos.
// "Ingresar" es el mismo StaffLoginForm que usa el botón "Recolectores"
// (Teléfono+PIN, rutea sola según el rol real de la cuenta) —
// "Registrarse" ahora es el registro exprés (nombre+teléfono nomás,
// ver RegistroConductorTemporalForm.jsx): entra de una con una cuenta
// 'temporal' y completa DNI/placa/fotos/PIN después, desde
// StaffLoginForm — ya no cae directo al Centro de Peticiones acá.
export default function AccesoConductorModal({ onClose }) {
  const [modo, setModo] = useState("ingresar");

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Car size={17} /> Conductores
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
            <RegistroConductorTemporalForm onSuccess={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}
