import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Historial de cierres — una fila = una instantánea de "Cerrar turno"
// (ver CierreCajaModal.jsx). A diferencia de la caja registradora vieja
// (App.jsx: tabla `estado_caja` con apertura/fondo inicial/efectivo
// real y arqueo), acá `ventas`/`gastos_operativos` no están particionados
// por turno — "Cerrar turno" es solo un snapshot informativo de los
// totales de HOY en el momento de cerrar, para exportar/compartir; no
// reinicia ningún contador ni abre/cierra caja de verdad.
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
        "id, cajero_nombre, recaudado_total, total_gastos, balance_neto, ventas_registradas, ticket_general, created_at"
      )
      .order("created_at", { ascending: false });

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
    async ({ cajeroNombre, recaudadoTotal, totalGastos, balanceNeto, ventasRegistradas, ticketGeneral }) => {
      const { error: insertError } = await supabase.from("cierres_caja").insert({
        cajero_nombre: cajeroNombre || "Admin",
        recaudado_total: recaudadoTotal,
        total_gastos: totalGastos,
        balance_neto: balanceNeto,
        ventas_registradas: ventasRegistradas,
        ticket_general: ticketGeneral,
      });
      if (!insertError) await refresh();
      return { error: insertError };
    },
    [refresh]
  );

  return { cierres, loading, error, refresh, crearCierre };
}
