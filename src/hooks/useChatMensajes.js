import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

export const REMITENTE_PASAJERO = "pasajero";
export const REMITENTE_CONDUCTOR = "conductor";

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
        .select("id, conductor_id, pasajero_id, remitente, mensaje, leido, created_at")
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

  useEffect(() => {
    if (!conductorId || !pasajeroId) return undefined;
    const channel = supabase
      .channel(`chat-${conductorId}-${pasajeroId}-${instanceIdRef.current}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_mensajes", filter: `conductor_id=eq.${conductorId}` },
        (payload) => {
          if (!payload?.new || payload.new.pasajero_id !== pasajeroId) return;
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

  const enviarMensaje = useCallback(
    async (remitente, texto) => {
      const mensaje = (texto ?? "").trim();
      if (!mensaje) return { error: new Error("Mensaje vacío") };
      try {
        const { error: insertError } = await supabase.from("chat_mensajes").insert({
          conductor_id: conductorId,
          pasajero_id: pasajeroId,
          remitente,
          mensaje,
        });
        return { error: insertError };
      } catch (err) {
        return { error: err };
      }
    },
    [conductorId, pasajeroId]
  );

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

  return { mensajes, loading, error, otroEscribiendo, enviarMensaje, notificarEscribiendo, marcarLeidoPorConductor };
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
        .select("id, pasajero_id, remitente, mensaje, leido, created_at")
        .eq("conductor_id", conductorId)
        .order("created_at", { ascending: false });

      if (fetchError) {
        setError("No se pudo cargar la bandeja de mensajes.");
        setHilos([]);
        setUnreadCount(0);
      } else {
        const filas = data ?? [];
        const porPasajero = new Map();
        for (const m of filas) {
          if (m?.pasajero_id && !porPasajero.has(m.pasajero_id)) porPasajero.set(m.pasajero_id, m);
        }
        setHilos([...porPasajero.entries()].map(([pasajeroId, ultimo]) => ({ pasajeroId, ultimo })));
        setUnreadCount(filas.filter((m) => m?.remitente === REMITENTE_PASAJERO && !m?.leido).length);
      }
    } catch {
      setError("No se pudo cargar la bandeja de mensajes.");
      setHilos([]);
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
        () => refresh()
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [conductorId, refresh]);

  return { hilos, unreadCount, loading, error, refresh };
}
