import { useEffect, useRef } from "react";
import { X, MessageCircle } from "lucide-react";
import {
  useChatMensajes,
  REMITENTE_PASAJERO,
  TIPO_MENSAJE_SENAS,
  TIPO_MENSAJE_OFERTA,
  ESTADO_OFERTA_CANCELADA,
  ESTADO_OFERTA_RECHAZADA,
  ESTADO_OFERTA_FINALIZADO,
} from "../hooks/useChatMensajes";
import { ESTADO_CONDUCTOR_ACTIVO } from "../lib/taxiEnums";
import ChatWindow from "./ChatWindow";
import ChatConductorHeader from "./ChatConductorHeader";
import ChatErrorBoundary from "./ChatErrorBoundary";

// Persistencia de la Ubicación del Pasajero (Punto de Recojo) —
// best-effort: si el navegador no soporta geolocalización, el pasajero
// negó el permiso, o el GPS tarda más de lo razonable, se resuelve con
// null en vez de rechazar. El auto-contacto de Fase 0 NUNCA debe
// quedar bloqueado esperando un GPS que puede no llegar nunca — sin
// origen_lat/lng, ese hilo puntual simplemente se queda dependiendo
// 100% del Broadcast en vivo, como antes de este fix.
function obtenerPosicionActual() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      // Fix Precisión GPS: `maximumAge: 0` — sin caché de 15s, siempre
      // pide una lectura fresca. `timeout` se queda en 8000 A PROPÓSITO
      // (ver el comentario de arriba): este es un best-effort de una
      // sola vez para el punto de recojo, nunca debe bloquear el
      // auto-contacto esperando un GPS que puede tardar o no llegar.
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

// El hook (y todo lo que puede fallar) vive DENTRO de este componente
// interno a propósito — es el que ChatErrorBoundary envuelve más
// abajo. Si `useChatMensajes` se llamara en el componente exportado
// (afuera del boundary), un error en su efecto de Realtime escaparía
// sin que el boundary lo vea — exactamente el bug que tuvo
// ConductorChatInboxModal.jsx.
//
// Automatización contextual: el botón manual "¡Hacer Señas!" (logo en
// la cabecera) se eliminó por completo — ahora CADA chat que se abre
// manda su primer mensaje solo, apenas se monta, con un texto que
// depende del estado ACTUAL del conductor (ver ESTADO_CONDUCTOR_ACTIVO
// más abajo). Esto es posible porque HomePage.jsx ya no deja abrir un
// chat sin que el pasajero haya elegido un `destino` primero (Bloqueo
// Estricto de Pasajeros Sin Destino) — así que acá `destino` siempre
// llega con datos reales.
function ChatModalContenido({ conductor, pasajeroId, destino, autoContactar, onClose, onLimpiarDestino }) {
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
  } = useChatMensajes(conductor.id, pasajeroId);
  // Sin esto, si React StrictMode vuelve a montar el efecto (o el
  // componente re-renderiza antes de que termine el insert), se
  // dispararía un segundo primer-mensaje solo.
  const autoEnviadoRef = useRef(false);

  // Flujo de Contacto: "Contactar" desde la tarjeta general del
  // directorio (HomePage.jsx, `abrirChat(id, {auto:false})`) NO manda
  // nada solo — abre el chat limpio en Fase 0, el pasajero escribe o usa
  // "Tonazo" (ver ChatWindow.jsx). Elegir un conductor desde el Radar
  // sigue siendo autocontacto contextual (`autoContactar` true).
  useEffect(() => {
    if (!autoContactar) return;
    if (autoEnviadoRef.current || !destino || loading) return;

    // Bloqueo de Reconexión ("Chat Fantasma"): un hilo con historial NO
    // siempre significa "hay una sesión en curso que no hay que
    // duplicar" — el mismo pasajero y conductor comparten UN SOLO hilo
    // de por vida, así que reabrirlo después de un viaje cancelado o
    // finalizado también tiene historial. Lo que de verdad importa es
    // si la ÚLTIMA oferta de ese historial quedó ACTIVA o RESUELTA:
    //   - Activa (pendiente/aceptada/en_transito): esto sí es una
    //     sesión en curso (ej. recargaste la página, ver la
    //     persistencia de HomePage.jsx) — no mandar el auto-mensaje de
    //     nuevo, duplicaría el contacto.
    //   - Resuelta (cancelada/rechazada/finalizada) o no hay ninguna
    //     oferta todavía: en la práctica esto es un contacto NUEVO (ej.
    //     tocaste de nuevo el mismo auto en el Radar después de
    //     cancelar) — el auto-mensaje debe dispararse igual que la
    //     primera vez, para que el conductor se entere.
    const ultimaOferta = [...(mensajes ?? [])].reverse().find((m) => m?.tipo === TIPO_MENSAJE_OFERTA);
    const hayInteraccionActiva =
      ultimaOferta &&
      ultimaOferta.estado_oferta !== ESTADO_OFERTA_CANCELADA &&
      ultimaOferta.estado_oferta !== ESTADO_OFERTA_RECHAZADA &&
      ultimaOferta.estado_oferta !== ESTADO_OFERTA_FINALIZADO;

    if (hayInteraccionActiva) {
      autoEnviadoRef.current = true;
      return;
    }
    autoEnviadoRef.current = true;

    // "Libre": primer contacto de verdad, pide precio hasta el destino.
    // "En Carrera" (colectivo, ver Fase 3): el auto ya lleva a alguien,
    // esto es un pedido de "súbeme también" — no tiene sentido
    // preguntar tarifa todavía, ese auto ya la negoció con el primero.
    const libre = conductor.estado === ESTADO_CONDUCTOR_ACTIVO;
    const texto = libre
      ? `Necesito una carrera, ¿cuánto me cobras hasta ${destino.nombre || "mi destino"}?`
      : "¿Puede pasar por mí? 🤔";

    (async () => {
      // Punto de Recojo: se guarda pegado a este MISMO mensaje de
      // auto-contacto, igual que ya se hace con destino_lat/destino_lng
      // — ChatWindow.jsx lo busca por el mismo criterio ("el más
      // reciente con estas coordenadas no-null") para sembrar el pin
      // del Pasajero en MapaViaje.jsx del lado del Conductor.
      const origen = await obtenerPosicionActual();
      enviarMensaje(REMITENTE_PASAJERO, texto, {
        tipo: TIPO_MENSAJE_SENAS,
        destino_lat: destino.lat,
        destino_lng: destino.lon,
        ...(origen ? { origen_lat: origen.lat, origen_lng: origen.lng } : {}),
      });
    })();
  }, [autoContactar, destino, conductor.estado, enviarMensaje, loading, mensajes]);

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
        // Lógica de Negocio: "Tonazo" lo necesita para bloquearse sin
        // destino elegido (ver ChatWindow.jsx) — puede llegar null en el
        // flujo manual ("Contactar" de la tarjeta general, autoContactar
        // false), que no lo exige para abrir el chat.
        destino={destino}
        onEnviar={enviarMensaje}
        onResponderOferta={responderOferta}
        onPasajeroRecogido={marcarPasajeroRecogido}
        onCancelarViaje={cancelarViaje}
        onFinalizarViaje={finalizarViaje}
        onMarcarFinDeViaje={marcarFinDeViaje}
        onCerrarPorCancelacion={onClose}
        onLimpiarDestino={onLimpiarDestino}
        conductorId={conductor.id}
        pasajeroId={pasajeroId}
        nivelServicio={conductor.nivel_servicio}
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
//
// `destino` solo es obligatorio en el flujo automático (autoContactar
// true, viene del Radar) — HomePage.jsx lo exige ahí (ver abrirChat).
// El flujo manual ("Contactar" de la tarjeta general, autoContactar
// false) puede llegar sin destino: no lo necesita, no manda nada solo.
export default function ChatModal({ conductor, pasajeroId, destino = null, autoContactar = true, onClose, onLimpiarDestino }) {
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
            <ChatModalContenido
              conductor={conductor}
              pasajeroId={pasajeroId}
              destino={destino}
              autoContactar={autoContactar}
              onClose={onClose}
              onLimpiarDestino={onLimpiarDestino}
            />
          </ChatErrorBoundary>
        </div>
      </div>
    </div>
  );
}
