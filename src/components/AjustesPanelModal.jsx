import { createPortal } from "react-dom";
import { SlidersHorizontal, X } from "lucide-react";
import SeccionMascota from "./mascota/SeccionMascota";

// "Ajustes del panel" (pie de página del admin de Taxi PE): ajustes propios
// del administrador. Por ahora, mostrar u ocultar a Don Peje; aquí se irán
// sumando los demás.
export default function AjustesPanelModal({ onClose }) {
  return createPortal(
    <div className="tz-portal">
      <div className="tz-modal-backdrop" onClick={onClose}>
        <div className="tz-modal tz-config-modal" onClick={(e) => e.stopPropagation()}>
          <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SlidersHorizontal size={18} /> Ajustes del panel
          </h2>
          <SeccionMascota />
        </div>
      </div>
    </div>,
    document.body
  );
}
