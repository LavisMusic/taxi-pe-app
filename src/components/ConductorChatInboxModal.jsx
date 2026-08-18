import { useEffect, useState } from "react";
import { X, MessageCircle, ChevronLeft, Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { useHilosChatConductor, useChatMensajes, REMITENTE_CONDUCTOR } from "../hooks/useChatMensajes";
import ChatWindow from "./ChatWindow";
import ChatErrorBoundary from "./ChatErrorBoundary";

// Bandeja de mensajes del lado Conductor (/conductor, botón
// "Mensajes") — sin esto el chat sería de un solo sentido (el pasajero
// escribe desde ChatModal y nadie del otro lado lo ve). Lista de hilos
// (un pasajero = un hilo) -> click abre la conversación con el mismo
// ChatWindow que usa el pasajero, solo que acá el remitente propio es
// "conductor".
function HiloConversacion({ conductorId, pasajeroId }) {
  const { mensajes, loading, otroEscribiendo, enviarMensaje, notificarEscribiendo, marcarLeidoPorConductor } =
    useChatMensajes(conductorId, pasajeroId);

  // Al abrir este hilo, todo lo que mandó el pasajero queda "leído" —
  // apaga el punto rojo del botón Mensajes (ver ConductorPage.jsx).
  useEffect(() => {
    marcarLeidoPorConductor?.();
  }, [marcarLeidoPorConductor]);

  return (
    <ChatWindow
      mensajes={mensajes ?? []}
      loading={loading}
      remitentePropio={REMITENTE_CONDUCTOR}
      onEnviar={enviarMensaje}
      otroEscribiendo={otroEscribiendo}
      onEscribiendo={notificarEscribiendo}
    />
  );
}

// TODO lo que puede fallar (el hook de Realtime, el fetch de nombres,
// el .map() de hilos) vive ACÁ ADENTRO a propósito — este es el
// componente que ChatErrorBoundary envuelve en el export de abajo. Si
// useHilosChatConductor (o cualquier otra cosa acá) tira una excepción
// en su render o en un efecto, el boundary la atrapa PORQUE está por
// encima de este componente en el árbol — no alcanza con envolver el
// JSX del padre si el hook que puede fallar se llama afuera de esa
// envoltura, ese fue justo el bug: el error real (colisión de canales
// de Realtime, ver useChatMensajes.js) escapaba del boundary porque el
// hook se llamaba un nivel más arriba.
function BandejaContenido({ conductorId }) {
  const { hilos, loading } = useHilosChatConductor(conductorId);
  const [nombresPorId, setNombresPorId] = useState({});
  const [pasajeroAbierto, setPasajeroAbierto] = useState(null);
  const listaHilos = hilos ?? [];
  const idsKey = listaHilos.map((h) => h?.pasajeroId).filter(Boolean).join(",");

  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    if (ids.length === 0) return;
    let cancelado = false;
    (async () => {
      try {
        const { data, error } = await supabase.from("usuarios").select("id, nombre").in("id", ids);
        if (cancelado || error) return;
        const map = {};
        (data ?? []).forEach((u) => {
          if (u?.id) map[u.id] = u.nombre;
        });
        setNombresPorId(map);
      } catch {
        // Silencioso a propósito: si falla, los nombres caen al
        // fallback "Pasajero" — no es motivo para romper el modal.
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [idsKey]);

  return (
    <>
      <h2>
        {pasajeroAbierto && (
          <button
            type="button"
            className="tz-vis-edit-btn"
            onClick={() => setPasajeroAbierto(null)}
            aria-label="Volver a la lista"
            style={{ marginRight: 4 }}
          >
            <ChevronLeft size={16} />
          </button>
        )}
        <MessageCircle size={17} /> Mensajes
      </h2>

      {pasajeroAbierto ? (
        <>
          <p className="tz-chat-thread-name" style={{ margin: "0 0 8px" }}>
            {nombresPorId[pasajeroAbierto] ?? "Pasajero"}
          </p>
          <HiloConversacion conductorId={conductorId} pasajeroId={pasajeroAbierto} />
        </>
      ) : loading ? (
        <div className="tz-loading" style={{ minHeight: 120 }}>
          <Loader2 className="tz-spin" size={24} />
          <p>Cargando…</p>
        </div>
      ) : listaHilos.length === 0 ? (
        <p className="tz-method-history-empty">Todavía no tienes mensajes de pasajeros.</p>
      ) : (
        <ul className="tz-history-rows">
          {listaHilos.map((h) => (
            <li key={h?.pasajeroId ?? Math.random()} className="tz-history-row">
              <button type="button" className="tz-history-row-head" onClick={() => setPasajeroAbierto(h?.pasajeroId ?? null)}>
                <span className="tz-chat-thread-name">{nombresPorId[h?.pasajeroId] ?? "Pasajero"}</span>
                <span className="tz-history-row-amount tz-chat-thread-preview">
                  {(h?.ultimo?.mensaje ?? "").slice(0, 30)}
                  {(h?.ultimo?.mensaje?.length ?? 0) > 30 ? "…" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function ConductorChatInboxModal({ conductorId, onClose }) {
  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-chat-modal-shell" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          {!conductorId ? (
            <div className="tz-loading" style={{ minHeight: 120 }}>
              <Loader2 className="tz-spin" size={24} />
              <p>Cargando…</p>
            </div>
          ) : (
            <ChatErrorBoundary>
              <BandejaContenido conductorId={conductorId} />
            </ChatErrorBoundary>
          )}
        </div>
      </div>
    </div>
  );
}
