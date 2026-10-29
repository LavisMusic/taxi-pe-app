import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { usePerfilesEnVivo } from "./usePerfilesEnVivo";

// Actividad de los chats del pasajero, para la lista de conductores de la
// Home y para sus Mensajes: por conductor, cuándo fue el último mensaje
// (de cualquiera de los dos lados), cuál fue, cuántos del conductor no leyó
// y cuándo terminó su último viaje con él; y si ya aceptó la negociación
// con alguno (oferta aceptada o en tránsito). Lee solo las últimas 24 h (la
// vida de un chat); se actualiza en vivo con los cambios de SUS mensajes y
// cada 30 s.
//
// Devuelve { ultimaActividad: { [conductorId]: ms }, ultimos: { [conductorId]:
// fila }, noLeidos: { [conductorId]: n }, viajeTerminado: { [conductorId]: ms },
// conductorAcordadoId }.
const VENTANA_MS = 24 * 60 * 60 * 1000;
const FIN_DE_VIAJE = ["finalizado", "cancelada"];

export function useActividadChatsPasajero(pasajeroId) {
  const [datos, setDatos] = useState({ ultimaActividad: {}, ultimos: {}, noLeidos: {}, viajeTerminado: {}, conductorAcordadoId: null });
  const sufijo = useRef(Math.random().toString(36).slice(2));

  const cargar = useCallback(async () => {
    if (!pasajeroId) {
      setDatos({ ultimaActividad: {}, ultimos: {}, noLeidos: {}, viajeTerminado: {}, conductorAcordadoId: null });
      return;
    }
    const { data, error } = await supabase
      .from("chat_mensajes")
      .select("conductor_id, created_at, tipo, estado_oferta, finalizado_at, mensaje, remitente, leido")
      .eq("pasajero_id", pasajeroId)
      .gte("created_at", new Date(Date.now() - VENTANA_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) return;
    const ultimaActividad = {};
    const ultimos = {};
    const noLeidos = {};
    const viajeTerminado = {};
    const ofertaVista = {};
    let acordado = null;
    for (const m of data || []) {
      const cid = m.conductor_id;
      const t = new Date(m.created_at).getTime();
      if (!ultimaActividad[cid] || t > ultimaActividad[cid]) {
        ultimaActividad[cid] = t;
        ultimos[cid] = m;
      }
      if (m.remitente === "conductor" && !m.leido) noLeidos[cid] = (noLeidos[cid] || 0) + 1;
      if (m.tipo === "oferta") {
        if (!acordado && ["aceptada", "en_transito"].includes(m.estado_oferta)) acordado = cid;
        // Solo cuenta la oferta MÁS reciente de cada conductor (filas en
        // orden descendente): si terminó, el viaje con él terminó.
        if (!ofertaVista[cid]) {
          ofertaVista[cid] = true;
          if (FIN_DE_VIAJE.includes(m.estado_oferta)) {
            viajeTerminado[cid] = new Date(m.finalizado_at || m.created_at).getTime();
          }
        }
      }
    }
    setDatos({ ultimaActividad, ultimos, noLeidos, viajeTerminado, conductorAcordadoId: acordado });
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

  return { ...datos, recargar: cargar };
}

// Datos públicos (nombre, foto, placa, categoría…) de los conductores con
// los que el pasajero tuvo chat en las últimas 24 h, aunque ya no estén en
// la lista de conectados (migración 20261027100000). `idsKey`: los ids
// separados por coma — se vuelve a pedir cuando cambia el conjunto.
export function useConductoresDeMisChats(activo, idsKey) {
  const [porId, setPorId] = useState({});
  // Foto o nombre cambiados (en vivo): se vuelve a pedir.
  const [version, setVersion] = useState(0);
  usePerfilesEnVivo(() => setVersion((v) => v + 1), activo);
  useEffect(() => {
    if (!activo || !idsKey) return undefined;
    let vivo = true;
    const cargar = () =>
      supabase.rpc("taxi_conductores_de_mis_chats").then(({ data, error }) => {
        if (!vivo || error) return;
        setPorId(Object.fromEntries((data || []).map((c) => [c.id, c])));
      });
    cargar();
    return () => {
      vivo = false;
    };
  }, [activo, idsKey, version]);
  return porId;
}
