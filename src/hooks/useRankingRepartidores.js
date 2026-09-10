import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Ranking semanal de repartidores: entregas concretadas ('entregado') en
// los últimos 7 días corridos. Vive en la tabla 'entregas' (delivery
// Caja Tonazo ↔ Taxi-PE), no en 'ventas', así que va por su propio RPC
// en vez de buildTopRanking. Ver DELIVERY.md §7.
export function useRankingRepartidores() {
  const [repartidores, setRepartidores] = useState([]);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("rpc_ranking_repartidores");
    if (error) {
      console.error("[useRankingRepartidores]", error.message);
      return;
    }
    setRepartidores(
      (data ?? []).map((r) => ({
        id: r.conductor_id,
        nombre: r.nombre,
        entregas: Number(r.entregas) || 0,
      }))
    );
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return { repartidores, refrescar: cargar };
}
