import { useState } from "react";
import { Car, X } from "lucide-react";
import StaffLoginForm from "./StaffLoginForm";
import RegistroConductorForm from "./recolector/RegistroConductorForm";

// Modal dual del botón "Conductores" del header de la Home: toggle
// Ingresar/Registrarse en un solo modal, en vez de dos flujos sueltos.
// "Ingresar" es el mismo StaffLoginForm que usa el botón "Recolectores"
// (Teléfono+PIN, rutea sola según el rol real de la cuenta) —
// "Registrarse" es el alta self-service (aprobado:false, cae en el
// Centro de Peticiones).
export default function AccesoConductorModal({
  categorias,
  subgrupos,
  crearConductorConUsuario,
  onCreatedUsuario,
  onClose,
}) {
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
            <RegistroConductorForm
              categorias={categorias}
              subgrupos={subgrupos}
              crearConductorConUsuario={crearConductorConUsuario}
              requiereLogin
              aprobado={false}
              onClose={onClose}
              onCreatedUsuario={onCreatedUsuario}
            />
          )}
        </div>
      </div>
    </div>
  );
}
