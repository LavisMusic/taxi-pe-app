import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { ESTADO_CONDUCTOR_ACTIVO, ESTADO_CONDUCTOR_OCUPADO } from "../lib/taxiEnums";

export const REMITENTE_PASAJERO = "pasajero";
export const REMITENTE_CONDUCTOR = "conductor";
// Mensajes automáticos (ej. "El pasajero rechazó la tarifa") — no los
// manda ninguna de las dos personas del hilo, se renderizan distinto
// (ver MessageBubble en ChatWindow.jsx) y no cuentan como "mío" para
// ninguno de los dos lados.
export const REMITENTE_SISTEMA = "sistema";

// Fase 2 de "Contratos Inteligentes" — `chat_mensajes.tipo` distingue un
// mensaje de texto normal de una propuesta de tarifa; `estado_oferta`
// solo aplica cuando tipo='oferta' (null en cualquier otro caso).
export const TIPO_MENSAJE_TEXTO = "texto";
export const TIPO_MENSAJE_OFERTA = "oferta";
export const TIPO_MENSAJE_SISTEMA = "sistema";
// "Hacer Señas" (Pasajero) — tipado aparte (no se adivina por el texto
// del mensaje) para que la alerta intrusiva del Conductor
// (useHilosChatConductor -> alertaSenas) lo detecte de forma robusta.
export const TIPO_MENSAJE_SENAS = "senas";
// UX de Mensajes de Sistema + Cronómetro: "🚀 Viaje Iniciado"/"🏁 Viaje
// Finalizado" — burbuja celeste neón propia (ver ChatWindow.jsx),
// distinta del tipo 'sistema' genérico (avisos neutros como
// cancelaciones/proximidad). Separado a propósito para no tener que
// adivinar por el TEXTO del mensaje cuál burbuja necesita el
// tratamiento especial.
export const TIPO_MENSAJE_SISTEMA_VIAJE = "sistema_viaje";
// Texto fijo del atajo — vive acá (no en ChatModal.jsx, que es quien
// ahora dispara el envío desde la cabecera) para que cualquier otro
// lugar que lo necesite en el futuro lo importe del mismo sitio que el
// tipo, en vez de tener el string duplicado.
export const TEXTO_SENAS = "📍 Puede pasar por mí, estoy cerca";

export const ESTADO_OFERTA_PENDIENTE = "pendiente";
export const ESTADO_OFERTA_ACEPTADA = "aceptada";
export const ESTADO_OFERTA_RECHAZADA = "rechazada";
// Fase 3 "Colectivo" — el Conductor ya recogió a este pasajero (botón
// "Pasajero Recogido", ver ChatWindow.jsx). Viene DESPUÉS de 'aceptada'
// en la misma oferta: aceptada = viaje confirmado, esperando el
// encuentro; en_transito = ya está a bordo, viaje en curso. A partir de
// acá el mapa del viaje deja de mostrar el pin del pasajero (ya no hace
// falta, está en el auto).
export const ESTADO_OFERTA_EN_TRANSITO = "en_transito";
// Viaje ya aceptado, pero el pasajero se arrepintió antes de que
// arranque de verdad (botón "Cancelar Viaje") — distinto de
// "rechazada" (esa es cuando NUNCA se aceptó la oferta).
export const ESTADO_OFERTA_CANCELADA = "cancelada";
// "🏁 Finalizar Carrera" (Conductor, a <50m del destino, ver
// ChatWindow.jsx) — estado terminal, cierra el viaje para los dos
// lados con su pantalla de cierre (tarifaAcordada para el Conductor,
// "llegaste" para el Pasajero).
export const ESTADO_OFERTA_FINALIZADO = "finalizado";

// Fase 5 (Motor de Viajes Simultáneos) — Aislamiento de Estados: antes,
// "Cancelar"/"Finalizar" pisaban `conductores.estado`/`asientos_ocupados`
// a mano (`estado: 'activo', asientos_ocupados: 0`), asumiendo que ESE
// era el único viaje del conductor — cancelar/finalizar al Pasajero A
// dejaba libre TAMBIÉN al Pasajero B, que seguía a bordo. No existe una
// tabla `viajes` en este esquema (ver notas de rondas anteriores), así
// que "viajes activos" se recalcula desde la ÚNICA fuente de verdad real
// (`chat_mensajes`) cada vez que algo cambia, en vez de mantener un
// contador de mano que se puede desincronizar. Se llama DESPUÉS de
// cualquier UPDATE a `estado_oferta` (aceptar, recoger, cancelar,
// finalizar) — nunca asume el resultado, siempre relee.
//
// Por qué contar pasajeros DISTINTOS y no filas: mientras una oferta
// sigue 'aceptada'/'en_transito', `puedeProponerTarifa` en ChatWindow.jsx
// bloquea que se le proponga una tarifa NUEVA a ese mismo pasajero — así
// que nunca puede haber dos ofertas no-terminales para el mismo par
// (conductor_id, pasajero_id) a la vez, y contar sin deduplicar ya da el
// número correcto de pasajeros a bordo/reservados.
async function sincronizarAsientosYEstado(conductorId) {
  if (!conductorId) return;
  try {
    const [{ data: ofertasActivas, error: ofertasError }, { data: filaConductor, error: conductorFetchError }] =
      await Promise.all([
        supabase
          .from("chat_mensajes")
          .select("pasajero_id")
          .eq("conductor_id", conductorId)
          .eq("tipo", TIPO_MENSAJE_OFERTA)
          .in("estado_oferta", [ESTADO_OFERTA_ACEPTADA, ESTADO_OFERTA_EN_TRANSITO]),
        supabase.from("conductores").select("asientos_totales, estado").eq("id", conductorId).single(),
      ]);
    if (ofertasError || conductorFetchError) {
      console.error("No se pudo recalcular asientos/estado del conductor:", ofertasError || conductorFetchError);
      return;
    }

    const totales = filaConductor?.asientos_totales ?? 4;
    const ocupados = Math.min(new Set((ofertasActivas ?? []).map((o) => o.pasajero_id)).size, totales);
    // Aislamiento real: el conductor solo vuelve a 'activo' (libre de
    // verdad) cuando NINGÚN pasajero le queda a bordo/reservado — con
    // uno solo que siga (`ocupados > 0`), se queda 'ocupado' aunque el
    // que acaba de cancelar/finalizar haya sido otro. Si ya estaba
    // 'desconectado'/'pendiente'/'rechazado' (estados que no son de
    // radar), no lo tocamos — esto solo gestiona el switch activo/ocupado.
    const estadoActual = filaConductor?.estado;
    const patch = { asientos_ocupados: ocupados };
    if (estadoActual === ESTADO_CONDUCTOR_ACTIVO || estadoActual === ESTADO_CONDUCTOR_OCUPADO) {
      patch.estado = ocupados > 0 ? ESTADO_CONDUCTOR_OCUPADO : ESTADO_CONDUCTOR_ACTIVO;
    }
    const { error: updateError } = await supabase.from("conductores").update(patch).eq("id", conductorId);
    if (updateError) console.error("No se pudo sincronizar asientos/estado del conductor:", updateError);
  } catch (err) {
    console.error("Error al sincronizar asientos/estado del conductor:", err);
  }
}

// Cuánto dura visible el indicador de "escribiendo…" después del
// último aviso recibido — si no llega uno nuevo en este lapso, se
// asume que la otra persona paró (no hay evento explícito de "dejé de
// escribir", solo se infiere por silencio).
const TYPING_TIMEOUT_MS = 2500;
// No se manda un broadcast por cada tecla — alcanza con uno cada tanto
// mientras haya tipeo activo, mucho menos tráfico en el canal.
const TYPING_THROTTLE_MS = 1500;

// Chat interno de un hilo (conductor, pasajero) — reemplaza al viejo
// "Contactar" por wa.me: acá el número de ninguno de los dos sale nunca
// del backend. Carga el historial una vez y se suscribe a
// `postgres_changes` (Supabase Realtime) filtrado por `conductor_id`
// para que los mensajes nuevos aparezcan sin refrescar — se filtra por
// `pasajero_id` en el cliente porque un mismo conductor puede tener
// varios hilos (uno por pasajero) y el filtro de Realtime solo admite
// una columna. El mismo canal también lleva un `broadcast` efímero
// ("typing") para el indicador de los tres puntitos — no se persiste
// en la base, solo viaja en vivo entre los dos que están mirando el
// chat en ese momento.
export function useChatMensajes(conductorId, pasajeroId) {
  const [mensajes, setMensajes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [otroEscribiendo, setOtroEscribiendo] = useState(false);

  const channelRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const lastTypingSentRef = useRef(0);
  // Sufijo único por INSTANCIA del hook (no por conductorId/pasajeroId)
  // — causa raíz real del crash reportado: ConductorPage (badge de no
  // leídos) y ConductorChatInboxModal (bandeja completa) llaman este
  // hook a la vez para el MISMO conductor. `supabase.channel(topic)`
  // reutiliza el canal si el topic ya existe — la segunda instancia
  // recibía el canal de la PRIMERA, ya suscrito, y su `.on(...)`
  // posterior a `subscribe()` tira "cannot add postgres_changes
  // callbacks... after subscribe()" (confirmado en consola). Con un
  // sufijo distinto por instancia, cada hook arma su propio canal,
  // nunca colisionan.
  const instanceIdRef = useRef(Math.random().toString(36).slice(2));

  const refresh = useCallback(async () => {
    if (!conductorId || !pasajeroId) {
      setMensajes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    // try/catch además del `error` tipado que ya devuelve supabase-js:
    // un corte de red a mitad de la consulta deja una promesa
    // rechazada — sin atraparla acá, React podía desmontar el árbol
    // entero (pantalla gris) en vez de solo mostrar el mensaje de error.
    try {
      const { data, error: fetchError } = await supabase
        .from("chat_mensajes")
        .select(
          "id, conductor_id, pasajero_id, remitente, mensaje, tipo, estado_oferta, destino_lat, destino_lng, origen_lat, origen_lng, leido, created_at, viaje_fin_at"
        )
        .eq("conductor_id", conductorId)
        .eq("pasajero_id", pasajeroId)
        .order("created_at", { ascending: true });

      if (fetchError) {
        setError("No se pudo cargar el chat.");
        setMensajes([]);
      } else {
        setMensajes(data ?? []);
      }
    } catch {
      setError("No se pudo cargar el chat.");
      setMensajes([]);
    }
    setLoading(false);
  }, [conductorId, pasajeroId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Fix Realtime Pasajero (Safari iOS / pestañas en background): no
  // existe una tabla `sistema_viaje` en este esquema — "el viaje" es
  // esta MISMA fila de `chat_mensajes` (su `estado_oferta`), así que el
  // re-fetch real es este mismo `refresh()`, no un SELECT a otra tabla.
  // Safari en iOS (y en general cualquier navegador con la pestaña en
  // background por un rato largo) puede cortar el WebSocket de Realtime
  // en silencio, sin ningún evento de error — si el Conductor cancela o
  // finaliza justo en esa ventana, el Pasajero queda con la última
  // oferta ya vencida (chat abierto, botones activos, cronómetro
  // corriendo) hasta que algo más fuerce un refresh. Mismo mecanismo que
  // ya se usa del lado Conductor (useConductoresPublicos.js/
  // useConductorSesion.js): un `refresh()` por REST, que no depende de
  // que el socket siga vivo, corre solo apenas la pestaña vuelve a
  // estar visible — sobrescribe el estado local con la verdad real de
  // la base sin esperar a que el WebSocket se reconecte solo.
  useEffect(() => {
    const alVolverVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", alVolverVisible);
    return () => document.removeEventListener("visibilitychange", alVolverVisible);
  }, [refresh]);

  useEffect(() => {
    if (!conductorId || !pasajeroId) return undefined;
    const channel = supabase
      .channel(`chat-${conductorId}-${pasajeroId}-${instanceIdRef.current}`)
      .on(
        // "*" (no solo INSERT): responderOferta hace un UPDATE sobre una
        // fila ya existente (estado_oferta pasa a aceptada/rechazada) —
        // sin escuchar también ese evento, el que NO tocó el botón (el
        // conductor, cuando el pasajero responde) se quedaba viendo la
        // oferta como "pendiente" hasta refrescar. Mismo motivo que ya
        // resolvió este problema en useHilosChatConductor de más abajo.
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_mensajes", filter: `conductor_id=eq.${conductorId}` },
        (payload) => {
          if (!payload?.new || payload.new.pasajero_id !== pasajeroId) return;
          if (payload.eventType === "UPDATE") {
            setMensajes((prev) => prev.map((m) => (m.id === payload.new.id ? { ...m, ...payload.new } : m)));
            return;
          }
          setMensajes((prev) => (prev.some((m) => m.id === payload.new.id) ? prev : [...prev, payload.new]));
          // Si llegó un mensaje de verdad, el "escribiendo…" ya cumplió
          // su función — lo apagamos aunque el timeout todavía no venza.
          clearTimeout(typingTimeoutRef.current);
          setOtroEscribiendo(false);
        }
      )
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload?.remitente === undefined) return;
        setOtroEscribiendo(true);
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setOtroEscribiendo(false), TYPING_TIMEOUT_MS);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      clearTimeout(typingTimeoutRef.current);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [conductorId, pasajeroId]);

  // `extra` es lo que permite mandar una OFERTA en vez de texto plano —
  // { tipo: TIPO_MENSAJE_OFERTA, estado_oferta: ESTADO_OFERTA_PENDIENTE }
  // (ver el atajo de tarifas en ChatWindow.jsx). Vacío por default: un
  // mensaje de texto normal no manda ninguno de los dos campos, así que
  // `tipo` cae en su DEFAULT 'texto' de la base y `estado_oferta` queda
  // null.
  const enviarMensaje = useCallback(
    async (remitente, texto, extra = {}) => {
      const mensaje = (texto ?? "").trim();
      if (!mensaje) return { error: new Error("Mensaje vacío") };
      try {
        const { error: insertError } = await supabase.from("chat_mensajes").insert({
          conductor_id: conductorId,
          pasajero_id: pasajeroId,
          remitente,
          mensaje,
          ...extra,
        });
        return { error: insertError };
      } catch (err) {
        return { error: err };
      }
    },
    [conductorId, pasajeroId]
  );

  // Lo llama el Pasajero al tocar Aceptar/Rechazar sobre una oferta de
  // tarifa (ver MessageBubble en ChatWindow.jsx). "El Match" (aceptar):
  // el conductor pasa a Ocupado automáticamente — mismo estado operativo
  // que ya usa el Directorio del Admin (ESTADO_CONDUCTOR_OCUPADO, ver
  // taxiEnums.js), no se inventa un estado nuevo. Rechazar: le deja al
  // conductor un mensaje de sistema en el mismo hilo, así se entera sin
  // tener que estar mirando esa burbuja puntual en ese momento.
  const responderOferta = useCallback(
    async (mensajeId, nuevoEstado) => {
      if (!mensajeId) return { error: new Error("Falta el id del mensaje.") };
      try {
        // `.select()` SIN `.single()`: `.single()` le pide a PostgREST el
        // header 'Accept: application/vnd.pgrst.object+json', que exige
        // EXACTAMENTE 1 fila de vuelta — si RLS bloquea el update (nadie
        // había creado una política de UPDATE para chat_mensajes, ver el
        // SQL que te mandé) la fila no vuelve, y eso es justo lo que
        // dispara el 406 "Not Acceptable" en vez de un error más claro.
        // Con `.select()` a secas, 0 filas es un array vacío, no un 406.
        const { data, error: updateError } = await supabase
          .from("chat_mensajes")
          .update({ estado_oferta: nuevoEstado })
          .eq("id", mensajeId)
          .select();

        if (updateError) {
          console.error("Error al actualizar estado_oferta:", updateError);
          return { error: updateError };
        }
        if (!data || data.length === 0) {
          const sinFila = new Error(
            "No se pudo guardar tu respuesta (0 filas afectadas) — probablemente falta la política RLS de UPDATE en chat_mensajes."
          );
          console.error(sinFila);
          return { error: sinFila };
        }

        if (nuevoEstado === ESTADO_OFERTA_ACEPTADA) {
          // Fase 5: 'aceptada' YA reserva un asiento (fórmula acordada:
          // asientos_disponibles = totales - (aceptada + en_transito)),
          // no solo 'en_transito' como antes — se recalcula acá en vez
          // de un `.update({estado: 'ocupado'})` a ciegas, para que
          // conviva bien con otros viajes que este conductor ya tenga
          // en curso.
          await sincronizarAsientosYEstado(conductorId);
        } else if (nuevoEstado === ESTADO_OFERTA_RECHAZADA) {
          const { error: sistemaError } = await enviarMensaje(REMITENTE_SISTEMA, "❌ El pasajero rechazó la oferta", {
            tipo: TIPO_MENSAJE_SISTEMA,
          });
          if (sistemaError) console.error("Oferta rechazada, pero no se pudo avisar al conductor:", sistemaError);
        }
        return { error: null };
      } catch (err) {
        console.error("Error al responder la oferta:", err);
        return { error: err };
      }
    },
    [conductorId, enviarMensaje]
  );

  // Botón "✅ Pasajero Recogido" (solo Conductor, ver ChatWindow.jsx) —
  // Fase 3 "Colectivo": pasa la oferta de 'aceptada' a 'en_transito' (el
  // mapa deja de mostrar el pin del pasajero, ya está a bordo). Fase 5:
  // ya NO suma un asiento acá — 'aceptada' y 'en_transito' cuentan IGUAL
  // en `sincronizarAsientosYEstado` (ver la fórmula ahí arriba), así que
  // este paso no cambia el TOTAL de ocupados, solo la fase del viaje. Se
  // llama igual (barato, y blinda contra cualquier desincronización
  // previa) en vez de asumir que el conteo ya estaba bien.
  const marcarPasajeroRecogido = useCallback(
    async (mensajeOfertaId) => {
      if (!mensajeOfertaId) return { error: new Error("Falta el id de la oferta.") };
      try {
        const { data, error: updateError } = await supabase
          .from("chat_mensajes")
          .update({ estado_oferta: ESTADO_OFERTA_EN_TRANSITO })
          .eq("id", mensajeOfertaId)
          .select();
        if (updateError) {
          console.error("Error al marcar pasajero recogido:", updateError);
          return { error: updateError };
        }
        if (!data || data.length === 0) {
          const sinFila = new Error("No se encontró la oferta (0 filas afectadas).");
          console.error(sinFila);
          return { error: sinFila };
        }

        await sincronizarAsientosYEstado(conductorId);
        return { error: null };
      } catch (err) {
        console.error("Error al marcar pasajero recogido:", err);
        return { error: err };
      }
    },
    [conductorId]
  );

  // Botón "Cancelar Viaje" — ahora de los DOS lados (Pasajero Y
  // Conductor, ver ChatWindow.jsx). A diferencia de Rechazar (nunca se
  // aceptó la oferta), acá el viaje YA estaba en curso: hay que marcar
  // la oferta como cancelada (para que el panel superior de "viaje
  // iniciado" desaparezca) y avisar en el chat. `remitentePropio` decide
  // el texto exacto del aviso — quien canceló, no siempre es el
  // pasajero.
  //
  // Fase 5 (Motor de Viajes Simultáneos) — Aislamiento de Estados: antes
  // esto pisaba `estado: 'activo', asientos_ocupados: 0` a ciegas,
  // asumiendo que ESTE era el único viaje del conductor — cancelar al
  // Pasajero A liberaba TAMBIÉN al Pasajero B, que seguía a bordo. Ahora
  // se filtra estrictamente por `mensajeOfertaId` (el `id_viaje` real de
  // este esquema — cada oferta es su propio ciclo) y, recién después,
  // `sincronizarAsientosYEstado` RELEE cuántos pasajeros le quedan de
  // verdad al conductor (no asume "ninguno") — con uno solo que siga a
  // bordo, sigue en 'ocupado'.
  const cancelarViaje = useCallback(
    async (mensajeOfertaId, remitentePropio) => {
      try {
        if (mensajeOfertaId) {
          const { error: updateError } = await supabase
            .from("chat_mensajes")
            .update({ estado_oferta: ESTADO_OFERTA_CANCELADA })
            .eq("id", mensajeOfertaId)
            .select();
          if (updateError) {
            console.error("Error al cancelar la oferta del viaje:", updateError);
            return { error: updateError };
          }
        }

        const texto =
          remitentePropio === REMITENTE_CONDUCTOR
            ? "⚠️ El conductor ha cancelado el viaje"
            : "⚠️ El pasajero ha cancelado el viaje";
        const { error: sistemaError } = await enviarMensaje(REMITENTE_SISTEMA, texto, { tipo: TIPO_MENSAJE_SISTEMA });
        if (sistemaError) console.error("No se pudo avisar la cancelación:", sistemaError);

        await sincronizarAsientosYEstado(conductorId);

        return { error: null };
      } catch (err) {
        console.error("Error al cancelar el viaje:", err);
        return { error: err };
      }
    },
    [conductorId, enviarMensaje]
  );

  // "🏁 Finalizar Carrera" (solo Conductor, a <50m del destino — ver
  // ChatWindow.jsx/MapaViaje.jsx). Estado terminal: la oferta pasa a
  // 'finalizado' (dispara la pantalla de cierre para los dos lados).
  //
  // Fase 5 — Aislamiento de Estados: mismo fix que `cancelarViaje` — el
  // UPDATE de arriba ya está scopeado estrictamente a ESTA oferta
  // (`mensajeOfertaId`); lo que se saca es el `.update({estado:'activo',
  // asientos_ocupados:0})` incondicional de acá abajo, reemplazado por
  // `sincronizarAsientosYEstado`, que relee cuántos pasajeros le quedan
  // de verdad al conductor antes de decidir si vuelve a 'activo'.
  const finalizarViaje = useCallback(
    async (mensajeOfertaId) => {
      if (!mensajeOfertaId) return { error: new Error("Falta el id de la oferta.") };
      try {
        const { data, error: updateError } = await supabase
          .from("chat_mensajes")
          .update({ estado_oferta: ESTADO_OFERTA_FINALIZADO })
          .eq("id", mensajeOfertaId)
          .select();
        if (updateError) {
          console.error("Error al finalizar el viaje:", updateError);
          return { error: updateError };
        }
        if (!data || data.length === 0) {
          const sinFila = new Error("No se encontró la oferta (0 filas afectadas).");
          console.error(sinFila);
          return { error: sinFila };
        }

        await sincronizarAsientosYEstado(conductorId);

        return { error: null };
      } catch (err) {
        console.error("Error al finalizar el viaje:", err);
        return { error: err };
      }
    },
    [conductorId]
  );

  // Refactor: Tarjeta Neón Única y Mutante — en vez de insertar un
  // SEGUNDO mensaje "🏁 Viaje Finalizado" (ChatWindow.jsx, rondas
  // anteriores), esto actualiza la MISMA fila del mensaje "🚀 Viaje
  // Iniciado" con el momento exacto de cierre. <TarjetaEstadoViaje/>
  // lee `created_at` (inicio) y `viaje_fin_at` (fin) de una sola fila —
  // el mismo componente cambia de diseño solo con que `viaje_fin_at`
  // deje de ser null, no hace falta un mensaje aparte para el cierre.
  // `finISO` opcional: quien llama (ChatWindow.jsx) puede pasar un
  // timestamp ya generado para usar EXACTAMENTE el mismo valor acá, en
  // su override optimista local y en el payload del Broadcast — los
  // tres coinciden al dígito en vez de tener 3 "ahora" ligeramente
  // distintos.
  const marcarFinDeViaje = useCallback(async (mensajeInicioId, finISO) => {
    if (!mensajeInicioId) return { error: new Error("Falta el id del mensaje de inicio del viaje.") };
    try {
      const { error: updateError } = await supabase
        .from("chat_mensajes")
        .update({ viaje_fin_at: finISO ?? new Date().toISOString() })
        .eq("id", mensajeInicioId);
      if (updateError) console.error("No se pudo marcar el fin del viaje:", updateError);
      return { error: updateError ?? null };
    } catch (err) {
      console.error("Error al marcar el fin del viaje:", err);
      return { error: err };
    }
  }, []);

  // El propio remitente se manda a sí mismo en el payload solo para
  // filtrar del lado del listener si hiciera falta — Supabase Realtime
  // ya no reenvía el broadcast al mismo cliente que lo emitió, pero
  // igual es un dato barato de incluir por si acaso.
  const notificarEscribiendo = useCallback((remitente) => {
    const ahora = Date.now();
    if (ahora - lastTypingSentRef.current < TYPING_THROTTLE_MS) return;
    lastTypingSentRef.current = ahora;
    channelRef.current?.send({ type: "broadcast", event: "typing", payload: { remitente } });
  }, []);

  // Lo llama SOLO el lado Conductor al abrir este hilo (ver
  // ConductorChatInboxModal.jsx) — marca como leídos los mensajes que
  // mandó el pasajero, para apagar el punto rojo del botón "Mensajes".
  const marcarLeidoPorConductor = useCallback(async () => {
    if (!conductorId || !pasajeroId) return;
    try {
      await supabase
        .from("chat_mensajes")
        .update({ leido: true })
        .eq("conductor_id", conductorId)
        .eq("pasajero_id", pasajeroId)
        .eq("remitente", REMITENTE_PASAJERO)
        .eq("leido", false);
    } catch {
      // No crítico — el punto rojo simplemente no se apaga esta vez.
    }
  }, [conductorId, pasajeroId]);

  // Checks de Lectura (Fase 6): mitad simétrica de arriba, para que los
  // ✓✓ azules también funcionen sobre los mensajes que manda el
  // CONDUCTOR — sin esto, `leido` solo se ponía en `true` del lado
  // Pasajero->Conductor, y las burbujas del conductor nunca hubieran
  // podido mostrar más que el ✓ gris de "enviado". Lo llama el lado
  // Pasajero al abrir/tener el chat abierto (ver ChatWindow.jsx).
  const marcarLeidoPorPasajero = useCallback(async () => {
    if (!conductorId || !pasajeroId) return;
    try {
      await supabase
        .from("chat_mensajes")
        .update({ leido: true })
        .eq("conductor_id", conductorId)
        .eq("pasajero_id", pasajeroId)
        .eq("remitente", REMITENTE_CONDUCTOR)
        .eq("leido", false);
    } catch {
      // No crítico — los checks simplemente no avanzan a azul esta vez.
    }
  }, [conductorId, pasajeroId]);

  return {
    mensajes,
    loading,
    error,
    otroEscribiendo,
    enviarMensaje,
    responderOferta,
    marcarPasajeroRecogido,
    cancelarViaje,
    finalizarViaje,
    marcarFinDeViaje,
    notificarEscribiendo,
    marcarLeidoPorConductor,
    marcarLeidoPorPasajero,
  };
}

// Bandeja del lado Conductor: lista de hilos (un pasajero = un hilo)
// con el último mensaje, para que /conductor pueda ver y responder —
// sin esto el chat sería de un solo sentido (el pasajero escribe y
// nadie del otro lado lo ve). Trae TODOS los mensajes del conductor y
// agrupa en el cliente — el volumen esperado (mensajes de texto corto,
// un taxi local) no justifica una vista/RPC de agregación en Postgres.
// `unreadCount` (mensajes del PASAJERO todavía sin leer, en cualquier
// hilo) alimenta el punto rojo del botón "Mensajes" — se calcula acá,
// ANTES de colapsar a "un mensaje por hilo", porque el sin-leer puede
// no ser el último mensaje del hilo.
export function useHilosChatConductor(conductorId) {
  const [hilos, setHilos] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Alerta intrusiva de "Hacer Señas" — reutiliza ESTE canal (ya
  // suscrito a todo INSERT/UPDATE de chat_mensajes del conductor, ver
  // más abajo) en vez de abrir uno nuevo solo para esto.
  const [alertaSenas, setAlertaSenas] = useState(null);
  // Fase 5 (Motor de Viajes Simultáneos): CON QUÉ PASAJEROS está "En
  // Carrera" ahora mismo — antes era un solo id (`pasajeroEnCarrera`),
  // asumiendo un único viaje a la vez; ahora es un array, uno por cada
  // oferta 'aceptada'/'en_transito' que tenga este conductor en
  // paralelo. `useGpsBroadcaster.js` lo usa para abrir/mantener UN canal
  // privado por pasajero simultáneamente (ver ConductorPage.jsx), no
  // solo uno.
  const [pasajerosEnCarrera, setPasajerosEnCarrera] = useState([]);
  // Mismo motivo que en useChatMensajes de arriba: este hook se llama
  // dos veces en simultáneo para el mismo conductorId (ConductorPage
  // para el punto rojo + ConductorChatInboxModal para la bandeja) — sin
  // un topic único por instancia, la segunda pisa el canal ya suscrito
  // de la primera y `.on()` explota.
  const instanceIdRef = useRef(Math.random().toString(36).slice(2));

  const refresh = useCallback(async () => {
    if (!conductorId) {
      setHilos([]);
      setUnreadCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const { data, error: fetchError } = await supabase
        .from("chat_mensajes")
        .select("id, pasajero_id, remitente, mensaje, tipo, estado_oferta, leido, created_at")
        .eq("conductor_id", conductorId)
        .order("created_at", { ascending: false });

      if (fetchError) {
        setError("No se pudo cargar la bandeja de mensajes.");
        setHilos([]);
        setUnreadCount(0);
        setPasajerosEnCarrera([]);
      } else {
        const filas = data ?? [];
        const porPasajero = new Map();
        for (const m of filas) {
          if (m?.pasajero_id && !porPasajero.has(m.pasajero_id)) porPasajero.set(m.pasajero_id, m);
        }
        setHilos([...porPasajero.entries()].map(([pasajeroId, ultimo]) => ({ pasajeroId, ultimo })));
        setUnreadCount(filas.filter((m) => m?.remitente === REMITENTE_PASAJERO && !m?.leido).length);
        // Fase 5: TODAS las ofertas 'aceptada'/'en_transito', no solo la
        // primera que se encuentre — un conductor puede tener varios
        // pasajeros a bordo/reservados en paralelo. `Set` deduplica por
        // las dudas (no debería hacer falta — a lo sumo una oferta no
        // resuelta por pasajero, ver el comentario de
        // `sincronizarAsientosYEstado` en useChatMensajes.js — pero es
        // gratis blindarse acá también).
        const ofertasEnCurso = filas.filter(
          (m) =>
            m?.tipo === TIPO_MENSAJE_OFERTA &&
            (m?.estado_oferta === ESTADO_OFERTA_ACEPTADA || m?.estado_oferta === ESTADO_OFERTA_EN_TRANSITO)
        );
        setPasajerosEnCarrera([...new Set(ofertasEnCurso.map((m) => m.pasajero_id))]);
      }
    } catch {
      setError("No se pudo cargar la bandeja de mensajes.");
      setHilos([]);
      setPasajerosEnCarrera([]);
      setUnreadCount(0);
    }
    setLoading(false);
  }, [conductorId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!conductorId) return undefined;
    const channel = supabase
      .channel(`chat-inbox-${conductorId}-${instanceIdRef.current}`)
      .on(
        "postgres_changes",
        // "*" (no solo INSERT): un UPDATE es justo lo que dispara
        // marcarLeidoPorConductor — sin escuchar también ese evento el
        // punto rojo no se apagaba solo en otras pestañas/dispositivos.
        { event: "*", schema: "public", table: "chat_mensajes", filter: `conductor_id=eq.${conductorId}` },
        (payload) => {
          if (payload?.eventType === "INSERT" && payload?.new?.tipo === TIPO_MENSAJE_SENAS) {
            setAlertaSenas({ pasajeroId: payload.new.pasajero_id, mensajeId: payload.new.id });
          }
          refresh();
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [conductorId, refresh]);

  const descartarAlertaSenas = useCallback(() => setAlertaSenas(null), []);

  return { hilos, unreadCount, loading, error, refresh, alertaSenas, descartarAlertaSenas, pasajerosEnCarrera };
}
