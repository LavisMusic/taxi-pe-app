import { useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, X, Car } from "lucide-react";
import { useMensajesPlataforma } from "../../hooks/useMensajesPlataforma";
import { FilasChatsFijados, ChatFijadoAbierto, InterruptorAvisos } from "./ChatsFijados";
import AvisosDispositivo from "./AvisosDispositivo";
import { useAbrirMensajesDesdeAviso } from "../../hooks/useAbrirMensajesDesdeAviso";

const horaCorta = (ms) => {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit" });
};
// Vista previa del último mensaje de un chat de viaje.
function previa(c) {
  const m = c.ultimo;
  if (!m) return "Toca para abrir el chat";
  if (m.tipo === "oferta") return `💰 ${m.mensaje || "Oferta del viaje"}`;
  if (m.tipo === "senas") return "👋 Hiciste señas";
  return `${m.remitente === "pasajero" ? "Tú: " : ""}${m.mensaje || ""}`;
}

// Botón "Mensajes" de la cabecera (pasajero y recolector): contador de no
// leídos y el modal con los chats fijados (solo lectura) y, para el
// pasajero, sus chats con conductores de las últimas 24 h, con el estilo de
// Mensajes del cliente en Caja (foto, último mensaje, hora y no leídos;
// `conductores`: [{ id, nombre, foto_url, ultimo, noLeidos, enViaje,
// terminado }]; tocar uno cierra Mensajes y abre ese chat con
// `onAbrirConductor`). Al pasajero no se le muestra ningún negocio: solo el
// fijado "Taxi PE" y sus conductores. El conductor ve los fijados dentro de
// su bandeja de chats.
export default function BotonMensajes({ usuarioId, conductores = [], onAbrirConductor = null }) {
  const datos = useMensajesPlataforma(usuarioId);
  const esPasajero = !!onAbrirConductor;
  const canalesVisibles = esPasajero ? ["taxipe"] : null;
  const noLeidosFijados = (canalesVisibles ?? Object.keys(datos.canales)).reduce(
    (s, c) => s + (datos.canales[c]?.noLeidos || 0),
    0
  );
  const total = noLeidosFijados + conductores.reduce((s, c) => s + (c.noLeidos || 0), 0);
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
        {total > 0 && <span className="tz-header-btn-badge">{total > 9 ? "+9" : total}</span>}
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
                    <FilasChatsFijados canales={datos.canales} onAbrir={setCanal} soloCanales={canalesVisibles} />
                    {onAbrirConductor && conductores.length > 0 && (
                      <>
                        <li className="tz-chatneg-seccion">{conductores.length === 1 ? "Tu conductor" : "Tus conductores"}</li>
                        {conductores.map((c) => (
                          <li key={c.id} className={`tz-history-row tz-chatfijo-row tz-chatpas-row ${c.enViaje ? "is-activo" : ""}`}>
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
                                <span className="tz-chatfijo-nombre">
                                  {c.nombre_usuario ? `@${c.nombre_usuario}` : c.nombre || "Conductor"}
                                  {c.enViaje ? (
                                    <span className="tz-chatneg-estado is-en-linea">Viaje en curso</span>
                                  ) : c.terminado ? (
                                    <span className="tz-chatneg-estado">Viaje terminado</span>
                                  ) : null}
                                </span>
                                <span className="tz-chatfijo-preview">{previa(c)}</span>
                              </span>
                              <span className="tz-chatfijo-meta">
                                {c.ultimo && <span className="tz-chatfijo-hora">{horaCorta(c.ultimo.created_at)}</span>}
                                {c.noLeidos > 0 && <span className="tz-chatfijo-badge">{c.noLeidos > 9 ? "+9" : c.noLeidos}</span>}
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
