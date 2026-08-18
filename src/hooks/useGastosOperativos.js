import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { startOfTodayISO } from "../lib/taxiEnums";

// Libreta de Gastos Operativos — tabla nueva (`gastos_operativos`, ver
// el SQL que le pasamos al usuario), exclusiva del Admin. Reemplaza al
// modal de "Gastos" de la caja registradora vieja, que mezclaba compra
// de stock/insumos con gastos fijos del negocio — acá es solo salidas
// de dinero (servidor, etc.), sin nada de inventario.
export function useGastosOperativos() {
  const [gastos, setGastos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("gastos_operativos")
      .select("id, concepto, monto, created_at")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError("No se pudieron cargar los gastos operativos.");
      setGastos([]);
    } else {
      setGastos(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const agregarGasto = useCallback(
    async ({ concepto, monto }) => {
      const { error: insertError } = await supabase
        .from("gastos_operativos")
        .insert({ concepto, monto });
      if (!insertError) await refresh();
      return { error: insertError };
    },
    [refresh]
  );

  const eliminarGasto = useCallback(
    async (id) => {
      const { error: deleteError } = await supabase.from("gastos_operativos").delete().eq("id", id);
      if (!deleteError) await refresh();
      return { error: deleteError };
    },
    [refresh]
  );

  const startToday = startOfTodayISO();
  const gastosHoy = gastos.filter((g) => g.created_at && g.created_at >= startToday);
  const totalGastosHoy = gastosHoy.reduce((sum, g) => sum + Number(g.monto || 0), 0);

  return {
    gastos,
    gastosHoy,
    totalGastosHoy,
    loading,
    error,
    refresh,
    agregarGasto,
    eliminarGasto,
  };
}
