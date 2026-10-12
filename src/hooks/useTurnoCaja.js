import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Turno de caja de quien tiene la sesión (Admin o recolector), según la
// base (taxi_estado_caja, migración 20261012110000): empieza al cerrar el
// anterior y debe cerrarse a las 00:00 (hora de Perú); se puede extender
// de 30 en 30 minutos. `vencido` se recalcula solo cada 30 s para que el
// aviso salga a la hora, y el estado se vuelve a pedir cada minuto y al
// volver a la pestaña.
export function useTurnoCaja() {
  const [estado, setEstado] = useState(null);
  const [ahora, setAhora] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc("taxi_estado_caja");
    if (!error) setEstado(data ?? null);
  }, []);

  useEffect(() => {
    refresh();
    const reloj = setInterval(() => setAhora(Date.now()), 30000);
    const sondeo = setInterval(refresh, 60000);
    const alVolver = () => {
      if (document.visibilityState === "visible") {
        setAhora(Date.now());
        refresh();
      }
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(reloj);
      clearInterval(sondeo);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [refresh]);

  const extender = useCallback(async () => {
    const { data, error } = await supabase.rpc("taxi_extender_turno");
    if (error || data?.estado !== "ok") return { error: error || new Error(data?.estado || "error") };
    setEstado(data);
    setAhora(Date.now());
    return { error: null };
  }, []);

  const limite = estado
    ? Math.max(new Date(estado.vence).getTime(), estado.extendido_hasta ? new Date(estado.extendido_hasta).getTime() : 0)
    : null;
  const vencido = limite != null && ahora >= limite;

  return { estado, desde: estado?.desde ?? null, limite, vencido, refresh, extender };
}
