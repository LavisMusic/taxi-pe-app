import { useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, X } from "lucide-react";
import { useMensajesPlataforma } from "../../hooks/useMensajesPlataforma";
import { FilasChatsFijados, ChatFijadoAbierto, InterruptorAvisos } from "./ChatsFijados";

// Botón "Mensajes" de la cabecera (pasajero y recolector): contador de no
// leídos y el modal con los chats fijados "Taxi PE" y "Tonazo" (solo
// lectura). El conductor los ve dentro de su bandeja de chats.
export default function BotonMensajes({ usuarioId }) {
  const datos = useMensajesPlataforma(usuarioId);
  const [abierto, setAbierto] = useState(false);
  const [canal, setCanal] = useState(null);

  const cerrar = () => {
    setAbierto(false);
    setCanal(null);
  };

  return (
    <>
      <button
        type="button"
        className="tz-header-btn"
        onClick={() => setAbierto(true)}
        aria-label="Mensajes"
        title="Mensajes"
        style={{ position: "relative" }}
      >
        <MessageCircle size={19} />
        <span className="tz-header-btn-label">Mensajes</span>
        {datos.totalNoLeidos > 0 && <span className="tz-header-btn-badge">{datos.totalNoLeidos}</span>}
      </button>
      {abierto &&
        createPortal(
          <div className="tz-modal-backdrop">
            <div className="tz-modal tz-mensajes-modal" onClick={(e) => e.stopPropagation()}>
              <button className="tz-modal-close" onClick={cerrar} aria-label="Cerrar">
                <X size={18} />
              </button>
              {canal ? (
                <ChatFijadoAbierto
                  canal={canal}
                  datos={datos.canales[canal]}
                  onVolver={() => setCanal(null)}
                  onLeido={datos.marcarLeido}
                />
              ) : (
                <>
                  <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <MessageCircle size={18} /> Mensajes
                  </h2>
                  <InterruptorAvisos activos={datos.avisosActivos} onCambiar={datos.cambiarAvisos} />
                  <ul className="tz-history-rows" style={{ marginTop: 10 }}>
                    <FilasChatsFijados canales={datos.canales} onAbrir={setCanal} />
                  </ul>
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
