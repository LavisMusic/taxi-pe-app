import { useState } from "react";
import { createPortal } from "react-dom";
import { Settings, X, Loader2, BellRing, Smartphone } from "lucide-react";
import { useAvisosCuenta } from "../hooks/useMensajesPlataforma";
import { InterruptorAvisos } from "./mensajes/ChatsFijados";
import AvisosDispositivo from "./mensajes/AvisosDispositivo";

// "Configuraciones y permisos" — MISMO archivo en Taxi-PE y Caja
// (src/components/ConfiguracionesModal.jsx). Lo que antes estaba dentro de
// Mensajes: los avisos y el sonido de la cuenta y, de este dispositivo, el
// permiso de avisos emergentes e instalar la app. `children`: secciones que
// agrega cada pantalla.
export default function ConfiguracionesModal({ usuarioId, onClose, children = null }) {
  const avisos = useAvisosCuenta(usuarioId);
  return createPortal(
    <div className="tz-portal">
    <div className="tz-modal-backdrop" onClick={onClose}>
      <div className="tz-modal tz-config-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Settings size={18} /> Configuraciones y permisos
        </h2>

        <section className="tz-config-seccion">
          <h3>
            <BellRing size={15} /> Avisos y sonido
          </h3>
          <p className="tz-config-nota">Los mensajes nuevos suenan y te llegan como aviso.</p>
          {avisos.activos == null ? (
            <Loader2 size={16} className="tz-spin" />
          ) : (
            <InterruptorAvisos activos={avisos.activos} onCambiar={avisos.cambiar} />
          )}
        </section>

        <section className="tz-config-seccion">
          <h3>
            <Smartphone size={15} /> Este dispositivo
          </h3>
          <AvisosDispositivo siempre />
        </section>

        {children}
      </div>
    </div>
    </div>,
    document.body
  );
}

// Botón con la tuerca: en la cabecera o, con `variante="fila"`, como una
// fila ancha dentro de un modal (el perfil del cliente en Caja).
export function BotonConfiguracion({ usuarioId, variante = "cabecera", children = null }) {
  const [abierto, setAbierto] = useState(false);
  if (!usuarioId) return null;
  return (
    <>
      {variante === "fila" ? (
        <button type="button" className="tz-config-fila-btn" onClick={() => setAbierto(true)}>
          <Settings size={16} /> Configuraciones y permisos
        </button>
      ) : (
        <button
          type="button"
          className="tz-header-btn tz-header-btn-config"
          onClick={() => setAbierto(true)}
          aria-label="Configuraciones y permisos"
          title="Configuraciones y permisos"
        >
          <Settings size={19} />
          <span className="tz-header-btn-label">Configuración</span>
        </button>
      )}
      {abierto && (
        <ConfiguracionesModal usuarioId={usuarioId} onClose={() => setAbierto(false)}>
          {children}
        </ConfiguracionesModal>
      )}
    </>
  );
}
