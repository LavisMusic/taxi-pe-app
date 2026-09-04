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
function HiloConversacion({ conductorId, pasajeroId, nivelServicio, iconoCategoriaUrl, onCerrarPorCancelacion }) {
  const {
    mensajes,
    loading,
    otroEscribiendo,
    enviarMensaje,
    responderOferta,
    marcarPasajeroRecogido,
    cancelarViaje,
    finalizarViaje,
    marcarFinDeViaje,
    notificarEscribiendo,
    marcarLeidoPorConductor,
  } = useChatMensajes(conductorId, pasajeroId);

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
      onResponderOferta={responderOferta}
      onPasajeroRecogido={marcarPasajeroRecogido}
      onCancelarViaje={cancelarViaje}
      onFinalizarViaje={finalizarViaje}
      onMarcarFinDeViaje={marcarFinDeViaje}
      onCerrarPorCancelacion={onCerrarPorCancelacion}
      conductorId={conductorId}
      pasajeroId={pasajeroId}
      nivelServicio={nivelServicio}
      iconoCategoriaUrl={iconoCategoriaUrl}
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
function BandejaContenido({ conductorId, pasajeroInicial, nivelServicio, iconoCategoriaUrl }) {
  const { hilos, loading, pasajerosEnCarrera } = useHilosChatConductor(conductorId);
  const [nombresPorId, setNombresPorId] = useState({});
  // Si el modal se abrió desde la alerta de "Hacer Señas" (ver
  // ConductorPage.jsx), entra directo a ese hilo en vez de mostrar la
  // lista primero.
  const [pasajeroAbierto, setPasajeroAbierto] = useState(pasajeroInicial ?? null);
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
          {/* Fase 5 (Motor de Viajes Simultáneos) — Selector de Hilos:
             solo aparece si hay MÁS de un hilo — un conductor con una
             sola conversación no necesita pestañas para elegir entre
             una opción. Deja cambiar de pasajero SIN pasar por "Volver
             a la lista" primero. El puntito verde marca los hilos que
             son un viaje de verdad en curso ahora mismo (`pasajerosEnCarrera`
             — 'aceptada'/'en_transito'), no solo una negociación
             abierta, para que el conductor distinga de un vistazo a
             quién tiene esperando vs a quién ya lleva a bordo. */}
          {listaHilos.length > 1 && (
            <div className="tz-chat-hilos-tabs">
              {listaHilos.map((h) => {
                const pid = h?.pasajeroId;
                if (!pid) return null;
                const enCurso = pasajerosEnCarrera?.includes(pid);
                return (
                  <button
                    key={pid}
                    type="button"
                    className={`tz-chat-hilo-tab ${pid === pasajeroAbierto ? "tz-chat-hilo-tab-activo" : ""}`}
                    onClick={() => setPasajeroAbierto(pid)}
                    title={enCurso ? "Viaje en curso" : "Negociando"}
                  >
                    {enCurso && <span className="tz-chat-hilo-tab-dot" aria-hidden="true" />}
                    {nombresPorId[pid] ?? "Pasajero"}
                  </button>
                );
              })}
            </div>
          )}
          <p className="tz-chat-thread-name" style={{ margin: "0 0 8px" }}>
            {nombresPorId[pasajeroAbierto] ?? "Pasajero"}
          </p>
          {/* `key={pasajeroAbierto}` fuerza un remount COMPLETO de
             HiloConversacion (y del ChatWindow que tiene adentro) al
             cambiar de pestaña — sin esto, React reutilizaría la MISMA
             instancia entre Pasajero A y B (mismo tipo de elemento,
             misma posición en el árbol) y todo el estado interno de
             ChatWindow (estadoViaje, ofertasLocales, el mapa, el
             cronómetro) se quedaría pegado del hilo viejo, mezclando un
             viaje con el otro — exactamente el aislamiento que pide
             esta ronda. */}
          <HiloConversacion
            key={pasajeroAbierto}
            conductorId={conductorId}
            pasajeroId={pasajeroAbierto}
            nivelServicio={nivelServicio}
            iconoCategoriaUrl={iconoCategoriaUrl}
            onCerrarPorCancelacion={() => setPasajeroAbierto(null)}
          />
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

export default function ConductorChatInboxModal({ conductorId, pasajeroInicial, nivelServicio, iconoCategoriaUrl, onClose }) {
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
              <BandejaContenido
                conductorId={conductorId}
                pasajeroInicial={pasajeroInicial}
                nivelServicio={nivelServicio}
                iconoCategoriaUrl={iconoCategoriaUrl}
              />
            </ChatErrorBoundary>
          )}
        </div>
      </div>
    </div>
  );
}
