import { useEffect, useRef, useState } from "react";
import { Send, ShieldAlert, Loader2, Plus, ChevronUp, ChevronDown } from "lucide-react";
import { formatTime, formatDate } from "../utils/format";
import { supabase } from "../supabaseClient";
import { canalViaje } from "../hooks/useGpsBroadcaster";
import {
  REMITENTE_PASAJERO,
  REMITENTE_CONDUCTOR,
  REMITENTE_SISTEMA,
  TIPO_MENSAJE_OFERTA,
  TIPO_MENSAJE_SISTEMA,
  TIPO_MENSAJE_SISTEMA_VIAJE,
  TIPO_MENSAJE_SENAS,
  ESTADO_OFERTA_PENDIENTE,
  ESTADO_OFERTA_ACEPTADA,
  ESTADO_OFERTA_RECHAZADA,
  ESTADO_OFERTA_CANCELADA,
  ESTADO_OFERTA_EN_TRANSITO,
  ESTADO_OFERTA_FINALIZADO,
} from "../hooks/useChatMensajes";
import { MAPA_NIVEL_COLOR } from "../lib/nivelServicio";
import MapaViaje from "./MapaViaje";
import logo from "../assets/logo.png";

const TARIFAS_RAPIDAS = ["S/ 1.50", "S/ 3.00", "S/ 4.50"];
// Monto mínimo aceptado en la tarifa personalizada — "0" o negativo
// sería literalmente un viaje gratis por accidente.
const TARIFA_CUSTOM_MIN = 0.5;
// Distancia (metros) al destino a partir de la cual se dispara el
// aviso de proximidad + se recicla el botón de Cancelar -> Finalizar.
const DISTANCIA_PROXIMIDAD_M = 50;
// Regla de Doble Proximidad — "Pasajero Recogido" no se puede tocar
// hasta que el conductor esté a menos de esto del punto de recojo.
const DISTANCIA_RECOJO_M = 100;
// "Tonazo" (Pasajero, botón del logo) — tope por viaje. `ChatWindow` se
// vuelve a montar de cero en cada chat nuevo (ChatModal.jsx), así que el
// contador arranca en 0 solo, sin necesitar persistirlo aparte.
const MAX_ZUMBIDOS = 5;
const TEXTO_ZUMBIDO = "🔔 ¡Estoy aquí! Apúrate por favor";
// Anti-Spam: además del tope de 5 por viaje, cada toque bloquea el botón
// por este tiempo — sin esto, alguien podía mandar los 5 avisos de
// golpe en un segundo.
const TONAZO_COOLDOWN_S = 10;
// UX de Mensajes de Sistema + Cronómetro: textos fijos, se matchean
// literal (mismo criterio que ya usa la detección de cancelación acá
// abajo) para saber CUÁL de las dos burbujas TIPO_MENSAJE_SISTEMA_VIAJE
// es — el inicio (lleva el Cronómetro corriendo) o el cierre (muestra
// fecha/hora + tiempo total ya congelado).
const TEXTO_VIAJE_INICIADO = "🚀 Viaje Iniciado";
const TEXTO_VIAJE_FINALIZADO = "🏁 Viaje Finalizado";

// Cronómetro en vivo — vive DENTRO de la burbuja "🚀 Viaje Iniciado"
// (ver TarjetaEstadoViaje) MIENTRAS el viaje sigue activo. Ya no conoce
// `finISO`: Fix Cronómetro Infinito — en vez de "congelarse" quedándose
// montado con un valor fijo, TarjetaEstadoViaje directamente DEJA DE
// MONTARLO en cuanto el viaje termina (ver el `finISO ? ... : <Cronometro/>`
// de abajo) y lo reemplaza por un texto estático — así el `useEffect` de
// acá corre su `return () => clearInterval(intervalId)` por el camino
// normal de desmontaje de React, no por una rama condicional interna.
function Cronometro({ inicioISO }) {
  const [ahora, setAhora] = useState(Date.now());

  useEffect(() => {
    const intervalId = setInterval(() => setAhora(Date.now()), 1000);
    // Fix Sincronización Fase 3: los navegadores (sobre todo en
    // celular) throttlean/pausan los `setInterval` de una pestaña en
    // background — al volver (cambiar de app y regresar, desbloquear
    // la pantalla), el próximo tick natural puede tardar varios
    // segundos, mostrando un número "congelado" un instante. Este
    // listener fuerza un recálculo INMEDIATO apenas la pestaña vuelve a
    // estar visible, sin esperar al próximo tick del interval.
    const alVolverVisible = () => {
      if (document.visibilityState === "visible") setAhora(Date.now());
    };
    document.addEventListener("visibilitychange", alVolverVisible);
    // ClearInterval obligatorio: sin esto, cerrar el chat (o que el
    // viaje termine y este componente se desmonte) deja un setInterval
    // corriendo para siempre sobre un componente que ya no existe.
    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", alVolverVisible);
    };
  }, []);

  // Fuente de verdad única: SIEMPRE se resta contra `inicioISO` (el
  // `viaje_inicio_at`/`created_at` real de Supabase, nunca un contador
  // local que se va sumando) — el `setInterval` de arriba solo dispara
  // un re-render por segundo, `ahora` nunca se usa para ACUMULAR nada.
  // Así el Conductor y el Pasajero, aunque uno haya recargado la
  // página hace rato y el otro recién abrió el chat, calculan el mismo
  // `transcurridoSeg` a partir del mismo timestamp fijo — no hay forma
  // de que un `setInterval` "ciego" los desincronice, porque ninguno de
  // los dos depende de cuántos ticks ya corrieron, solo de la hora
  // actual del dispositivo menos esa fecha real.
  const inicioMs = new Date(inicioISO).getTime();
  const transcurridoSeg = Math.max(0, Math.floor((ahora - inicioMs) / 1000));
  const min = Math.floor(transcurridoSeg / 60);
  const seg = transcurridoSeg % 60;

  return (
    <span className="tz-chat-cronometro">
      ⏱ {String(min).padStart(2, "0")}:{String(seg).padStart(2, "0")}
    </span>
  );
}

// "12m 05s" — formato largo pedido para el resumen estático de cierre,
// distinto del "⏱ 12:05" que muestra el Cronómetro corriendo.
function formatDuracionLarga(ms) {
  const totalSeg = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  return `${min}m ${String(seg).padStart(2, "0")}s`;
}

// Refactor: Tarjeta Neón Única y Mutante — UN SOLO mensaje/componente
// para todo el ciclo de vida del viaje en curso, no dos burbujas
// separadas. `mensaje.created_at` es el inicio real (siempre);
// `mensaje.viaje_fin_at` (columna nueva, ver marcarFinDeViaje en
// useChatMensajes.js) es null mientras el viaje sigue y se llena con un
// UPDATE sobre esta MISMA fila al finalizar — el componente muta su
// propio texto/detalle en cuanto ese campo deja de ser null, sin
// insertar ni buscar ningún mensaje aparte para el cierre.
// `finOverrideISO`: ver el fix de sincronización en el cuerpo de
// ChatWindow — cubre el instante entre "ya se confirmó en la base" y
// "ya llegó por postgres_changes/Broadcast", para que el propio
// Conductor (que acaba de tocar el botón) y el Pasajero (que lo recibe
// por Broadcast) no se queden mirando un Cronómetro que ya debería
// haberse detenido.
// `enCursoPermitido`: Fix Cronómetro Fantasma (datos históricos rotos)
// — `viaje_fin_at === null` NO alcanza para decidir "sigue corriendo".
// El historial es de por vida (un hilo = todos los viajes de ese par
// conductor/pasajero) y bugs de rondas anteriores dejaron filas viejas
// de "🚀 Viaje Iniciado" sin cerrar nunca (`viaje_fin_at` nunca se
// llenó). Sin esta bandera, CUALQUIERA de esas filas rotas revivía un
// Cronómetro infinito con solo abrir el chat, sin importar que la
// oferta MÁS RECIENTE del hilo ya estuviera finalizada/cancelada/
// rechazada. Ahora "sigue corriendo" exige ADEMÁS que esta fila sea la
// del ciclo vigente de verdad (lo decide ChatWindow, ver
// `mensajeInicioViaje`/`estadoOfertaVigente` en el punto de llamada) —
// cualquier otra fila sin `viaje_fin_at` real se pinta como cerrada,
// aunque no haya un timestamp de cierre real que mostrarle.
function TarjetaEstadoViaje({ mensaje, finOverrideISO, enCursoPermitido }) {
  const inicioISO = mensaje?.created_at;
  if (!inicioISO) return null;
  const finReal = mensaje?.viaje_fin_at ?? finOverrideISO ?? null;
  const enCurso = !finReal && enCursoPermitido;

  return (
    <div className="tz-chat-bubble tz-chat-bubble-sistema-viaje">
      <p>{enCurso ? TEXTO_VIAJE_INICIADO : TEXTO_VIAJE_FINALIZADO}</p>
      <p className="tz-chat-viaje-cierre-detalle">
        Inicio: {formatDate(inicioISO)} {formatTime(inicioISO)}
      </p>
      {enCurso ? (
        // Fix Cronómetro Congelado (viajes secuenciales): `key={mensaje.id}`
        // obliga a React a desmontar y montar un Cronómetro totalmente
        // nuevo (con su propio setInterval limpio) cada vez que este
        // componente reciba el mensaje de un viaje DISTINTO — sin esto,
        // un segundo viaje seguido con el mismo conductor podía heredar
        // el closure de la instancia anterior en vez de arrancar de cero.
        <Cronometro key={mensaje.id} inicioISO={inicioISO} />
      ) : finReal ? (
        // Fix Cronómetro Infinito: nada de <Cronometro/> acá — se
        // desmontó por completo apenas `finReal` dejó de ser null. Este
        // texto es estático, una sola cuenta hecha con los dos
        // timestamps reales de la fila, no un valor "rescatado" de un
        // intervalo.
        <>
          <p className="tz-chat-viaje-cierre-detalle">
            Fin: {formatDate(finReal)} {formatTime(finReal)}
          </p>
          <span className="tz-chat-cronometro tz-chat-cronometro-final">
            Tiempo total: {formatDuracionLarga(new Date(finReal).getTime() - new Date(inicioISO).getTime())}
          </span>
        </>
      ) : (
        // Fila histórica rota: cerrada de verdad (no es el ciclo
        // vigente), pero nunca tuvo un `viaje_fin_at` real — no se
        // inventa una hora de cierre que no existe.
        <span className="tz-chat-cronometro tz-chat-cronometro-final">Viaje cerrado (sin registro de cierre)</span>
      )}
    </div>
  );
}

// Fase 2 de "Contratos Inteligentes": el estado real vive en
// `chat_mensajes.tipo`/`estado_oferta` (Supabase, ver useChatMensajes.js
// — responderOferta), ya no se adivina por el texto del mensaje.
//   - tipo='oferta' + estado_oferta='pendiente', visto por el Pasajero:
//     propuesta con Aceptar/Rechazar.
//   - tipo='oferta' + estado_oferta ya resuelto: los botones
//     desaparecen, queda el resultado en texto.
//   - tipo='sistema': aviso automático (ej. "El pasajero rechazó la
//     tarifa"), burbuja centrada neutra, no pertenece a nadie.
// `estadoOferta` (no `mensaje.estado_oferta` directo): permite pisarlo
// con el valor OPTIMISTA que fija ChatWindow apenas se toca el botón,
// para que Aceptar/Rechazar desaparezcan al toque en vez de esperar la
// vuelta de Supabase (ver ofertasLocales más abajo).
function MessageBubble({ mensaje, mine, esOfertaParaPasajero, estadoOferta, onResponder, respondiendo, finOverrideISO, enCursoPermitido }) {
  const texto = mensaje?.mensaje ?? "";
  const hora = mensaje?.created_at ? formatTime(mensaje.created_at) : "";

  if (mensaje?.tipo === TIPO_MENSAJE_SISTEMA) {
    return (
      <div className="tz-chat-bubble tz-chat-bubble-sistema">
        <p>{texto}</p>
      </div>
    );
  }

  // UX de Mensajes de Sistema Celeste Neón: reemplaza a los viejos
  // modales/paneles de "Viaje Finalizado" — vive como una burbuja más
  // del historial (ver TarjetaEstadoViaje arriba).
  if (mensaje?.tipo === TIPO_MENSAJE_SISTEMA_VIAJE) {
    return <TarjetaEstadoViaje mensaje={mensaje} finOverrideISO={finOverrideISO} enCursoPermitido={enCursoPermitido} />;
  }

  if (esOfertaParaPasajero) {
    // Fase 3: 'en_transito' y 'finalizado' faltaban acá — sin
    // agregarlos a "resuelta", el pasajero volvía a ver los botones
    // Aceptar/Rechazar apenas el conductor lo recogía o terminaba el
    // viaje (el chequeo original solo conocía aceptada/rechazada/
    // cancelada).
    const resuelta =
      estadoOferta === ESTADO_OFERTA_ACEPTADA ||
      estadoOferta === ESTADO_OFERTA_EN_TRANSITO ||
      estadoOferta === ESTADO_OFERTA_FINALIZADO ||
      estadoOferta === ESTADO_OFERTA_RECHAZADA ||
      estadoOferta === ESTADO_OFERTA_CANCELADA;
    return (
      <div className="tz-chat-bubble tz-chat-bubble-contrato">
        <p className="tz-chat-contrato-texto">
          El conductor propone: <strong>{texto}</strong>
        </p>
        {resuelta ? (
          <p
            className={`tz-chat-contrato-resultado ${
              estadoOferta === ESTADO_OFERTA_ACEPTADA || estadoOferta === ESTADO_OFERTA_EN_TRANSITO || estadoOferta === ESTADO_OFERTA_FINALIZADO
                ? "tz-chat-contrato-resultado-ok"
                : ""
            }`}
          >
            {estadoOferta === ESTADO_OFERTA_ACEPTADA
              ? "✅ Espera al conductor cerca a su ruta"
              : estadoOferta === ESTADO_OFERTA_EN_TRANSITO
              ? "🚗 En camino — ¡buen viaje!"
              : estadoOferta === ESTADO_OFERTA_FINALIZADO
              ? "🏁 Viaje finalizado"
              : estadoOferta === ESTADO_OFERTA_CANCELADA
              ? "⚠️ Viaje cancelado"
              : "❌ Oferta rechazada"}
          </p>
        ) : (
          <div className="tz-chat-contrato-acciones">
            <button
              type="button"
              className="tz-chat-contrato-btn tz-chat-contrato-aceptar"
              disabled={respondiendo}
              onClick={() => onResponder?.(mensaje.id, ESTADO_OFERTA_ACEPTADA)}
            >
              ✅ Aceptar
            </button>
            <button
              type="button"
              className="tz-chat-contrato-btn tz-chat-contrato-rechazar"
              disabled={respondiendo}
              onClick={() => onResponder?.(mensaje.id, ESTADO_OFERTA_RECHAZADA)}
            >
              ❌ Rechazar
            </button>
          </div>
        )}
        <span className="tz-chat-bubble-time">{hora}</span>
      </div>
    );
  }

  return (
    <div className={`tz-chat-bubble ${mine ? "tz-chat-bubble-mine" : ""}`}>
      <p>{texto}</p>
      <span className="tz-chat-bubble-time">{hora}</span>
    </div>
  );
}

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
// la base, son puramente efímeros. El layout (footer fijo + mensajes
// scrolleables) es el mismo de siempre, no se toca acá — lo único
// nuevo es el panel de "viaje iniciado" arriba de los mensajes.
export default function ChatWindow({
  mensajes,
  loading,
  remitentePropio,
  onEnviar,
  onResponderOferta,
  onCancelarViaje,
  onPasajeroRecogido,
  onFinalizarViaje,
  onMarcarFinDeViaje,
  onCerrarPorCancelacion,
  onLimpiarDestino,
  destino = null,
  conductorId,
  pasajeroId,
  nivelServicio,
  otroEscribiendo = false,
  onEscribiendo,
}) {
  const [texto, setTexto] = useState("");
  const [bloqueado, setBloqueado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [respondiendo, setRespondiendo] = useState(false);
  const [errorOferta, setErrorOferta] = useState("");
  const [confirmarCancelarOpen, setConfirmarCancelarOpen] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [marcandoRecogido, setMarcandoRecogido] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  // Negociación abierta (Conductor) — el "+" al lado de las 3 tarifas
  // fijas revela este input; nunca se envía sin pasar la validación de
  // enviarTarifaCustom (monto estrictamente > 0).
  const [mostrarInputTarifa, setMostrarInputTarifa] = useState(false);
  const [tarifaCustom, setTarifaCustom] = useState("");
  const [errorTarifaCustom, setErrorTarifaCustom] = useState("");
  // Distancia en vivo auto-destino (Haversine, calculada en
  // MapaViaje.jsx) — null hasta que haya conductor Y destino conocidos.
  const [distanciaDestino, setDistanciaDestino] = useState(null);
  // Regla de Doble Proximidad — la OTRA distancia (auto al punto de
  // recojo, no al destino), la que habilita "Pasajero Recogido".
  const [distanciaAlPasajero, setDistanciaAlPasajero] = useState(null);
  // Si el Pasajero YA tiene el pin del conductor en el mapa (Fase 2) —
  // apaga el spinner y cambia el texto a "Conductor en camino" en vez
  // de seguir diciendo "Buscando..." con datos que ya están.
  const [conductorLocalizado, setConductorLocalizado] = useState(false);
  // UX: colapsar/expandir el contenedor del mapa (+ los botones de
  // Google Maps/Waze) para dejarle más espacio visual al chat —
  // preferencia puramente local de ESTE visor, no se sincroniza con el
  // otro lado ni con la base. Arranca visible.
  const [isMapaVisible, setIsMapaVisible] = useState(true);
  // Overrides optimistas por id de mensaje — se fijan ANTES de que
  // Supabase confirme el update, para que Aceptar/Rechazar (y Cancelar
  // Viaje) desaparezcan/reaccionen al toque en vez de esperar la vuelta
  // de la red o del evento de Realtime. Si el update termina fallando,
  // se revierte.
  const [ofertasLocales, setOfertasLocales] = useState({});
  // Aviso temporal para quien NO tocó el botón — ve "El viaje fue
  // cancelado" un momento antes de que el chat se le cierre solo, para
  // que no se asuste si el modal desaparece de golpe.
  const [toastCancelacion, setToastCancelacion] = useState("");
  // Arranca ESTRICTAMENTE en false — solo debe pasar a true por un
  // mensaje de cancelación NUEVO llegado por Realtime durante la
  // sesión activa, nunca por leer el historial. Separado de
  // `toastCancelacion` (el texto a mostrar) para que el gatillo de
  // "esto es una cancelación de verdad" quede explícito y no mezclado
  // con el string del toast.
  const [viajeCancelado, setViajeCancelado] = useState(false);
  // Fix de Sincronización "Pasajero a Bordo": antes, el Pasajero solo se
  // enteraba de que lo recogieron cuando le llegaba el UPDATE de
  // `chat_mensajes` por postgres_changes (useChatMensajes.js) — normalmente
  // funciona, pero un evento explícito de Broadcast por el mismo canal
  // privado que ya usa MapaViaje.jsx para el GPS es inmediato y no
  // depende de que ese CDC entregue a tiempo. Puramente un acelerador:
  // la verdad de fondo sigue siendo `estado_oferta` en la base (si el
  // pasajero recarga la página, `pasajeroRecogido` ya sale bien solo con
  // los datos reales, sin necesitar este broadcast efímero).
  const [viajeEnTransito, setViajeEnTransito] = useState(false);
  // Fix Sincronización UI: estado explícito del viaje, seteado a mano
  // en DOS lugares — (a) el listener de Broadcast de abajo, apenas
  // llega el evento, sin esperar nada más; (b) el efecto que sigue a
  // `estadoOfertaVigente` (más abajo, una vez que existe), para que
  // también quede correcto tras un F5 o si el evento en vivo se
  // perdiera y solo llegara por postgres_changes. Nunca se pisa a un
  // valor "para atrás" — ver ese efecto.
  const [estadoViaje, setEstadoViaje] = useState(null);
  // Fix Cronómetro Infinito: override optimista de `viaje_fin_at`,
  // seteado en DOS lugares — (a) el propio Conductor, apenas confirma
  // el fin en la base (handleFinalizarViaje, no espera a que le vuelva
  // por postgres_changes); (b) el Pasajero, apenas le llega el Broadcast
  // "estado_viaje_actualizado" con estado 'finalizado'. Sin esto los dos
  // lados dependían 100% de que el UPDATE de chat_mensajes les llegara
  // por Realtime — si eso se demora (o nunca llega, ver las advertencias
  // de "falling back to REST API"), el Cronómetro seguía corriendo en
  // vivo mucho después de que el viaje ya había terminado de verdad.
  const [finViajeLocal, setFinViajeLocal] = useState(null);
  // Fix Sincronización del Pasajero (Cronómetro congelado sin F5): la
  // mitad simétrica de `finViajeLocal` — sin esto, aunque `viajeEnTransito`/
  // `estadoViaje` ya reaccionaban al Broadcast, la TARJETA con el
  // Cronómetro en sí solo aparecía cuando el mensaje real "🚀 Viaje
  // Iniciado" (insertado por el Conductor) terminaba de sincronizar por
  // postgres_changes — que es justo lo que podía demorarse o perderse.
  // Con este override, el Cronómetro arranca YA con el timestamp que
  // vino en el propio Broadcast, sin depender de ningún mensaje ni F5
  // (ver el render "sintético" más abajo, en el JSX del historial).
  const [inicioViajeLocal, setInicioViajeLocal] = useState(null);
  // "Tonazo" — alerta manual del Pasajero (reintroduce el viejo botón
  // del logo, ver TIPO_MENSAJE_SENAS), limitada a MAX_ZUMBIDOS por viaje
  // + un cooldown de TONAZO_COOLDOWN_S segundos entre toques.
  const [contadorZumbidos, setContadorZumbidos] = useState(0);
  const [enviandoZumbido, setEnviandoZumbido] = useState(false);
  const [cooldownZumbido, setCooldownZumbido] = useState(0);
  // Lógica de Negocio: toast temporal cuando se toca "Tonazo" sin
  // destino elegido — desaparece solo, mismo patrón que el resto de
  // los avisos de bloqueo de esta app (ej. avisoDestino en HomePage.jsx).
  const [avisoTonazo, setAvisoTonazo] = useState("");
  const cooldownIntervalRef = useRef(null);
  const canalViajeRef = useRef(null);
  const listRef = useRef(null);
  // Un solo aviso de proximidad por viaje — sin este guard, cada
  // recálculo de distancia (cada pocos segundos) intentaría mandar el
  // mensaje de nuevo mientras el auto siga a <50m.
  const avisoProximidadEnviadoRef = useRef(false);
  // true apenas ESTE lado confirma su propio "Cancelar Viaje" — el
  // listener de mensajes de abajo lo usa para no duplicar el cierre
  // (acá se cierra al toque, sin esperar el viaje de ida y vuelta a
  // Supabase ni mostrar un toast que no hace falta si fuiste vos mismo).
  const propiaCancelacionRef = useRef(false);
  // Arranca en null: "todavía no se estableció la línea de base del
  // historial" — así el listener de cancelación remota no dispara con
  // mensajes VIEJOS que ya estaban ahí al abrir el chat (ej. reabrís un
  // hilo de un viaje cancelado hace rato), solo con los que llegan
  // DESPUÉS.
  const idsVistosRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [mensajes, otroEscribiendo]);

  // Canal del evento explícito "estado_viaje_actualizado" — mismo topic
  // que el canal privado de GPS de MapaViaje.jsx (canalViaje), pero un
  // objeto de canal aparte: Supabase Realtime reparte los broadcasts por
  // TOPIC en el servidor, no importa qué objeto de canal del cliente los
  // mandó ni cuál escucha, así que no hace falta compartir la instancia
  // con MapaViaje. Se abre siempre que haya conductor/pasajero (no solo
  // en mostrarPanelViaje) para no perderse el evento si llega justo
  // cuando el panel recién está montando.
  useEffect(() => {
    if (!conductorId || !pasajeroId) return undefined;
    const channel = supabase.channel(canalViaje(conductorId, pasajeroId));
    channel.on("broadcast", { event: "estado_viaje_actualizado" }, ({ payload }) => {
      if (payload?.estado === ESTADO_OFERTA_ACEPTADA) {
        // Fix Falso Positivo (Fase 2): el Conductor recibe esto al
        // instante en que el Pasajero acepta una tarifa — sin esperar a
        // que el UPDATE de `estado_oferta` de esa fila sincronice por su
        // propia suscripción de postgres_changes, que es justo la
        // ventana donde los botones de cobro seguían disponibles un
        // rato de más ("los botones siguen apareciendo fuera de
        // tiempo").
        setEstadoViaje(ESTADO_OFERTA_ACEPTADA);
      }
      if (payload?.estado === ESTADO_OFERTA_CANCELADA) {
        // Fix Chat Post-Cancelación: mismo mecanismo que 'aceptada' —
        // avisa YA, sin depender de que la suscripción general de
        // postgres_changes sincronice el UPDATE de `estado_oferta` (que
        // es justo la ventana donde el otro lado seguía viendo los
        // botones de cobro/Señas activos apenas se cancelaba).
        setEstadoViaje(ESTADO_OFERTA_CANCELADA);
      }
      if (payload?.estado === ESTADO_OFERTA_EN_TRANSITO) {
        // Fix Sincronización UI: los DOS setState explícitos, sin
        // esperar ningún otro efecto — esto es lo que destraba la UI
        // (oculta "Tonazo", cambia el texto del panel) al instante, sin
        // mutar nada más y sin necesitar un F5.
        setViajeEnTransito(true);
        setEstadoViaje(ESTADO_OFERTA_EN_TRANSITO);
        // Fix Sincronización del Pasajero: el Cronómetro arranca con
        // ESTE timestamp (viaje_inicio_at en memoria), sin esperar a
        // que el mensaje "🚀 Viaje Iniciado" sincronice por
        // postgres_changes — ver el render sintético más abajo.
        setInicioViajeLocal(new Date(payload?.timestamp_inicio ?? Date.now()).toISOString());
      }
      if (payload?.estado === ESTADO_OFERTA_FINALIZADO) {
        // Fix Cronómetro Infinito: el lado que NO tocó el botón (el
        // Pasajero, normalmente) se entera acá — sin esperar el UPDATE
        // de chat_mensajes por postgres_changes, que es justo lo que
        // podía demorarse o perderse.
        setEstadoViaje(ESTADO_OFERTA_FINALIZADO);
        setFinViajeLocal(new Date(payload?.timestamp_fin ?? Date.now()).toISOString());
      }
    });
    channel.subscribe();
    canalViajeRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      canalViajeRef.current = null;
    };
  }, [conductorId, pasajeroId]);

  // Cancelación REMOTA — detecta cuándo llega (vía Realtime, no importa
  // si lo canceló el conductor o el pasajero) un mensaje de sistema
  // nuevo con "cancelado el viaje" y, si esta ventana NO fue la que
  // disparó esa cancelación (propiaCancelacionRef), pone
  // `viajeCancelado` en true.
  //
  // BUG real que corrijo acá: `mensajes` empieza en `[]` MIENTRAS
  // `loading` sigue en true (antes de que termine el fetch inicial) —
  // este efecto corría en esa primera pasada y tomaba ese array VACÍO
  // como línea de base. Cuando el historial de verdad llegaba después,
  // `idsVistosRef.current` ya NO era null (era el Set vacío de antes),
  // así que la rama "primera carga" se saltaba y TODO el historial real
  // se trataba como "recién llegado" — si ese hilo tenía una
  // cancelación vieja de un viaje anterior, `viajeCancelado` se ponía
  // en true al toque de abrir el chat. Ahora se ignora por completo
  // mientras `loading` sea true, y la línea de base se arma recién con
  // los datos reales.
  useEffect(() => {
    if (loading) return undefined;
    const idsActuales = new Set((mensajes ?? []).map((m) => m?.id).filter(Boolean));
    if (idsVistosRef.current === null) {
      // Primera vez que hay datos reales — línea de base, sin mirar su
      // CONTENIDO: un mensaje de cancelación que ya estuviera ahí nunca
      // debe contar, solo lo que llegue de acá en más.
      idsVistosRef.current = idsActuales;
      return undefined;
    }
    const nuevos = (mensajes ?? []).filter((m) => m?.id && !idsVistosRef.current.has(m.id));
    idsVistosRef.current = idsActuales;
    if (propiaCancelacionRef.current) return undefined;

    const avisoCancelacion = nuevos.find(
      (m) => m?.tipo === TIPO_MENSAJE_SISTEMA && (m?.mensaje ?? "").includes("cancelado el viaje")
    );
    if (avisoCancelacion) setViajeCancelado(true);
    return undefined;
  }, [mensajes, loading]);

  // Reacciona a viajeCancelado (no lo mezcla con la detección de
  // arriba): recién ACÁ se decide el texto del toast y se agenda el
  // cierre del modal. Limpieza de memoria (anti-reciclaje): esto cubre
  // el caso de que la cancelación la haya iniciado la OTRA persona —
  // `onLimpiarDestino` (solo existe del lado Pasajero, ver
  // ChatModal.jsx) se dispara igual, así el destino de la Home nunca
  // sobrevive a un viaje cancelado sin importar quién lo canceló.
  useEffect(() => {
    if (!viajeCancelado) return undefined;
    setToastCancelacion("El viaje fue cancelado");
    const timeoutId = setTimeout(() => {
      onLimpiarDestino?.();
      onCerrarPorCancelacion?.();
    }, 2200);
    return () => clearTimeout(timeoutId);
  }, [viajeCancelado, onCerrarPorCancelacion, onLimpiarDestino]);

  // Máquina de estados del viaje, reescrita en 3 fases explícitas (el
  // bug reportado: la UI se "adelantaba" porque antes esto solo sabía
  // reconocer "hay oferta aceptada o más" — nunca representaba la
  // Fase 1 de negociación como un estado real, así que cualquier chequeo
  // tipo "!pasajeroRecogido" mostraba de más cosas pensadas para la
  // Fase 2).
  //
  // `ofertaVigente` = la oferta MÁS RECIENTE del hilo que no haya sido
  // rechazada/cancelada — puede estar 'pendiente' (recién propuesta),
  // 'aceptada', 'en_transito' o 'finalizado'. Si la única oferta que
  // hay fue rechazada/cancelada, o todavía no se propuso ninguna,
  // `ofertaVigente` es undefined y el hilo está en Fase 1 igual (el
  // enunciado la define como "estado_oferta = 'pendiente' o null").
  const listaMensajes = mensajes ?? [];
  const ofertaVigente = [...listaMensajes]
    .reverse()
    .find((m) => {
      if (m?.tipo !== TIPO_MENSAJE_OFERTA) return false;
      const estado = ofertasLocales[m.id] ?? m?.estado_oferta;
      // Rechazar UNA tarifa nunca bloquea nada — el Conductor debe poder
      // proponer una nueva en el acto, en el mismo hilo, sin que el
      // pasajero tenga que "volver a llamar".
      if (estado === ESTADO_OFERTA_RECHAZADA) return false;
      if (estado === ESTADO_OFERTA_FINALIZADO || estado === ESTADO_OFERTA_CANCELADA) {
        // Bug de Modal "Fantasma" / Chat Post-Cancelación: mismo
        // conductor/pasajero comparten UN SOLO hilo de por vida — un
        // viaje finalizado o cancelado deja de contar como vigente
        // ÚNICAMENTE cuando ya hubo un "Hacer Señas"/auto-contacto NUEVO
        // después de ese cierre (`TIPO_MENSAJE_SENAS` — el mismo tipo
        // que usa tanto el auto-mensaje del Radar como el botón manual
        // de Tonazo, ver ChatModal.jsx/handleTonazo), porque ESO es lo
        // único que representa de verdad "el pasajero volvió a llamar
        // al conductor". Antes esto miraba "¿es el último mensaje del
        // hilo?" a secas — pero cancelar SIEMPRE inserta al toque un
        // aviso de sistema ("⚠️ ha cancelado el viaje"), así que ese
        // chequeo se abría solo en cuanto se cancelaba, sin que nadie
        // hubiera vuelto a pedir un taxi (el bug reportado: "el
        // conductor sigue teniendo acceso a escribir y mandar mensajes
        // directos" apenas se cancela). Un aviso de sistema no cuenta;
        // una llamada nueva sí.
        const idx = listaMensajes.indexOf(m);
        const hayLlamadaNueva = listaMensajes.slice(idx + 1).some((sig) => sig?.tipo === TIPO_MENSAJE_SENAS);
        if (hayLlamadaNueva) return false;
      }
      return true;
    });
  const estadoOfertaVigente = ofertaVigente ? ofertasLocales[ofertaVigente.id] ?? ofertaVigente.estado_oferta : null;

  // Fix Viaje Zombie: `viajeEnTransito`/`finViajeLocal`/`inicioViajeLocal`
  // (overrides optimistas de Broadcast, ver sus declaraciones más
  // arriba) y `estadoViaje` no se limpiaban solos — una vez que UN viaje
  // de este hilo ("conductor+pasajero comparten un hilo de por vida")
  // llegaba a 'en_transito'/'finalizado', esas señales quedaban pegadas
  // para siempre EN ESTE MONTAJE. Si el mismo par arrancaba una
  // negociación nueva después (oferta con un `id` distinto, o directo
  // sin ninguna oferta vigente todavía), heredaban el estado del viaje
  // VIEJO: el panel/mapa se reabría solo y, peor, `estadoViaje` seguía
  // marcando 'finalizado' aunque no hubiera oferta vigente que lo
  // sostenga — eso bloqueaba el botón de Señas (ver `viajeCerrado`
  // más abajo, depende de `estadoViaje`) justo cuando el pasajero
  // necesitaba pedir un taxi nuevo. Se resetea cada vez que cambia CUÁL
  // es la oferta vigente (id distinto = ciclo distinto, incluye pasar a
  // "ninguna") — declarado ANTES del efecto de sincronización de abajo
  // para que, si sí hay una oferta vigente real, ese efecto pueda pisar
  // este reseteo en el mismo commit con el estado verdadero.
  useEffect(() => {
    setEstadoViaje(null);
    setViajeEnTransito(false);
    setFinViajeLocal(null);
    setInicioViajeLocal(null);
  }, [ofertaVigente?.id]);

  // Fix Sincronización UI: mantiene `estadoViaje` alineado con la
  // verdad de la base — cubre tanto la carga inicial (recargaste a
  // mitad de viaje) como el caso de que el Broadcast de arriba se
  // haya perdido y la única señal que llegó fue el UPDATE de
  // chat_mensajes por postgres_changes.
  useEffect(() => {
    if (estadoOfertaVigente) setEstadoViaje(estadoOfertaVigente);
  }, [estadoOfertaVigente]);

  // Fase 1: Negociación — sin oferta vigente, o pendiente.
  // Fase 2: Aceptada — esperando el encuentro.
  // Fase 3: A bordo — 'en_transito' o 'finalizado'.
  const pasajeroRecogido = estadoOfertaVigente === ESTADO_OFERTA_EN_TRANSITO || estadoOfertaVigente === ESTADO_OFERTA_FINALIZADO;
  // Flag "efectivo" para la UI en vivo: verdadero ya sea por el estado
  // real (`pasajeroRecogido`, confirmado por Supabase) O por CUALQUIERA
  // de las señales optimistas de Broadcast (`viajeEnTransito`/
  // `estadoViaje`), lo que llegue primero. Movido ANTES de
  // `enNegociacion`/`viajeAceptado` (antes vivía más abajo) porque ESE
  // es justo el fix del "Falso Positivo al recoger pasajero": los
  // botones de cobro y el candado de Fase 1 dependían de
  // `estadoOfertaVigente` a secas, que viene 100% del realtime de la
  // FILA en la base — si el mensaje nuevo ("🚀 Viaje Iniciado") llegaba
  // por su propio canal ANTES que el UPDATE de `estado_oferta` de la
  // oferta terminara de sincronizar (dos suscripciones de Realtime
  // independientes, sin garantía de orden entre sí), había una ventana
  // real donde el hilo se veía "en curso" para unas cosas y "todavía
  // Fase 1/cerrado" para otras. Usar esta bandera (que además se
  // actualiza por Broadcast, instantáneo) en TODOS los booleanos de
  // abajo cierra esa ventana.
  const pasajeroABordo =
    pasajeroRecogido || viajeEnTransito || estadoViaje === ESTADO_OFERTA_EN_TRANSITO || estadoViaje === ESTADO_OFERTA_FINALIZADO;
  // Fix Falso Positivo (aceptar tarifa): mismo problema que arriba pero
  // para la transición pendiente -> aceptada — esa la dispara el
  // PASAJERO (responderOferta), y antes el Conductor recién se enteraba
  // cuando el mensaje de la oferta terminaba de sincronizar por
  // Realtime en su propia suscripción general. `estadoViaje` ahora
  // también se actualiza por Broadcast apenas se confirma la aceptación
  // (ver handleResponderOferta/el listener de `estado_viaje_actualizado`
  // más arriba), así que "aceptada" deja de depender de un solo canal.
  const viajeAceptado = estadoOfertaVigente === ESTADO_OFERTA_ACEPTADA || estadoViaje === ESTADO_OFERTA_ACEPTADA;
  // Fix Auto-Cierre del Panel: antes solo miraba `estadoOfertaVigente`
  // (derivado de `chat_mensajes` — necesita el UPDATE por postgres_changes
  // para actualizarse), por eso el Pasajero se quedaba con el panel+mapa
  // atascado hasta un F5 aunque `estadoViaje` ya hubiera cambiado al
  // instante por Broadcast. Con el OR de acá, `mostrarPanelViaje` (más
  // abajo) reacciona apenas llega CUALQUIERA de las dos señales.
  // Incluye `cancelada` (antes solo `finalizado`): un viaje cancelado
  // cierra el hilo exactamente igual que uno finalizado — hasta que
  // llegue una llamada nueva de verdad (ver `ofertaVigente` más arriba),
  // no antes.
  const viajeCerrado =
    estadoOfertaVigente === ESTADO_OFERTA_FINALIZADO ||
    estadoOfertaVigente === ESTADO_OFERTA_CANCELADA ||
    estadoViaje === ESTADO_OFERTA_FINALIZADO ||
    estadoViaje === ESTADO_OFERTA_CANCELADA;
  const enNegociacion = !viajeAceptado && !pasajeroABordo && !viajeCerrado;
  // Bloqueo de Mensaje Directo: el Conductor no debería poder proponer
  // una tarifa (respuesta rápida o monto libre) a un hilo vacío (nadie
  // pidió nada todavía), mientras ya hay un viaje en curso, ni mientras
  // el hilo está cerrado (`viajeCerrado` — finalizado O cancelado, ver
  // arriba: ESE es justo el fix de "el conductor sigue teniendo acceso a
  // escribir y mandar mensajes directos" apenas se cancela un viaje) —
  // "solicitud activa del pasajero" en este esquema es simplemente "el
  // hilo ya tiene algún mensaje" + "seguimos en negociación". Una oferta
  // RECHAZADA (distinto de cancelada) sigue sin bloquear nada — el
  // Conductor debe poder proponer una tarifa nueva ahí mismo, sin que el
  // pasajero tenga que volver a llamar.
  const puedeProponerTarifa = enNegociacion && listaMensajes.length > 0;

  // Ocultamiento estricto del mapa — `<MapaViaje/>` NO se monta en
  // absoluto durante Fase 0 (contacto) ni Fase 1 (negociación): recién
  // aparece cuando el pasajero acepta una tarifa (Fase 2) hasta que el
  // viaje EN CURSO termina. Una oferta cancelada/rechazada NUNCA cuenta
  // como `ofertaVigente` (ver más arriba), así que ese hilo vuelve a
  // `enNegociacion` solo y el panel directamente no se monta.
  //
  // UX de Mensajes de Sistema: los viejos modales/paneles de "Viaje
  // Finalizado" (con su propio botón "Cerrar") desaparecieron del todo
  // — `!viajeCerrado` acá abajo apaga el panel+mapa EN CUANTO el
  // viaje termina, sin esperar ningún click; el cierre real ahora vive
  // como una burbuja más del historial (ver MessageBubble/
  // TIPO_MENSAJE_SISTEMA_VIAJE), el chat sigue abierto y usable
  // normalmente después. La limpieza de memoria (destino global) que
  // antes disparaba ese botón ahora la dispara un efecto aparte, ver
  // más abajo.
  const mostrarPanelViaje = (viajeAceptado || pasajeroABordo) && !viajeCerrado;

  // Tarjeta Neón Única: se busca por CONTENIDO exacto (mismo criterio
  // que ya usa la detección de cancelación remota, más abajo) porque
  // comparte `tipo` con cualquier otro mensaje de viaje futuro. Esta
  // es la fila que "Finalizar Carrera" actualiza con `viaje_fin_at` en
  // vez de insertar un mensaje nuevo — ver handleFinalizarViaje.
  const mensajeInicioViaje = [...listaMensajes].reverse().find((m) => m?.tipo === TIPO_MENSAJE_SISTEMA_VIAJE && m?.mensaje === TEXTO_VIAJE_INICIADO);

  // Fix Definitivo de Sincronización — listener DIRECTO de
  // postgres_changes, además del canal de Broadcast de arriba. No existe
  // una tabla `viajes` separada en este esquema: el viaje EN CURSO ES
  // esta fila puntual de chat_mensajes (su estado_oferta), así que se
  // filtra directo por el `id` exacto de la oferta vigente — mucho más
  // angosto que la suscripción amplia por conductor_id que ya mantiene
  // useChatMensajes.js. A propósito redundante con el Broadcast: si
  // Supabase Realtime falla para uno de los dos mecanismos, el otro
  // sigue funcionando.
  useEffect(() => {
    if (!ofertaVigente?.id) return undefined;
    const canal = supabase
      .channel(`chat-mensaje-oferta-directo-${ofertaVigente.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_mensajes", filter: `id=eq.${ofertaVigente.id}` },
        ({ new: fila }) => {
          if (fila?.estado_oferta === ESTADO_OFERTA_EN_TRANSITO) {
            setViajeEnTransito(true);
            setEstadoViaje(ESTADO_OFERTA_EN_TRANSITO);
          }
          if (fila?.estado_oferta === ESTADO_OFERTA_FINALIZADO) {
            setEstadoViaje(ESTADO_OFERTA_FINALIZADO);
          }
        }
      )
      .subscribe();
    return () => supabase.removeChannel(canal);
  }, [ofertaVigente?.id]);

  // Mismo criterio que arriba, pero para la fila del mensaje "🚀 Viaje
  // Iniciado" en sí — es la que de verdad carga `viaje_fin_at` (columna
  // nueva, ver marcarFinDeViaje en useChatMensajes.js). Sin este
  // listener, el Cronómetro solo se congelaba cuando llegaba el
  // Broadcast de fin de viaje o cuando useChatMensajes.js sincronizaba
  // el UPDATE por su cuenta — ahora hay una TERCERA vía directa.
  useEffect(() => {
    if (!mensajeInicioViaje?.id) return undefined;
    const canal = supabase
      .channel(`chat-mensaje-inicio-directo-${mensajeInicioViaje.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_mensajes", filter: `id=eq.${mensajeInicioViaje.id}` },
        ({ new: fila }) => {
          if (fila?.viaje_fin_at) setFinViajeLocal(fila.viaje_fin_at);
        }
      )
      .subscribe();
    return () => supabase.removeChannel(canal);
  }, [mensajeInicioViaje?.id]);

  // Limpieza Absoluta de Memoria: sin el botón "Cerrar" de antes, esto
  // es lo que ahora dispara el reseteo del destino global apenas el
  // viaje termina — no hace falta ninguna acción del pasajero.
  // `onLimpiarDestino` es idempotente (setDestino(null) de nuevo no
  // rompe nada), así que no hace falta guardia de "una sola vez".
  useEffect(() => {
    if (viajeCerrado) onLimpiarDestino?.();
  }, [viajeCerrado, onLimpiarDestino]);

  // Color de categoría (VIP/Premium/Ejecutivo/Económico) para el glow
  // del pin y la línea de ruta en MapaViaje.jsx — hex fijos
  // (MAPA_NIVEL_COLOR, lib/nivelServicio.js), no `var(--cyan)` etc.:
  // un divIcon de Leaflet es HTML inyectado fuera de React, y se pidió
  // explícito código de color estable ahí en vez de depender de que la
  // custom property se resuelva bien.
  const colorCategoria = MAPA_NIVEL_COLOR[nivelServicio] || MAPA_NIVEL_COLOR.economico;
  // Habilita "Pasajero Recogido" — Regla de Doble Proximidad: mientras
  // el GPS siga sin resolver (null) o el conductor esté a 100m o más,
  // el botón queda deshabilitado.
  const puedeRecogerPasajero = distanciaAlPasajero != null && distanciaAlPasajero < DISTANCIA_RECOJO_M;

  // Limpieza del "Destino Fantasma": el destino viaja pegado al mensaje
  // de auto-contacto que arrancó el hilo (ver ChatModal.jsx) — se busca
  // en el propio historial en vez de pasarlo como prop aparte, así sigue
  // disponible aunque se reabra el chat más tarde. Pero un mismo
  // conductor/pasajero comparten UN SOLO hilo de por vida (Bloqueo de
  // Reconexión, ver ChatModal.jsx): si hubo un viaje viejo cancelado con
  // OTRO destino antes de este, el historial tiene MÁS de un mensaje con
  // destino_lat/lng. El de más reciente es el de la sesión activa — el
  // `<Polyline/>` de MapaViaje.jsx no debe trazar hacia un destino viejo
  // solo porque fue el primero en insertarse.
  const mensajeConDestino = [...listaMensajes].reverse().find((m) => m?.destino_lat != null && m?.destino_lng != null);
  const destinoConocido = mensajeConDestino ? { lat: mensajeConDestino.destino_lat, lon: mensajeConDestino.destino_lng } : null;
  // Persistencia de la Ubicación del Pasajero (Fix del Atasco del
  // Conductor): mismo criterio exacto que destino arriba — el mensaje
  // MÁS RECIENTE con origen_lat/lng, nunca el primero, por la misma
  // razón (un hilo reciclado de un viaje viejo no debe pisar el punto
  // de recojo de la sesión activa). MapaViaje.jsx la usa para sembrar
  // el pin del Pasajero del lado del Conductor sin depender 100% de
  // que llegue el primer Broadcast.
  const mensajeConOrigen = [...listaMensajes].reverse().find((m) => m?.origen_lat != null && m?.origen_lng != null);
  const origenConocido = mensajeConOrigen ? { lat: mensajeConOrigen.origen_lat, lon: mensajeConOrigen.origen_lng } : null;
  // El pin de destino (y la proximidad que depende de él, ver
  // cercaDeDestino más abajo) es cosa de 'en_transito' en adelante —
  // antes de recoger al pasajero el auto va HACIA ÉL, no hacia el
  // destino final; mostrar la bandera del destino en esa etapa habría
  // sido visualmente incorrecto. Extirpación Total de OSRM: ya no hay
  // ninguna ruta que trazar hacia acá, solo el pin.
  const destinoViaje = pasajeroABordo ? destinoConocido : null;

  const cercaDeDestino = distanciaDestino != null && distanciaDestino < DISTANCIA_PROXIMIDAD_M;

  // Aviso de proximidad — SOLO el Conductor lo dispara (su lado es el
  // que de verdad se está moviendo hacia el destino); el Pasajero lo
  // ve igual apenas llega porque es el mismo hilo compartido.
  useEffect(() => {
    if (remitentePropio !== REMITENTE_CONDUCTOR) return;
    if (!cercaDeDestino || avisoProximidadEnviadoRef.current || !pasajeroRecogido || viajeCerrado) return;
    avisoProximidadEnviadoRef.current = true;
    onEnviar?.(REMITENTE_SISTEMA, "📍 Estás cerca de tu destino", { tipo: TIPO_MENSAJE_SISTEMA });
  }, [remitentePropio, cercaDeDestino, pasajeroRecogido, viajeCerrado, onEnviar]);

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

  // Limpieza del intervalo del cooldown si el chat se cierra a mitad de
  // la cuenta regresiva — sin esto, el interval sigue vivo llamando a
  // setState de un componente ya desmontado.
  useEffect(() => {
    return () => clearInterval(cooldownIntervalRef.current);
  }, []);

  // "Tonazo" (solo Pasajero) — reutiliza TIPO_MENSAJE_SENAS a propósito:
  // la alerta de pantalla completa del Conductor (alertaSenas, ver
  // useHilosChatConductor en useChatMensajes.js) ya escucha cualquier
  // INSERT con ese tipo, así que no hace falta tocar nada del lado del
  // Conductor para que esto dispare la misma intrusiva de siempre. Tope
  // de MAX_ZUMBIDOS por viaje — el contador solo sube si el envío
  // realmente se confirmó, para no gastar un uso en un insert fallido.
  // Anti-Spam: el cooldown de TONAZO_COOLDOWN_S también arranca recién
  // ahí, nunca antes de confirmar el envío.
  // Lógica de Negocio: bloqueo estricto sin destino — el auto-mensaje
  // de contacto (ChatModal.jsx) arma su texto con `destino.nombre`, así
  // que avisar al conductor sin haber elegido destino todavía no tiene
  // con qué completarse bien. Chequeo PRIMERO (antes que cualquier otra
  // condición de guard) para que el toast se vea incluso si el botón
  // ya estaba deshabilitado por otra razón.
  const handleTonazo = async () => {
    if (remitentePropio !== REMITENTE_PASAJERO) return;
    if (!destino) {
      setAvisoTonazo("📍 Selecciona tu destino antes de avisar al conductor");
      setTimeout(() => setAvisoTonazo(""), 3500);
      return;
    }
    if (enviandoZumbido || cooldownZumbido > 0 || contadorZumbidos >= MAX_ZUMBIDOS) return;
    setEnviandoZumbido(true);
    const { error } = (await onEnviar?.(remitentePropio, TEXTO_ZUMBIDO, { tipo: TIPO_MENSAJE_SENAS })) ?? {};
    setEnviandoZumbido(false);
    if (error) return;
    setContadorZumbidos((n) => n + 1);
    setCooldownZumbido(TONAZO_COOLDOWN_S);
    clearInterval(cooldownIntervalRef.current);
    cooldownIntervalRef.current = setInterval(() => {
      setCooldownZumbido((s) => {
        if (s <= 1) {
          clearInterval(cooldownIntervalRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  // Tarifa rápida (Conductor) — a diferencia de "Hacer Señas", esto SÍ
  // manda tipo/estado_oferta (ver enviarMensaje en useChatMensajes.js),
  // es lo que arma la propuesta de tarifa del lado del Pasajero.
  //
  // BUG real que corrijo acá: el `{error}` que devuelve `onEnviar` se
  // descartaba por completo — si el insert fallaba (RLS, red, lo que
  // sea), el conductor no se enteraba de nada: el spinner del botón
  // simplemente se apagaba y la "encuesta" nunca le aparecía al
  // pasajero, sin ningún indicio de que algo salió mal. Devuelve el
  // resultado para que quien llama (enviarTarifaCustom) también pueda
  // reaccionar.
  const enviarOferta = async (tarifa) => {
    if (enviando) return { error: null };
    setEnviando(true);
    const { error } = (await onEnviar(remitentePropio, tarifa, { tipo: TIPO_MENSAJE_OFERTA, estado_oferta: ESTADO_OFERTA_PENDIENTE })) ?? {};
    setEnviando(false);
    if (error) {
      console.error("Error al enviar la oferta de tarifa:", error);
      setErrorOferta("No se pudo enviar la tarifa. Intenta de nuevo.");
    }
    return { error };
  };

  // Negociación abierta — candado real (no solo el `min` del input,
  // que un navegador no siempre hace cumplir sin un <form> nativo):
  // texto vacío, no-numérico, cero o negativo se rechazan ACÁ, antes de
  // llamar a enviarOferta. "0 o negativo" literalmente sería regalar
  // el viaje por un dedo que resbaló en la pantalla.
  const enviarTarifaCustom = async () => {
    const valor = Number(tarifaCustom);
    if (!tarifaCustom.trim() || Number.isNaN(valor) || valor <= 0) {
      setErrorTarifaCustom("Ingresa un monto válido, mayor a 0.");
      return;
    }
    setErrorTarifaCustom("");
    // Si falló, el input/form se quedan tal cual (no se limpian solos)
    // para que el conductor pueda reintentar sin volver a escribir el
    // monto — antes se cerraba igual, como si hubiera salido bien.
    const { error } = await enviarOferta(`S/ ${valor.toFixed(2)}`);
    if (error) return;
    setTarifaCustom("");
    setMostrarInputTarifa(false);
  };

  const handleResponderOferta = async (mensajeId, nuevoEstado) => {
    if (respondiendo) return;
    setRespondiendo(true);
    setErrorOferta("");
    // Optimista primero: el pasajero ve el resultado YA, sin esperar el
    // viaje de ida y vuelta a Supabase.
    setOfertasLocales((prev) => ({ ...prev, [mensajeId]: nuevoEstado }));
    const { error } = (await onResponderOferta?.(mensajeId, nuevoEstado)) ?? {};
    if (error) {
      // Si de verdad falló, se revierte — mostrar "Aceptada" a un
      // pasajero cuando la base rechazó el cambio sería peor que el
      // glitch que había antes.
      setOfertasLocales((prev) => {
        const copia = { ...prev };
        delete copia[mensajeId];
        return copia;
      });
      setErrorOferta("No se pudo enviar tu respuesta. Intenta de nuevo.");
    } else if (nuevoEstado === ESTADO_OFERTA_ACEPTADA) {
      // Fix Falso Positivo (Fase 2): avisa al Conductor YA por el canal
      // privado, mismo patrón que ya usa "Pasajero Recogido"/"Finalizar
      // Carrera" más abajo — sin esto, el Conductor solo se enteraba de
      // la aceptación cuando esta MISMA fila terminaba de sincronizar
      // por su suscripción general de postgres_changes, y hasta ese
      // momento sus botones de cobro seguían activos.
      setEstadoViaje(ESTADO_OFERTA_ACEPTADA);
      const payload = { estado: ESTADO_OFERTA_ACEPTADA };
      if (canalViajeRef.current) {
        canalViajeRef.current.send({ type: "broadcast", event: "estado_viaje_actualizado", payload });
      } else {
        console.error("canalViajeRef no estaba listo — abriendo canal de emergencia para el broadcast.");
        const canalEmergencia = supabase.channel(canalViaje(conductorId, pasajeroId));
        canalEmergencia.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            canalEmergencia.send({ type: "broadcast", event: "estado_viaje_actualizado", payload });
            setTimeout(() => supabase.removeChannel(canalEmergencia), 2000);
          }
        });
      }
    }
    setRespondiendo(false);
  };

  // Cancelar Viaje — ahora de los dos lados (Pasajero Y Conductor).
  // Solo dispara con la confirmación del modal (ver JSX abajo), nunca
  // directo desde el botón rojo. `remitentePropio` viaja al hook para
  // que el aviso de sistema diga quién canceló de verdad.
  //
  // Efectos secundarios al cancelar (LOCAL, este mismo lado): antes el
  // mensaje de aviso quedaba en el historial pero nada más pasaba — el
  // modal se quedaba atascado en la fase vieja. Ahora, si la cancelación
  // se confirma bien, se cierra ESTE chat al toque (onCerrarPorCancelacion
  // — destruye el componente entero: MapaViaje se desmonta solo, y con
  // él su canal privado de Broadcast; no hace falta "resetear" cada
  // estado local a mano, dejan de existir junto con el componente). El
  // conductor vuelve a 'Libre' del lado del hook (cancelarViaje en
  // useChatMensajes.js ya pone estado:'activo' + asientos_ocupados:0),
  // lo que hace que useGpsBroadcaster.js retome la transmisión al radar
  // público solo, sin que haga falta tocar nada más acá.
  const handleConfirmarCancelar = async () => {
    if (cancelando) return;
    setCancelando(true);
    propiaCancelacionRef.current = true;
    if (ofertaVigente) {
      setOfertasLocales((prev) => ({ ...prev, [ofertaVigente.id]: ESTADO_OFERTA_CANCELADA }));
    }
    const { error } = (await onCancelarViaje?.(ofertaVigente?.id, remitentePropio)) ?? {};
    setCancelando(false);
    setConfirmarCancelarOpen(false);
    if (!error) {
      // Fix Chat Post-Cancelación: avisa al OTRO lado por el canal
      // privado, mismo patrón que "Pasajero Recogido"/"Finalizar
      // Carrera"/aceptar oferta — sin esto, mientras la suscripción
      // general de postgres_changes no sincronizara el UPDATE de
      // `estado_oferta`, el otro lado seguía viendo sus botones de
      // cobro/Señas activos un rato de más.
      if (ofertaVigente) {
        setEstadoViaje(ESTADO_OFERTA_CANCELADA);
        const payload = { estado: ESTADO_OFERTA_CANCELADA };
        if (canalViajeRef.current) {
          canalViajeRef.current.send({ type: "broadcast", event: "estado_viaje_actualizado", payload });
        } else {
          console.error("canalViajeRef no estaba listo — abriendo canal de emergencia para el broadcast.");
          const canalEmergencia = supabase.channel(canalViaje(conductorId, pasajeroId));
          canalEmergencia.subscribe((status) => {
            if (status === "SUBSCRIBED") {
              canalEmergencia.send({ type: "broadcast", event: "estado_viaje_actualizado", payload });
              setTimeout(() => supabase.removeChannel(canalEmergencia), 2000);
            }
          });
        }
      }
      onLimpiarDestino?.();
      onCerrarPorCancelacion?.();
    } else {
      propiaCancelacionRef.current = false;
    }
  };

  // "✅ Pasajero Recogido" (solo Conductor, Fase 2 -> Fase 3) — pasa la
  // oferta a 'en_transito', lo que apaga el pin del pasajero en
  // MapaViaje y le suma un asiento ocupado (ver marcarPasajeroRecogido
  // en useChatMensajes.js). `puedeRecogerPasajero` ya deshabilita el
  // botón en el JSX, pero se revalida acá también — un click disparado
  // por algo que no sea el propio botón (ej. Enter en un input
  // enfocado) no debería poder saltarse la regla de <100m.
  const handlePasajeroRecogido = async () => {
    if (!ofertaVigente || marcandoRecogido || !puedeRecogerPasajero) return;
    setMarcandoRecogido(true);
    setOfertasLocales((prev) => ({ ...prev, [ofertaVigente.id]: ESTADO_OFERTA_EN_TRANSITO }));
    const { error } = (await onPasajeroRecogido?.(ofertaVigente.id)) ?? {};
    if (error) {
      setOfertasLocales((prev) => {
        const copia = { ...prev };
        delete copia[ofertaVigente.id];
        return copia;
      });
      setErrorOferta("No se pudo marcar al pasajero como recogido. Intenta de nuevo.");
    } else {
      // Fix de Sincronización en Tiempo Real: avisa al Pasajero YA por
      // el canal privado, en vez de dejar que se entere solo cuando le
      // llegue el UPDATE de chat_mensajes por postgres_changes. Solo se
      // manda si la base de verdad confirmó el cambio (nunca antes del
      // `if`). `timestamp_inicio` viaja en el payload y el Pasajero lo
      // usa como origen del Cronómetro (inicioViajeLocal, ver el
      // listener más arriba) mientras el mensaje real "🚀 Viaje
      // Iniciado" no haya terminado de sincronizar por postgres_changes.
      setEstadoViaje(ESTADO_OFERTA_EN_TRANSITO);
      const payload = { estado: ESTADO_OFERTA_EN_TRANSITO, timestamp_inicio: Date.now() };
      if (canalViajeRef.current) {
        canalViajeRef.current.send({ type: "broadcast", event: "estado_viaje_actualizado", payload });
      } else {
        // Red de seguridad: si por lo que sea el canal persistente
        // (efecto de arriba) todavía no estaba listo en este instante,
        // se abre uno de emergencia solo para este envío — mejor
        // loggear el caso raro y reintentar por otra vía que dejar al
        // pasajero sin el aviso hasta que recargue.
        console.error("canalViajeRef no estaba listo — abriendo canal de emergencia para el broadcast.");
        const canalEmergencia = supabase.channel(canalViaje(conductorId, pasajeroId));
        canalEmergencia.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            canalEmergencia.send({ type: "broadcast", event: "estado_viaje_actualizado", payload });
            setTimeout(() => supabase.removeChannel(canalEmergencia), 2000);
          }
        });
      }
      // UX de Mensajes de Sistema: la burbuja celeste neón con el
      // Cronómetro — se manda como un mensaje más del hilo (no un
      // estado aparte), así queda en el historial de los dos lados para
      // siempre, sobrevive a un F5 y no depende de que el Broadcast de
      // arriba llegue a tiempo.
      onEnviar?.(REMITENTE_SISTEMA, TEXTO_VIAJE_INICIADO, { tipo: TIPO_MENSAJE_SISTEMA_VIAJE });
    }
    setMarcandoRecogido(false);
  };

  // "🏁 Finalizar Carrera" (solo Conductor, reemplaza a Cancelar cuando
  // cercaDeDestino) — estado terminal. Ya no dispara ninguna pantalla de
  // cierre aparte: Refactor Tarjeta Neón Única — el fin de viaje MUTA la
  // MISMA burbuja de inicio (ver TarjetaEstadoViaje/marcarFinDeViaje en
  // useChatMensajes.js) en vez de insertar un segundo mensaje.
  const handleFinalizarViaje = async () => {
    if (!ofertaVigente || finalizando) return;
    setFinalizando(true);
    setOfertasLocales((prev) => ({ ...prev, [ofertaVigente.id]: ESTADO_OFERTA_FINALIZADO }));
    const { error } = (await onFinalizarViaje?.(ofertaVigente.id)) ?? {};
    if (error) {
      setOfertasLocales((prev) => {
        const copia = { ...prev };
        delete copia[ofertaVigente.id];
        return copia;
      });
      setErrorOferta("No se pudo finalizar el viaje. Intenta de nuevo.");
    } else if (mensajeInicioViaje?.id) {
      // Un solo timestamp para las 3 cosas — la fila en la base, el
      // override optimista LOCAL (así el Conductor, que acaba de tocar
      // el botón, ve el Cronómetro detenerse ya mismo) y el Broadcast
      // (así el Pasajero también, sin esperar el UPDATE por
      // postgres_changes — Fix Cronómetro Infinito).
      const finISO = new Date().toISOString();
      const { error: finError } = (await onMarcarFinDeViaje?.(mensajeInicioViaje.id, finISO)) ?? {};
      if (finError) {
        console.error("No se pudo marcar el fin del viaje en la tarjeta:", finError);
      } else {
        setFinViajeLocal(finISO);
        // Fix Auto-Cierre del Panel — lado Conductor: explícito acá
        // también (aunque `ofertasLocales` ya adelantaba
        // `estadoOfertaVigente` al toque), para que `estadoViaje` sea
        // la señal uniforme que ambos lados actualizan al confirmar.
        setEstadoViaje(ESTADO_OFERTA_FINALIZADO);
        const payload = { estado: ESTADO_OFERTA_FINALIZADO, timestamp_fin: new Date(finISO).getTime() };
        if (canalViajeRef.current) {
          canalViajeRef.current.send({ type: "broadcast", event: "estado_viaje_actualizado", payload });
        } else {
          // Misma red de emergencia que "Pasajero Recogido" — mejor
          // abrir un canal aparte para este único envío que dejar al
          // Pasajero con el Cronómetro corriendo hasta que recargue.
          console.error("canalViajeRef no estaba listo — abriendo canal de emergencia para el broadcast de fin de viaje.");
          const canalEmergencia = supabase.channel(canalViaje(conductorId, pasajeroId));
          canalEmergencia.subscribe((status) => {
            if (status === "SUBSCRIBED") {
              canalEmergencia.send({ type: "broadcast", event: "estado_viaje_actualizado", payload });
              setTimeout(() => supabase.removeChannel(canalEmergencia), 2000);
            }
          });
        }
      }
    } else {
      // No debería pasar (Pasajero Recogido siempre manda este mensaje
      // primero), pero si por lo que sea no existe, mejor loggear que
      // fallar en silencio dejando la tarjeta sin fecha de cierre.
      console.error("No se encontró el mensaje de inicio de viaje para marcar su fin.");
    }
    setFinalizando(false);
  };

  return (
    <>
      <div className="tz-chat-window">
      {toastCancelacion && (
        <div className="tz-chat-toast" role="status">
          ⚠️ {toastCancelacion}
        </div>
      )}
      {/* mostrarPanelViaje ya excluye viajeCerrado (ver más arriba) —
         el mapa/panel se apaga solo en cuanto el viaje termina, el
         cierre queda como burbuja celeste neón en el historial. */}
      {mostrarPanelViaje && remitentePropio === REMITENTE_PASAJERO && (
        <div className="tz-chat-viaje-panel">
          {/* UX: colapsar el mapa — deja más lugar visible para el
             chat sin perder el panel de estado/botones de abajo. */}
          <button
            type="button"
            className="tz-chat-mapa-toggle-btn"
            onClick={() => setIsMapaVisible((v) => !v)}
            aria-label={isMapaVisible ? "Ocultar mapa" : "Mostrar mapa"}
            aria-expanded={isMapaVisible}
          >
            {isMapaVisible ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {isMapaVisible ? "Ocultar mapa" : "Mostrar mapa"}
          </button>
          {isMapaVisible && (
            <MapaViaje
              conductorId={conductorId}
              pasajeroId={pasajeroId}
              remitentePropio={remitentePropio}
              ocultarPasajero={pasajeroABordo}
              destino={destinoViaje}
              origenPasajero={origenConocido}
              colorCategoria={colorCategoria}
              onConductorLocalizado={setConductorLocalizado}
            />
          )}
          <div className="tz-chat-viaje-panel-info">
            {/* En tránsito: nada de spinner, texto fijo (ya está a
               bordo, no hay nada "cargando"). Si todavía no lo
               recogió pero el pin del conductor YA se está viendo
               en el mapa, tampoco tiene sentido seguir mostrando
               "Buscando..." con un spinner — esos datos ya llegaron. */}
            {!pasajeroABordo && (enNegociacion || !conductorLocalizado) && <Loader2 size={15} className="tz-spin" />}
            <span>
              {pasajeroABordo
                ? "✅ Pasajero a bordo - En ruta"
                : enNegociacion
                ? "Negociando tarifa…"
                : conductorLocalizado
                ? "Conductor en camino"
                : "Buscando ubicación del conductor…"}
            </span>
            <button type="button" className="tz-chat-cancelar-btn" onClick={() => setConfirmarCancelarOpen(true)}>
              Cancelar Viaje
            </button>
          </div>
        </div>
      )}
      {mostrarPanelViaje && remitentePropio === REMITENTE_CONDUCTOR && (
        <div className="tz-chat-viaje-panel tz-chat-viaje-panel-conductor">
          <button
            type="button"
            className="tz-chat-mapa-toggle-btn"
            onClick={() => setIsMapaVisible((v) => !v)}
            aria-label={isMapaVisible ? "Ocultar mapa" : "Mostrar mapa"}
            aria-expanded={isMapaVisible}
          >
            {isMapaVisible ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            {isMapaVisible ? "Ocultar mapa" : "Mostrar mapa"}
          </button>
          {/* A propósito NO se desmonta (solo se oculta con CSS, ver
             .tz-chat-mapa-oculto en Styles.jsx): del lado Conductor este
             mapa es quien calcula `onCercaDeDestino`/`onDistanciaPasajero`
             — la Regla de Doble Proximidad y el swap Cancelar/Finalizar
             siguen dependiendo de esos números aunque el mapa esté
             colapsado visualmente. Desmontarlo congelaría esos cálculos. */}
          <div className={isMapaVisible ? undefined : "tz-chat-mapa-oculto"}>
            <MapaViaje
              conductorId={conductorId}
              pasajeroId={pasajeroId}
              remitentePropio={remitentePropio}
              ocultarPasajero={pasajeroABordo}
              destino={destinoViaje}
              origenPasajero={origenConocido}
              colorCategoria={colorCategoria}
              onCercaDeDestino={setDistanciaDestino}
              onDistanciaPasajero={setDistanciaAlPasajero}
            />
          </div>
          <div className="tz-chat-viaje-panel-info">
            {/* En tránsito: sin spinner, texto fijo — mismo criterio
               y mismo texto exacto que del lado del Pasajero. */}
            {!pasajeroABordo && <Loader2 size={15} className="tz-spin" />}
            <span>
              {pasajeroABordo
                ? "✅ Pasajero a bordo - En ruta"
                : enNegociacion
                ? "Negociando tarifa…"
                : "Viaje Confirmado — Geolocalizando pasajero…"}
            </span>
            {/* Navegación Externa: reemplaza al trazado interno de OSRM
               (Extirpación Total de OSRM) — en vez de dibujar una ruta
               adentro de esta app, el Conductor navega con la app que
               ya usa a diario. Solo visible en_transito (pasajeroABordo)
               y con destino conocido — antes de recoger al pasajero no
               hay destino todavía (ver destinoViaje más arriba). */}
            {pasajeroABordo && destinoViaje && (
              <div className="tz-chat-nav-externa-row">
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${destinoViaje.lat},${destinoViaje.lon}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tz-chat-nav-externa-btn tz-chat-nav-maps-btn"
                >
                  🗺️ Navegar en Maps
                </a>
                <a
                  href={`https://waze.com/ul?ll=${destinoViaje.lat},${destinoViaje.lon}&navigate=yes`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tz-chat-nav-externa-btn tz-chat-nav-waze-btn"
                >
                  👻 Navegar en Waze
                </a>
              </div>
            )}
            {/* Fase 1 (negociación): este botón no debe existir —
               ni siquiera oculto por CSS, directamente no se monta.
               Recién aparece en Fase 2 (oferta aceptada). */}
            {viajeAceptado && (
              <button
                type="button"
                className="tz-chat-recogido-btn"
                disabled={marcandoRecogido || !puedeRecogerPasajero}
                onClick={handlePasajeroRecogido}
                title={puedeRecogerPasajero ? undefined : "Solo se puede marcar a menos de 100m del pasajero"}
              >
                {marcandoRecogido && <Loader2 size={13} className="tz-spin" />}
                ✅ Pasajero Recogido
              </button>
            )}
            {/* Autonomía del Conductor: antes esto era un ternario que
               intercambiaba Cancelar <-> Finalizar según `cercaDeDestino`
               (GPS) — depender del GPS para poder CERRAR un viaje es un
               candado real (falla de red, el pasajero se baja antes de
               llegar al pin exacto, señal débil, etc.) que podía dejar
               al conductor sin forma de finalizar. Ahora "Finalizar
               Carrera" está disponible todo el tiempo que el pasajero
               esté a bordo (`pasajeroABordo`, ni bien pasa a
               'en_transito'), sin esperar ninguna distancia — la
               responsabilidad de tocarlo en el momento correcto es 100%
               del conductor. `cercaDeDestino` sigue vivo SOLO como aviso
               visual (el mensaje "📍 Estás cerca de tu destino" de más
               arriba), ya no bloquea ni oculta ningún botón.
               "Cancelar Viaje" queda disponible en paralelo, no como
               alternativa exclusiva — sigue siendo la salida también
               antes de recoger al pasajero (Fase 2, `pasajeroABordo`
               todavía false acá). */}
            {pasajeroABordo && (
              <button type="button" className="tz-chat-finalizar-btn" disabled={finalizando} onClick={handleFinalizarViaje}>
                {finalizando && <Loader2 size={13} className="tz-spin" />}
                🏁 Finalizar Carrera
              </button>
            )}
            <button type="button" className="tz-chat-cancelar-btn" onClick={() => setConfirmarCancelarOpen(true)}>
              Cancelar Viaje
            </button>
          </div>
        </div>
      )}

      <div className={`tz-chat-messages ${mostrarPanelViaje && remitentePropio === REMITENTE_PASAJERO ? "tz-chat-messages-mini" : ""}`} ref={listRef}>
        {loading ? (
          <p className="tz-method-history-empty">Cargando chat…</p>
        ) : (mensajes ?? []).length === 0 ? (
          <p className="tz-method-history-empty">Todavía no hay mensajes. Escribe el primero.</p>
        ) : (
          (mensajes ?? []).map((m, i) => {
            const esOfertaParaPasajero =
              m?.tipo === TIPO_MENSAJE_OFERTA && remitentePropio === REMITENTE_PASAJERO && m?.remitente === REMITENTE_CONDUCTOR;
            // Guard Clause de Hilo Cerrado: esta fila puntual solo tiene
            // permiso de mostrarse "en curso" si es LA MISMA fila que
            // `mensajeInicioViaje` (la más reciente del hilo) Y la
            // oferta vigente de verdad (la última del hilo, no
            // cualquiera) está `en_transito` ahora mismo. Cualquier otra
            // fila "🚀 Viaje Iniciado" (de un viaje viejo, ya
            // finalizado/cancelado/rechazado según la oferta MÁS
            // RECIENTE) queda excluida sin importar qué tenga guardado
            // en su propio `viaje_fin_at` — así una fila rota de una
            // sesión pasada nunca vuelve a revivir un Cronómetro.
            // Fix Falso Positivo "Viaje Cerrado" al recoger pasajero:
            // acá SOLO miraba `estadoOfertaVigente` (100% dependiente de
            // que el UPDATE de esta fila sincronice por postgres_changes)
            // — pero el mensaje NUEVO "🚀 Viaje Iniciado" llega por su
            // PROPIA suscripción de Realtime, sin ninguna garantía de
            // orden respecto al UPDATE de `estado_oferta`. Si el mensaje
            // llegaba primero, `mensajeInicioViaje` ya apuntaba a esta
            // fila pero `estadoOfertaVigente` todavía decía 'aceptada'
            // (viejo) — `enCursoPermitido` daba `false` y esta fila
            // recién nacida cala directo en la rama "cerrada sin
            // registro". Ahora exige CUALQUIERA de las 3 señales de
            // 'en_transito' (`viajeEnTransito`/`estadoViaje`, las dos
            // optimistas por Broadcast, casi instantáneas) además de la
            // de la base — la misma ventana ya no puede fallar.
            const enCursoPermitido =
              m?.id === mensajeInicioViaje?.id &&
              (viajeEnTransito || estadoViaje === ESTADO_OFERTA_EN_TRANSITO || estadoOfertaVigente === ESTADO_OFERTA_EN_TRANSITO);
            return (
              <MessageBubble
                key={m?.id ?? i}
                mensaje={m}
                mine={m?.remitente === remitentePropio}
                esOfertaParaPasajero={esOfertaParaPasajero}
                estadoOferta={ofertasLocales[m?.id] ?? m?.estado_oferta}
                onResponder={handleResponderOferta}
                respondiendo={respondiendo}
                finOverrideISO={m?.id === mensajeInicioViaje?.id ? finViajeLocal : null}
                enCursoPermitido={enCursoPermitido}
              />
            );
          })
        )}
        {/* Fix Sincronización del Pasajero: si el Broadcast ya avisó
           "en_transito" (inicioViajeLocal) pero el mensaje real "🚀 Viaje
           Iniciado" (insertado por el Conductor) TODAVÍA no sincronizó
           por postgres_changes, esto lo reemplaza temporalmente — mismo
           componente, mismo Cronómetro corriendo, solo que con el
           timestamp que vino en el propio payload en vez del `created_at`
           de una fila que puede tardar en llegar. Desaparece solo en
           cuanto `mensajeInicioViaje` deja de ser null (el mensaje real
           ya está en el historial) para no duplicar la tarjeta. */}
        {!loading && !mensajeInicioViaje && inicioViajeLocal && !viajeCerrado && (
          // `enCursoPermitido` fijo en `true`: este overlay ya está
          // gateado por `!viajeCerrado` y solo existe mientras
          // `mensajeInicioViaje` real no llegó todavía — si se está
          // mostrando, es porque el viaje SÍ es genuinamente en curso.
          <TarjetaEstadoViaje mensaje={{ id: "sync-inicio-viaje", created_at: inicioViajeLocal }} enCursoPermitido={true} />
        )}
        {otroEscribiendo && (
          <div className="tz-chat-bubble tz-chat-typing" aria-label="Escribiendo…">
            <span className="tz-chat-typing-dot" />
            <span className="tz-chat-typing-dot" />
            <span className="tz-chat-typing-dot" />
          </div>
        )}
      </div>

      {/* Footer fijo — nunca se achica ni se superpone a los mensajes
         (flex-shrink:0, ver .tz-chat-footer en Styles.jsx). Todo lo que
         NO es el área scrolleable de arriba vive acá adentro: aviso de
         teléfono bloqueado, la fila de acciones rápidas (deslizable,
         un solo contenedor para los dos roles) y el input. */}
      <div className="tz-chat-footer">
        {bloqueado && (
          <p className="tz-error" style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
            <ShieldAlert size={14} /> Por seguridad, no se pueden enviar números de teléfono por el chat.
          </p>
        )}

        {errorOferta && (
          <p className="tz-error" style={{ margin: 0 }}>
            {errorOferta}
          </p>
        )}

        {/* Escudo Anti-Spam Conductor (Fase 2): antes este bloque se
           montaba siempre que el remitente fuera Conductor, y solo
           deshabilitaba los botones con `puedeProponerTarifa` — quedaba
           en el DOM (y en el layout) incluso en Fase 0 (hilo vacío),
           'en_transito', 'cancelado' o 'finalizado', rompiendo el
           layout con chips inútiles. Ahora `puedeProponerTarifa`
           (Fase 1 estricta: sin oferta aceptada/en curso, con al menos
           un mensaje ya en el hilo) decide si el bloque existe, no solo
           si está habilitado — `null` directo en cualquier otro
           estado. */}
        {/* `!loading` (Fix Fase 2 punto 3): mientras el fetch inicial del
           hilo todavía no resolvió, `ofertaVigente`/`estadoOfertaVigente`
           valen su default "vacío" (mensajes=[] todavía) — sin este
           chequeo, reabrir un chat ya cerrado mostraba estos botones
           habilitados por una fracción de segundo, la ventana real
           detrás de "el modal se reabre reseteando los bloqueos". */}
        {!loading && remitentePropio === REMITENTE_CONDUCTOR && puedeProponerTarifa && (
          <>
            <div className="tz-chat-quickrow">
              {TARIFAS_RAPIDAS.map((tarifa) => (
                <button
                  key={tarifa}
                  type="button"
                  className="tz-chat-quickreply-btn"
                  disabled={enviando}
                  onClick={() => enviarOferta(tarifa)}
                >
                  {tarifa}
                </button>
              ))}
              <button
                type="button"
                className="tz-chat-quickreply-btn tz-chat-quickreply-plus"
                onClick={() => {
                  setMostrarInputTarifa((v) => !v);
                  setErrorTarifaCustom("");
                }}
                aria-label="Proponer otro monto"
                title="Proponer otro monto"
              >
                <Plus size={15} />
              </button>
            </div>
            {mostrarInputTarifa && (
              <div className="tz-chat-tarifa-custom-row">
                <input
                  type="number"
                  min={TARIFA_CUSTOM_MIN}
                  step="0.10"
                  inputMode="decimal"
                  className="tz-text-input tz-chat-tarifa-custom-input"
                  placeholder="Ej. 10.50"
                  value={tarifaCustom}
                  onChange={(e) => {
                    setTarifaCustom(e.target.value);
                    setErrorTarifaCustom("");
                  }}
                />
                <button
                  type="button"
                  className="tz-chat-send-btn"
                  disabled={enviando}
                  onClick={enviarTarifaCustom}
                  aria-label="Enviar tarifa"
                >
                  <Send size={15} />
                </button>
              </div>
            )}
            {errorTarifaCustom && (
              <p className="tz-error" style={{ margin: 0, fontSize: 12 }}>
                {errorTarifaCustom}
              </p>
            )}
          </>
        )}

        {/* Escudo Anti-Spam Pasajero (Fase 2): "Hacer Señas" es EXCLUSIVO
           del primer contacto — se monta ÚNICAMENTE en Fase 0 real
           (`!ofertaVigente`: ni una propuesta en danza). Apenas existe
           CUALQUIER oferta (`pendiente`, `aceptada`, `en_transito` o
           `finalizado` todavía vigente), es `null` directo — sin texto
           de reemplazo acá (el "🏁 Viaje concluido" que había antes se
           sacó del todo: chocaba con la tarjeta-resumen del viaje que
           ya muestra ese cierre, y con el aviso de "🔒 chat cerrado" del
           input de más abajo — quedaban 3 avisos distintos diciendo lo
           mismo). Una oferta rechazada vuelve sola a Fase 0
           (`ofertaVigente` indefinida) y el botón reaparece para
           permitir una negociación nueva, a propósito. `!loading` (Fix
           Fase 2 punto 3): mismo motivo que el bloque del Conductor de
           más arriba — mientras el fetch inicial no resolvió,
           `ofertaVigente` vale su default "vacío" y este botón podía
           destellar visible en un hilo que en realidad ya está
           cerrado. */}
        {!loading && remitentePropio === REMITENTE_PASAJERO && !ofertaVigente && (
          <div className="tz-chat-tonazo-row">
            <button
              type="button"
              // Lógica de Negocio: sin destino, "deshabilitado" es solo
              // visual (clase CSS, no el atributo `disabled` nativo) a
              // propósito — un <button disabled> real ni siquiera
              // dispara onClick en el navegador, y necesitamos que el
              // click SÍ llegue a handleTonazo para poder mostrar el
              // toast de aviso en vez de no hacer nada en silencio. Las
              // otras razones de bloqueo (enviando/cooldown/tope de 5)
              // sí usan `disabled` real — esas ya se explican solas con
              // el spinner o el contador, no necesitan un toast.
              className={`tz-chat-tonazo-btn ${!destino ? "tz-chat-tonazo-btn-bloqueado" : ""}`}
              onClick={handleTonazo}
              disabled={enviandoZumbido || cooldownZumbido > 0 || contadorZumbidos >= MAX_ZUMBIDOS}
              aria-label="Avisar al conductor que estás esperando"
              title={
                !destino
                  ? "Selecciona tu destino antes de avisar al conductor"
                  : contadorZumbidos >= MAX_ZUMBIDOS
                  ? "Ya usaste tus 5 avisos de este viaje"
                  : "Avisar al conductor que estás esperando"
              }
            >
              {enviandoZumbido ? (
                <Loader2 size={16} className="tz-spin" />
              ) : (
                <img src={logo} alt="" className="tz-chat-tonazo-logo" />
              )}
            </button>
            {cooldownZumbido > 0 && <span className="tz-chat-tonazo-cooldown">Espera {cooldownZumbido}s…</span>}
          </div>
        )}
        {avisoTonazo && <div className="tz-toast-flotante">{avisoTonazo}</div>}

        {/* Anti-Spam General (Fase 2): "no es una red social de
           mensajería libre" — un hilo con el viaje `finalizado` O
           `cancelado` (`viajeCerrado`, ver arriba — DB-backed, correcto
           incluso al reabrir el chat de cero, no depende de haber
           "visto en vivo" la cancelación) desmonta el input Y el botón
           de enviar por completo, reemplazados por ÚNICAMENTE el aviso
           de candado — sin texto adicional (el "al finalizar el viaje"
           que tenía antes se sacó, quedaba redundante con la
           tarjeta-resumen del viaje que ya está arriba en el
           historial). `viajeCancelado` (el flag efímero de "se acaba de
           cancelar EN VIVO", solo dispara el toast) se mantiene en el
           OR por las dudas, pero `viajeCerrado` ya cubre el caso solo.
           Mientras `loading` sigue en true, no se muestra NI el input
           NI el aviso de candado — el fetch inicial todavía no
           resolvió, así que no hay forma de saber todavía si el hilo
           está cerrado o no; mostrar el input ahí era la ventana real
           detrás de "el modal se reabre reseteando los bloqueos,
           permitiendo usar el chat post-viaje" (el usuario podía
           escribir y mandar ANTES de que la carga terminara de
           confirmar que el viaje ya había terminado). El área de
           mensajes ya tiene su propio "Cargando chat…" — no hace falta
           duplicarlo acá abajo.
           Adaptación deliberada del pedido original: NO incluye
           "rechazado" acá — una oferta rechazada es un estado POR
           OFERTA, no de cierre del hilo (`ofertaVigente` queda
           indefinida y el par vuelve solo a Fase 0 para negociar de
           nuevo); bloquear el chat ahí impediría reintentar un precio
           nuevo con el mismo conductor/pasajero sin tener que volver a
           llamar. */}
        {loading ? null : viajeCerrado || viajeCancelado ? (
          <p className="tz-chat-cerrado-aviso">🔒 El chat se ha cerrado</p>
        ) : (
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
        )}
      </div>
      </div>

      {/* Modal de confirmación de Cancelar Viaje — 'position:fixed' vía
         .tz-modal-backdrop, así que da igual dónde vive en el árbol:
         siempre flota por encima de TODO (chat incluido). No cancela
         directo al primer click, a propósito. */}
      {confirmarCancelarOpen && (
        <div className="tz-modal-backdrop" onClick={() => !cancelando && setConfirmarCancelarOpen(false)}>
          <div className="tz-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <p>¿Estás seguro de cancelar la búsqueda/viaje?</p>
            <div className="tz-confirm-dialog-actions">
              <button
                type="button"
                className="tz-camera-cancel"
                disabled={cancelando}
                onClick={() => setConfirmarCancelarOpen(false)}
              >
                Volver
              </button>
              <button type="button" className="tz-confirm-dialog-danger" disabled={cancelando} onClick={handleConfirmarCancelar}>
                {cancelando && <Loader2 size={15} className="tz-spin" />}
                Sí, cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
