import { useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, X, Car } from "lucide-react";
import { useMensajesPlataforma } from "../../hooks/useMensajesPlataforma";
import { FilasChatsFijados, ChatFijadoAbierto, InterruptorAvisos } from "./ChatsFijados";
import AvisosDispositivo from "./AvisosDispositivo";
import { useAbrirMensajesDesdeAviso } from "../../hooks/useAbrirMensajesDesdeAviso";

// Botón "Mensajes" de la cabecera (pasajero y recolector): contador de no
// leídos y el modal con los chats fijados "Taxi PE" y "Tonazo" (solo
// lectura) y, para el pasajero, el chat con su(s) conductor(es) actual(es)
// (`conductores`: [{ id, nombre, foto_url, estado }]; tocar uno cierra
// Mensajes y abre ese chat con `onAbrirConductor`). Nunca muestra chats de
// Caja Tonazo. El conductor ve los fijados dentro de su bandeja de chats.
export default function BotonMensajes({ usuarioId, conductores = [], onAbrirConductor = null }) {
  const datos = useMensajesPlataforma(usuarioId);
  const [abierto, setAbierto] = useState(false);
  const [canal, setCanal] = useState(null);
  // Tocar una notificación emergente abre Mensajes en ese chat.
  useAbrirMensajesDesdeAviso((c) => {
    setAbierto(true);
    setCanal(c);
  }, !!usuarioId);

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
                  <AvisosDispositivo />
                  <ul className="tz-history-rows" style={{ marginTop: 10 }}>
                    <FilasChatsFijados canales={datos.canales} onAbrir={setCanal} />
                    {onAbrirConductor && conductores.length > 0 && (
                      <>
                        <li className="tz-chatneg-seccion">{conductores.length === 1 ? "Tu conductor" : "Tus conductores"}</li>
                        {conductores.map((c) => (
                          <li key={c.id} className="tz-history-row tz-chatfijo-row">
                            <button
                              type="button"
                              className="tz-chatfijo-btn"
                              onClick={() => {
                                cerrar();
                                onAbrirConductor(c.id);
                              }}
                            >
                              {c.foto_url ? (
                                <img src={c.foto_url} alt="" className="tz-chatfijo-logo tz-chatcond-foto" />
                              ) : (
                                <span className="tz-chatfijo-logo tz-chatcond-foto tz-chatcond-foto-vacia">
                                  <Car size={18} />
                                </span>
                              )}
                              <span className="tz-chatfijo-texto">
                                <span className="tz-chatfijo-nombre">{c.nombre || "Conductor"}</span>
                                <span className="tz-chatfijo-preview">Toca para abrir el chat del viaje</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </>
                    )}
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
