import { UserPlus, X } from "lucide-react";
import RegistroRecolectorForm from "./RegistroRecolectorForm";

// Envoltura de modal standalone para RegistroRecolectorForm. El modal
// dual de la Home (AccesoRecolectorModal.jsx) usa el Form directo, sin
// este backdrop, para embeberlo junto a la pestaña "Ingresar".
export default function RegistroRecolectorModal(props) {
  const { onClose } = props;
  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <UserPlus size={17} /> Registro de Recolector
          </h2>
          <RegistroRecolectorForm {...props} />
        </div>
      </div>
    </div>
  );
}
