import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Historial de cierres de quien tiene la sesión — cada uno ve SOLO los
// suyos (el Admin los del Admin, cada recolector los propios; ver la
// migración 20261012110000). El cierre lo hace la base
// (taxi_cerrar_caja): calcula los totales del turno, guarda el arqueo
// (efectivo contado vs. esperado) y arranca el turno siguiente.
export function useCierresCaja() {
  const [cierres, setCierres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("cierres_caja")
      .select(
        "id, cajero_nombre, desde, hasta, recaudado_total, total_efectivo, total_digital, total_fiado, total_gastos, balance_neto, ventas_registradas, ticket_general, efectivo_esperado, efectivo_real, diferencia, created_at"
      )
      .order("hasta", { ascending: false });

    if (fetchError) {
      setError("No se pudo cargar el historial de cierres.");
      setCierres([]);
    } else {
      setCierres(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const crearCierre = useCallback(
    async ({ efectivoReal }) => {
      const { data, error: rpcError } = await supabase.rpc("taxi_cerrar_caja", { p_efectivo_real: efectivoReal });
      if (rpcError || data?.estado !== "ok") {
        return { error: rpcError || new Error(data?.estado || "error") };
      }
      await refresh();
      return { error: null, cierre: data.cierre };
    },
    [refresh]
  );

  return { cierres, loading, error, refresh, crearCierre };
}
