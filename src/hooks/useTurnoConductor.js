import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Turnos del conductor (viajes + repartos juntos). Todo lo calcula la base
// (migración 20261014160000): el turno abierto va desde el cierre anterior
// hasta ahora; "Cerrar turno" lo guarda en el historial y el nuevo arranca
// en cero. "Limpiar historial" solo oculta los turnos guardados: las
// estadísticas salen de los viajes y entregas reales.

export function useTurnoConductor(conductorId) {
  const [historial, setHistorial] = useState([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const turnoActual = useCallback(async () => {
    const { data, error } = await supabase.rpc("taxi_turno_actual_conductor");
    return error ? null : data;
  }, []);

  const cerrarTurno = useCallback(async () => {
    const { data, error } = await supabase.rpc("taxi_cerrar_turno_conductor");
    if (error || data?.estado !== "ok") return { error: error || new Error(data?.estado || "error") };
    return { turno: data.turno, error: null };
  }, []);

  const refrescarHistorial = useCallback(async () => {
    if (!conductorId) return;
    setCargandoHistorial(true);
    const { data, error } = await supabase
      .from("taxi_conductor_turnos")
      .select("id, desde, hasta, viajes, ganado_viajes, entregas, ganado_envios, minutos_taxi, minutos_delivery, detalle")
      .eq("conductor_id", conductorId)
      .eq("oculto", false)
      .order("hasta", { ascending: false })
      .limit(100);
    if (!error) setHistorial(data ?? []);
    setCargandoHistorial(false);
  }, [conductorId]);

  const limpiarHistorial = useCallback(async () => {
    const { error } = await supabase.rpc("taxi_limpiar_historial_turnos");
    if (!error) setHistorial([]);
    return { error };
  }, []);

  return { turnoActual, cerrarTurno, historial, cargandoHistorial, refrescarHistorial, limpiarHistorial };
}

// Estadísticas (hoy / semana / mes), refrescadas cada 60 s y al volver a la
// pestaña. `null` mientras carga.
export function useEstadisticasConductor(conductorId) {
  const [estadisticas, setEstadisticas] = useState(null);

  const refrescar = useCallback(async () => {
    if (!conductorId) return;
    const { data, error } = await supabase.rpc("taxi_estadisticas_conductor");
    if (!error && data) setEstadisticas(data);
  }, [conductorId]);

  useEffect(() => {
    refrescar();
    if (!conductorId) return undefined;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refrescar();
    }, 60000);
    const alVolver = () => {
      if (document.visibilityState === "visible") refrescar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [conductorId, refrescar]);

  return { estadisticas, refrescar };
}

export function formatMinutos(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}
