import { useEffect, useRef, useState } from "react";
import { Send, ShieldAlert } from "lucide-react";
import { formatTime } from "../utils/format";

// Bloquea números de teléfono en el chat (best-effort, no criptográfico):
// colapsa espacios/guiones/paréntesis típicos de cómo la gente separa un
// celular ("987 654 321", "987-654-321") y busca 8+ dígitos seguidos —
// "más de 7 números seguidos" del enunciado. No hay adjuntar imágenes:
// a propósito, es la otra mitad del mismo pedido de privacidad.
function contieneTelefono(texto) {
  const compacto = texto.replace(/[\s.\-()]/g, "");
  return /\d{8,}/.test(compacto);
}

// Ventana de chat compartida entre el modal del Pasajero (con header de
// perfil, ver ChatModal.jsx) y la bandeja del Conductor (con header
// simple, ver ConductorChatInboxModal.jsx) — mismo historial + input +
// filtro de privacidad para los dos lados del mismo hilo.
// `otroEscribiendo`/`onEscribiendo` son el indicador de tipeo en vivo
// (broadcast de Supabase Realtime, ver useChatMensajes.js) — no tocan
// la base, son puramente efímeros.
export default function ChatWindow({ mensajes, loading, remitentePropio, onEnviar, otroEscribiendo = false, onEscribiendo }) {
  const [texto, setTexto] = useState("");
  const [bloqueado, setBloqueado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [mensajes, otroEscribiendo]);

  const handleChange = (e) => {
    const value = e.target.value;
    setTexto(value);
    setBloqueado(contieneTelefono(value));
    if (value.trim()) onEscribiendo?.(remitentePropio);
  };

  const handleEnviar = async (e) => {
    e.preventDefault();
    const mensaje = texto.trim();
    if (!mensaje || bloqueado) return;
    setEnviando(true);
    const { error } = await onEnviar(remitentePropio, mensaje);
    setEnviando(false);
    if (!error) setTexto("");
  };

  return (
    <div className="tz-chat-window">
      <div className="tz-chat-messages" ref={listRef}>
        {loading ? (
          <p className="tz-method-history-empty">Cargando chat…</p>
        ) : (mensajes ?? []).length === 0 ? (
          <p className="tz-method-history-empty">Todavía no hay mensajes. Escribe el primero.</p>
        ) : (
          (mensajes ?? []).map((m, i) => (
            <div
              key={m?.id ?? i}
              className={`tz-chat-bubble ${m?.remitente === remitentePropio ? "tz-chat-bubble-mine" : ""}`}
            >
              <p>{m?.mensaje ?? ""}</p>
              <span className="tz-chat-bubble-time">{m?.created_at ? formatTime(m.created_at) : ""}</span>
            </div>
          ))
        )}
        {otroEscribiendo && (
          <div className="tz-chat-bubble tz-chat-typing" aria-label="Escribiendo…">
            <span className="tz-chat-typing-dot" />
            <span className="tz-chat-typing-dot" />
            <span className="tz-chat-typing-dot" />
          </div>
        )}
      </div>

      {bloqueado && (
        <p className="tz-error" style={{ display: "flex", alignItems: "center", gap: 6, margin: "0 0 6px" }}>
          <ShieldAlert size={14} /> Por seguridad, no se pueden enviar números de teléfono por el chat.
        </p>
      )}

      <form className="tz-chat-input-row" onSubmit={handleEnviar}>
        <input
          type="text"
          className="tz-text-input tz-chat-input"
          placeholder="Escribe un mensaje…"
          value={texto}
          onChange={handleChange}
        />
        <button
          type="submit"
          className="tz-chat-send-btn"
          disabled={!texto.trim() || bloqueado || enviando}
          aria-label="Enviar"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
