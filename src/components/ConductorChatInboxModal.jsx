import { useEffect, useState } from "react";
import { X, MessageCircle, ArrowLeft, Loader2, Store, UserRound } from "lucide-react";
import { ChatEntregaConductor } from "./repartidor/EntregaActivaModal";
import { supabase } from "../supabaseClient";
import { useHilosChatConductor, useChatMensajes, REMITENTE_CONDUCTOR } from "../hooks/useChatMensajes";
import { usePerfilesEnVivo } from "../hooks/usePerfilesEnVivo";
import { previaMensaje } from "../lib/adjuntosChat";
import ChatWindow from "./ChatWindow";
import ChatErrorBoundary from "./ChatErrorBoundary";
import { FilasChatsFijados, ChatFijadoAbierto, InterruptorAvisos } from "./mensajes/ChatsFijados";
import AvisosDispositivo from "./mensajes/AvisosDispositivo";

// Bandeja de mensajes del lado Conductor (/conductor, botón
// "Mensajes") — sin esto el chat sería de un solo sentido (el pasajero
// escribe desde ChatModal y nadie del otro lado lo ve). Lista de hilos
// (un pasajero = un hilo) -> click abre la conversación con el mismo
// ChatWindow que usa el pasajero, solo que acá el remitente propio es
// "conductor". Mismo estilo que Mensajes (lista de chats con su avatar y la
// cabecera del chat abierto), como los chats de los negocios del cliente.

function horaCorta(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit" });
}
// Foto de la persona (su perfil), sola y sin marco; sin foto, el sticker.
function Avatar({ foto }) {
  return foto ? (
    <img src={foto} alt="" className="tz-chat-cara" />
  ) : (
    <span className="tz-chat-sticker">
      <UserRound size={26} />
    </span>
  );
}
// Logo del negocio del pedido, sin marco (o el sticker de tienda si la
// entrega no lo trae).
function LogoTienda({ url }) {
  return url ? (
    <img src={url} alt="" className="tz-chat-cara" />
  ) : (
    <span className="tz-chat-sticker">
      <Store size={26} />
    </span>
  );
}
const ESTADO_ENTREGA = { aceptado: "Por recoger", en_ruta: "En camino" };

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
  // Y también con el chat ya abierto: cada mensaje nuevo del pasajero se
  // marca leído al llegar (si la pestaña está a la vista).
  const hayNoLeidos = (mensajes ?? []).some((m) => m?.remitente === "pasajero" && !m?.leido);
  useEffect(() => {
    if (!hayNoLeidos && mensajes) return undefined;
    const marcar = () => {
      if (document.visibilityState === "visible") marcarLeidoPorConductor?.();
    };
    marcar();
    document.addEventListener("visibilitychange", marcar);
    return () => document.removeEventListener("visibilitychange", marcar);
  }, [marcarLeidoPorConductor, hayNoLeidos, mensajes]);

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
// `plataforma` (useMensajesPlataforma, desde ConductorPage): los chats
// fijados "Taxi PE" y "Tonazo", arriba de la lista y de solo lectura.
// `entregas` (delivery de Caja en curso) y `noLeidosEntregas`: sección
// "Tus entregas" — por pedido, el chat con la tienda y, agrupado debajo,
// el del cliente; un brillo verde recorre el borde de los dos (como "Tus
// pedidos" en Mensajes de Caja). Los chats de la entrega viven solo acá.
// `entregaInicial` ({ id, hilo }): abre directo ese chat.
function BandejaContenido({ conductorId, pasajeroInicial, nivelServicio, iconoCategoriaUrl, plataforma, canalInicial, entregas = [], noLeidosEntregas = {}, onEntregasCambio, entregaInicial }) {
  const [canalFijo, setCanalFijo] = useState(canalInicial ?? null);
  const [entregaChat, setEntregaChat] = useState(entregaInicial ?? null); // { id, hilo }
  const { hilos, loading, pasajerosEnCarrera, refresh } = useHilosChatConductor(conductorId);
  const [nombresPorId, setNombresPorId] = useState({});
  const [fotosPorId, setFotosPorId] = useState({});
  // Foto o @usuario cambiados (en vivo): se vuelven a pedir nombres y caras.
  const [versionPerfiles, setVersionPerfiles] = useState(0);
  usePerfilesEnVivo(() => setVersionPerfiles((v) => v + 1));
  // Caras de "Tus entregas": logo del negocio y foto/@usuario del cliente
  // (rpc_entrega_caras_conductor, migración 20261027130000).
  const [caras, setCaras] = useState({});
  const idsEntregasKey = entregas.map((e) => e.id).sort().join(",");
  useEffect(() => {
    if (!idsEntregasKey || !conductorId) return undefined;
    let vivo = true;
    supabase.rpc("rpc_entrega_caras_conductor", { p_conductor_id: conductorId }).then(({ data, error }) => {
      if (vivo && !error) setCaras(Object.fromEntries((data || []).map((f) => [f.entrega_id, f])));
    });
    return () => {
      vivo = false;
    };
  }, [idsEntregasKey, conductorId, versionPerfiles]);
  const nombreCliente = (e) => (caras[e?.id]?.cliente_usuario && !/^\d{6,}$/.test(caras[e.id].cliente_usuario) ? `@${caras[e.id].cliente_usuario}` : e?.cliente_nombre || "Cliente");
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
        // "*": con la migración 20261027110000 la vista trae nombre_usuario,
        // que es lo que se muestra de cada persona (si no, su nombre).
        const { data, error } = await supabase.from("usuarios_publicos").select("*").in("id", ids);
        if (cancelado || error) return;
        const map = {};
        const fotos = {};
        (data ?? []).forEach((u) => {
          if (u?.id && u.foto_url) fotos[u.id] = u.foto_url;
          if (u?.id) map[u.id] = u.nombre_usuario && !/^\d{6,}$/.test(u.nombre_usuario) ? `@${u.nombre_usuario}` : u.nombre;
        });
        setNombresPorId(map);
        setFotosPorId(fotos);
      } catch {
        // Silencioso a propósito: si falla, los nombres caen al
        // fallback "Pasajero" — no es motivo para romper el modal.
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [idsKey, versionPerfiles]);

  if (entregaChat) {
    const e = entregas.find((x) => x.id === entregaChat.id);
    const conTienda = entregaChat.hilo === "cajero_conductor";
    return (
      <>
        <div className="tz-chatfijo-cabecera">
          <button
            type="button"
            className="tz-chatfijo-volver"
            onClick={() => {
              setEntregaChat(null);
              onEntregasCambio?.();
            }}
            aria-label="Volver a los chats"
          >
            <ArrowLeft size={16} />
          </button>
          {conTienda ? <LogoTienda url={caras[e?.id]?.caja_logo_url} /> : <Avatar foto={caras[e?.id]?.cliente_foto_url} nombre={nombreCliente(e)} />}
          <span>
            <strong>{conTienda ? e?.caja_sucursal || "Sucursal" : nombreCliente(e)}</strong>
            <small>
              {conTienda ? "Tienda del pedido" : "Cliente del pedido"}
              {e ? ` · ${ESTADO_ENTREGA[e.estado] || e.estado}` : ""}
            </small>
          </span>
        </div>
        <ChatEntregaConductor key={`${entregaChat.id}-${entregaChat.hilo}`} entregaId={entregaChat.id} conductorId={conductorId} hilo={entregaChat.hilo} />
      </>
    );
  }

  if (canalFijo && plataforma) {
    return (
      <ChatFijadoAbierto
        canal={canalFijo}
        datos={plataforma.canales[canalFijo]}
        onVolver={() => setCanalFijo(null)}
        onLeido={plataforma.marcarLeido}
      />
    );
  }

  return (
    <>
      {!pasajeroAbierto && (
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MessageCircle size={18} /> Mensajes
        </h2>
      )}

      {pasajeroAbierto ? (
        <>
          <div className="tz-chatfijo-cabecera">
            <button type="button" className="tz-chatfijo-volver" onClick={() => setPasajeroAbierto(null)} aria-label="Volver a los chats">
              <ArrowLeft size={16} />
            </button>
            <Avatar foto={fotosPorId[pasajeroAbierto]} nombre={nombresPorId[pasajeroAbierto]} />
            <span>
              <strong>{nombresPorId[pasajeroAbierto] ?? "Pasajero"}</strong>
              <small>{pasajerosEnCarrera?.includes(pasajeroAbierto) ? "Viaje en curso" : "Negociando"}</small>
            </span>
          </div>
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
      ) : (
        <>
          {plataforma && (
            <>
              <InterruptorAvisos activos={plataforma.avisosActivos} onCambiar={plataforma.cambiarAvisos} />
              <AvisosDispositivo />
              <ul className="tz-history-rows" style={{ margin: "10px 0" }}>
                <FilasChatsFijados canales={plataforma.canales} onAbrir={setCanalFijo} />
              </ul>
            </>
          )}
          {entregas.length > 0 && (
            <ul className="tz-history-rows" style={{ margin: "10px 0" }}>
              <li className="tz-chatneg-seccion">Tus entregas</li>
              {entregas.map((e) => {
                const n = noLeidosEntregas[e.id] || {};
                return (
                  <li key={e.id} className="tz-history-row tz-chatfijo-row tz-chatent-row is-activo">
                    <button type="button" className="tz-chatfijo-btn" onClick={() => setEntregaChat({ id: e.id, hilo: "cajero_conductor" })}>
                      <LogoTienda url={caras[e.id]?.caja_logo_url} />
                      <span className="tz-chatfijo-texto">
                        <span className="tz-chatfijo-nombre">{e.caja_sucursal || "Sucursal"}</span>
                        <span className="tz-chatfijo-preview">
                          <span className="tz-chatent-estado">{ESTADO_ENTREGA[e.estado] || e.estado}</span> · Pedido de {e.cliente_nombre || "cliente"}
                        </span>
                      </span>
                      {n.cajero_conductor > 0 && <span className="tz-chatfijo-badge">{n.cajero_conductor > 9 ? "+9" : n.cajero_conductor}</span>}
                    </button>
                    <div className="tz-chatent-despliegue">
                      <button
                        type="button"
                        className="tz-chatfijo-btn tz-chatent-cliente"
                        onClick={() => setEntregaChat({ id: e.id, hilo: "cliente_conductor" })}
                      >
                        <Avatar foto={caras[e.id]?.cliente_foto_url} nombre={nombreCliente(e)} />
                        <span className="tz-chatfijo-texto">
                          <span className="tz-chatfijo-nombre">{nombreCliente(e)}</span>
                          <span className="tz-chatfijo-preview">Cliente · {e.direccion_entrega || "Sin dirección"}</span>
                        </span>
                        {n.cliente_conductor > 0 && <span className="tz-chatfijo-badge">{n.cliente_conductor > 9 ? "+9" : n.cliente_conductor}</span>}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {loading ? (
        <div className="tz-loading" style={{ minHeight: 120 }}>
          <Loader2 className="tz-spin" size={24} />
          <p>Cargando…</p>
        </div>
      ) : listaHilos.length === 0 ? (
        <p className="tz-method-history-empty">Todavía no tienes mensajes de pasajeros.</p>
      ) : (
        <ul className="tz-history-rows">
          {/* Por secciones, como Mensajes del cliente: primero los viajes
              en curso, después las conversaciones en negociación. */}
          {[
            { titulo: "Viajes en curso", hilos: listaHilos.filter((h) => pasajerosEnCarrera?.includes(h?.pasajeroId)) },
            { titulo: "Negociando", hilos: listaHilos.filter((h) => !pasajerosEnCarrera?.includes(h?.pasajeroId)) },
          ]
            .filter((sec) => sec.hilos.length > 0)
            .flatMap((sec) => [
              <li key={`sec-${sec.titulo}`} className="tz-chatneg-seccion">{sec.titulo}</li>,
              ...sec.hilos.map((h) => {
            const pid = h?.pasajeroId ?? null;
            const enCurso = pid && pasajerosEnCarrera?.includes(pid);
            const nombre = nombresPorId[pid] ?? "Pasajero";
            return (
              <li key={pid ?? Math.random()} className="tz-history-row tz-chatfijo-row tz-chat-inbox-row">
                <button type="button" className="tz-chatfijo-btn" onClick={() => setPasajeroAbierto(pid)}>
                  <Avatar foto={fotosPorId[pid]} nombre={nombre} />
                  <span className="tz-chatfijo-texto">
                    <span className="tz-chatfijo-nombre">
                      {nombre}
                      <span className={`tz-chatneg-estado ${enCurso ? "is-en-linea" : ""}`}>{enCurso ? "Viaje en curso" : "Negociando"}</span>
                    </span>
                    <span className="tz-chatfijo-preview">{previaMensaje(h?.ultimo?.mensaje) || "Sin mensajes todavía"}</span>
                  </span>
                  <span className="tz-chatfijo-meta">
                    <span className="tz-chatfijo-hora">{horaCorta(h?.ultimo?.created_at)}</span>
                    {h?.noLeidos > 0 && <span className="tz-chatfijo-badge">{h.noLeidos > 9 ? "+9" : h.noLeidos}</span>}
                  </span>
                </button>
              </li>
            );
              }),
            ])}
        </ul>
      )}
        </>
      )}
    </>
  );
}

export default function ConductorChatInboxModal({ conductorId, pasajeroInicial, nivelServicio, iconoCategoriaUrl, plataforma, canalInicial, entregas, noLeidosEntregas, onEntregasCambio, entregaInicial, onClose }) {
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
                plataforma={plataforma}
                canalInicial={canalInicial}
                entregas={entregas}
                noLeidosEntregas={noLeidosEntregas}
                onEntregasCambio={onEntregasCambio}
                entregaInicial={entregaInicial}
              />
            </ChatErrorBoundary>
          )}
        </div>
      </div>
    </div>
  );
}
