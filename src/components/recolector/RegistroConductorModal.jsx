import { UserPlus, X } from "lucide-react";
import RegistroConductorForm from "./RegistroConductorForm";

// Envoltura de modal standalone para RegistroConductorForm — la usan
// el Registro Rápido del Recolector, "Usuarios → Conductores" del
// Admin y "¿Sos conductor nuevo? Regístrate" de /login. El modal dual
// de la Home (AccesoConductorModal.jsx) usa el Form directo, sin este
// backdrop, para poder embeberlo junto a la pestaña "Ingresar".
export default function RegistroConductorModal(props) {
  const { onClose } = props;
  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <UserPlus size={17} /> Registro de Conductor
          </h2>
          <RegistroConductorForm {...props} />
        </div>
      </div>
    </div>
  );
}
