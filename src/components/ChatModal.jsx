import { X, MessageCircle } from "lucide-react";
import { useChatMensajes, REMITENTE_PASAJERO } from "../hooks/useChatMensajes";
import ChatWindow from "./ChatWindow";
import ChatConductorHeader from "./ChatConductorHeader";
import ChatErrorBoundary from "./ChatErrorBoundary";

// El hook (y todo lo que puede fallar) vive DENTRO de este componente
// interno a propósito — es el que ChatErrorBoundary envuelve más
// abajo. Si `useChatMensajes` se llamara en el componente exportado
// (afuera del boundary), un error en su efecto de Realtime escaparía
// sin que el boundary lo vea — exactamente el bug que tuvo
// ConductorChatInboxModal.jsx.
function ChatModalContenido({ conductor, pasajeroId }) {
  const { mensajes, loading, otroEscribiendo, enviarMensaje, notificarEscribiendo } = useChatMensajes(
    conductor.id,
    pasajeroId
  );

  return (
    <>
      <ChatConductorHeader conductor={conductor} />

      <h2 style={{ marginTop: 12 }}>
        <MessageCircle size={17} /> Chat
      </h2>

      <ChatWindow
        mensajes={mensajes ?? []}
        loading={loading}
        remitentePropio={REMITENTE_PASAJERO}
        onEnviar={enviarMensaje}
        otroEscribiendo={otroEscribiendo}
        onEscribiendo={notificarEscribiendo}
      />
    </>
  );
}

// Reemplaza al viejo "Contactar" (wa.me con el teléfono real del
// conductor) — el pasajero nunca ve el número de nadie, todo pasa por
// `chat_mensajes`. El header usa ChatConductorHeader (compacto: sin
// foto ni descripción, solo Nombre/Placa/Estado — a propósito distinto
// de ConductorPublicCard, para no comerse espacio vertical que le hace
// falta al chat) pero conserva el mismo glow por categoría (oro VIP,
// rosa Premium, cian Ejecutivo) — el Rosado Neón de esta pantalla
// queda afuera, solo en el "shell" del modal (.tz-chat-modal-shell,
// ver Styles.jsx), el botón de enviar y el nombre del hilo, nunca
// pisando el color de categoría de la cabecera. El modal entero es
// flex-column con altura tope (85vh) — SOLO el área de mensajes
// (.tz-chat-window, dentro de ChatWindow.jsx) scrollea; esta cabecera,
// el título "Chat" y el input de escribir quedan fijos.
//
// `conductor` le llega como prop desde HomePage.jsx, que lo deriva en
// vivo de `conductores` (ya suscrito a Realtime) buscándolo por id en
// cada render — no es una copia estática tomada al abrir el chat, así
// que si el conductor cambia de estado mientras el chat está abierto,
// la etiqueta de acá se actualiza sola.
export default function ChatModal({ conductor, pasajeroId, onClose }) {
  // Sin conductor no hay nada que mostrar — evita romper el árbol de
  // React leyendo propiedades de undefined si este modal llegara a
  // montarse sin datos todavía listos.
  if (!conductor) return null;

  return (
    <div className="tz-modal-backdrop" onClick={onClose}>
      <div className="tz-modal tz-chat-modal-shell" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <ChatErrorBoundary>
            <ChatModalContenido conductor={conductor} pasajeroId={pasajeroId} />
          </ChatErrorBoundary>
        </div>
      </div>
    </div>
  );
}
