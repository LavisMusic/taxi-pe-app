import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

// Actividad de los chats del pasajero, para la lista de conductores de la
// Home: cuándo fue el último mensaje con cada conductor (de cualquiera de
// los dos lados) y si ya aceptó la negociación con alguno (oferta
// aceptada o en tránsito). Lee solo las últimas 24 h; se actualiza en vivo
// con los cambios de SUS mensajes y cada 30 s.
//
// Devuelve { ultimaActividad: { [conductorId]: ms }, conductorAcordadoId }.
const VENTANA_MS = 24 * 60 * 60 * 1000;

export function useActividadChatsPasajero(pasajeroId) {
  const [ultimaActividad, setUltimaActividad] = useState({});
  const [conductorAcordadoId, setConductorAcordadoId] = useState(null);
  const sufijo = useRef(Math.random().toString(36).slice(2));

  const cargar = useCallback(async () => {
    if (!pasajeroId) {
      setUltimaActividad({});
      setConductorAcordadoId(null);
      return;
    }
    const { data, error } = await supabase
      .from("chat_mensajes")
      .select("conductor_id, created_at, tipo, estado_oferta")
      .eq("pasajero_id", pasajeroId)
      .gte("created_at", new Date(Date.now() - VENTANA_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) return;
    const ultima = {};
    let acordado = null;
    for (const m of data || []) {
      const t = new Date(m.created_at).getTime();
      if (!ultima[m.conductor_id] || t > ultima[m.conductor_id]) ultima[m.conductor_id] = t;
      if (!acordado && m.tipo === "oferta" && ["aceptada", "en_transito"].includes(m.estado_oferta)) {
        acordado = m.conductor_id;
      }
    }
    setUltimaActividad(ultima);
    setConductorAcordadoId(acordado);
  }, [pasajeroId]);

  useEffect(() => {
    cargar();
    if (!pasajeroId) return undefined;
    const canal = supabase
      .channel(`actividad-pasajero-${pasajeroId}-${sufijo.current}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_mensajes", filter: `pasajero_id=eq.${pasajeroId}` },
        cargar
      )
      .subscribe();
    const sondeo = setInterval(() => {
      if (document.visibilityState === "visible") cargar();
    }, 30000);
    return () => {
      clearInterval(sondeo);
      supabase.removeChannel(canal);
    };
  }, [pasajeroId, cargar]);

  return { ultimaActividad, conductorAcordadoId, recargar: cargar };
}
