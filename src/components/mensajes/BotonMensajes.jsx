import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, X, Car } from "lucide-react";
import { useMensajesPlataforma } from "../../hooks/useMensajesPlataforma";
import { FilasChatsFijados, ChatFijadoAbierto } from "./ChatsFijados";
import { useAbrirMensajesDesdeAviso } from "../../hooks/useAbrirMensajesDesdeAviso";
import { previaMensaje } from "../../lib/adjuntosChat";
import FilaChat from "./FilaChat";
import ReputacionDe from "../ReputacionDe";

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
  return `${m.remitente === "pasajero" ? "Tú: " : ""}${previaMensaje(m.mensaje) || ""}`;
}

// Botón "Mensajes" de la cabecera (pasajero y recolector): contador de no
// leídos y el modal con los chats fijados (solo lectura) y, para el
// pasajero, sus chats con conductores de las últimas 24 h, con el estilo de
// Mensajes del cliente en Caja (foto, último mensaje, hora y no leídos;
// `conductores`: [{ id, nombre, foto_url, ultimo, noLeidos, enViaje,
// terminado }]; tocar uno cierra Mensajes y abre ese chat con
// `onAbrirConductor`). Pasajero y recolector tienen los dos fijados, "Taxi
// PE" y "Tonazo" (por ahí llegan enlaces a la otra app); el pasajero además
// sus conductores. El conductor ve los fijados dentro de su bandeja de chats.
// Unificado con Mensajes de Caja: el chat del viaje se abre DENTRO de este
// modal (`chatConductorId` + `renderChatConductor()`, que arma HomePage),
// con la flecha para volver a la lista (`onCerrarChatConductor`).
export default function BotonMensajes({
  usuarioId,
  conductores = [],
  onAbrirConductor = null,
  chatConductorId = null,
  renderChatConductor = null,
  onCerrarChatConductor = null,
}) {
  const datos = useMensajesPlataforma(usuarioId);
  const noLeidosFijados = Object.keys(datos.canales).reduce(
    (s, c) => s + (datos.canales[c]?.noLeidos || 0),
    0
  );
  const total = noLeidosFijados + conductores.reduce((s, c) => s + (c.noLeidos || 0), 0);
  const [abierto, setAbierto] = useState(false);
  const [canal, setCanal] = useState(null);
  // Tocar una notificación emergente abre Mensajes en ese chat.
  useAbrirMensajesDesdeAviso((c) => {
    setAbierto(true);
    // Aviso de un chat de viaje: ese chat, dentro de Mensajes.
    if (c?.startsWith("conductor:")) {
      setCanal(null);
      onAbrirConductor?.(c.slice("conductor:".length));
      return;
    }
    setCanal(c);
  }, !!usuarioId);

  const chatViaje = abierto && !!chatConductorId && !!renderChatConductor;
  // Un chat de viaje pedido desde afuera (viaje recuperado al entrar) abre
  // Mensajes con ese chat adentro.
  useEffect(() => {
    if (chatConductorId && renderChatConductor) setAbierto(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatConductorId]);
  const cerrar = () => {
    setAbierto(false);
    setCanal(null);
    if (chatConductorId) onCerrarChatConductor?.();
  };
  // Cada vez que ve la lista, los chats con algo pendiente (viaje en curso
  // o mensajes sin leer) laten en verde 3 s — igual que los pedidos del
  // cliente en Caja.
  const [pulsoLista, setPulsoLista] = useState(false);
  useEffect(() => {
    if (!abierto || canal || chatViaje) return undefined;
    setPulsoLista(true);
    const t = setTimeout(() => setPulsoLista(false), 3000);
    return () => clearTimeout(t);
  }, [abierto, canal, chatViaje]);

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
        {total > 0 ? (
          <span className="tz-header-btn-badge">{total > 9 ? "+9" : total}</span>
        ) : (
          // Sin no leídos: punto encendido mientras tenga un viaje en curso
          // (como el pedido en curso en Caja).
          conductores.some((c) => c.enViaje) && <span className="tz-header-btn-badge is-punto" aria-label="Tienes un viaje en curso" />
        )}
      </button>
      {abierto &&
        createPortal(
          <div className="tz-modal-backdrop">
            <div className={`tz-modal tz-mensajes-modal ${chatViaje ? "tz-chat-modal-shell" : ""}`} onClick={(e) => e.stopPropagation()}>
              <button className="tz-modal-close" onClick={cerrar} aria-label="Cerrar">
                <X size={18} />
              </button>
              {chatViaje ? (
                <div className="tz-payment-modal">{renderChatConductor()}</div>
              ) : canal ? (
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
                  <ul className="tz-history-rows" style={{ marginTop: 10 }}>
                    <FilasChatsFijados canales={datos.canales} onAbrir={setCanal} />
                    {onAbrirConductor && conductores.length > 0 && (
                      <>
                        <li className="tz-chatneg-seccion">{conductores.length === 1 ? "Tu conductor" : "Tus conductores"}</li>
                        {conductores.map((c) => (
                          <FilaChat
                            key={c.id}
                            foto={c.foto_url}
                            icono={Car}
                            nombre={c.nombre_usuario ? `@${c.nombre_usuario}` : c.nombre || "Conductor"}
                            estrellas={<ReputacionDe tipo="conductor" id={c.id} tamano="chico" mostrar="estrellas" />}
                            estado={c.enViaje ? { texto: "Viaje en curso", enLinea: true } : c.terminado ? { texto: "Viaje terminado" } : null}
                            preview={previa(c)}
                            hora={c.ultimo ? horaCorta(c.ultimo.created_at) : null}
                            noLeidos={c.noLeidos}
                            activo={c.enViaje}
                            pulso={pulsoLista && (c.enViaje || c.noLeidos > 0)}
                            onClick={() => {
                              // Con `renderChatConductor` el chat se abre acá
                              // mismo; si no, se cierra Mensajes y se abre aparte.
                              if (!renderChatConductor) cerrar();
                              onAbrirConductor(c.id);
                            }}
                          />
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
