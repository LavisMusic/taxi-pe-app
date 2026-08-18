import { X, MessageCircle } from "lucide-react";
import { useChatMensajes, REMITENTE_PASAJERO } from "../hooks/useChatMensajes";
import ChatWindow from "./ChatWindow";
import ConductorPublicCard from "./ConductorPublicCard";
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
      <ConductorPublicCard conductor={conductor} isLoggedIn />

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
// `chat_mensajes`. El header reusa ConductorPublicCard (la MISMA
// tarjeta del Directorio Público) a propósito: así conserva SIEMPRE el
// glow de su categoría (oro VIP, rosa Premium, cian Ejecutivo) sin
// importar el tema del chat — el Rosado Neón de esta pantalla queda
// afuera, solo en el "shell" del modal (.tz-chat-modal-shell, ver
// Styles.jsx), el botón de enviar y el nombre del hilo, nunca pisando
// el color de categoría de la tarjeta.
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
