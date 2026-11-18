import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Gemas del pasajero con sesión, en vivo (Gemas cruzadas, migración
// 20261106100000_gemas.sql): su propia fila de `usuarios` trae la copia de
// las verdes (viven acá) y las celestes (viven en Caja Tonazo). Realtime +
// respaldo al volver a la pestaña y cada 60 s. `null` mientras carga o sin
// sesión; si no, { verdes, celestes, devueltas }.
//
// `devueltas` / `devueltasCelestes`: cuántas gemas se le devolvieron
// (acumulado: viajes cancelados las verdes, pedidos o ventas canceladas en
// Caja las celestes; migraciones 20261202100000 y 20261203100000).
// SaldoGemas las usa para no festejar como "ganada" una gema que solo volvió
// a su saldo. `null` si la base todavía no tiene esas columnas.
const COLUMNAS = "gemas_verdes, gemas_celestes, gemas_verdes_devueltas, gemas_celestes_devueltas";
const COLUMNAS_SIN_DEVUELTAS = "gemas_verdes, gemas_celestes";

const deFila = (fila) => ({
  verdes: Number(fila.gemas_verdes) || 0,
  celestes: Number(fila.gemas_celestes) || 0,
  devueltas: fila.gemas_verdes_devueltas == null ? null : Number(fila.gemas_verdes_devueltas) || 0,
  devueltasCelestes: fila.gemas_celestes_devueltas == null ? null : Number(fila.gemas_celestes_devueltas) || 0,
});

export function useMisGemas(usuarioId) {
  const [gemas, setGemas] = useState(null);

  const refresh = useCallback(async () => {
    if (!usuarioId) {
      setGemas(null);
      return;
    }
    let { data, error } = await supabase.from("usuarios").select(COLUMNAS).eq("id", usuarioId).maybeSingle();
    if (error) {
      // Sin la migración nueva: como antes.
      ({ data, error } = await supabase.from("usuarios").select(COLUMNAS_SIN_DEVUELTAS).eq("id", usuarioId).maybeSingle());
    }
    if (!error && data) setGemas(deFila(data));
  }, [usuarioId]);

  useEffect(() => {
    refresh();
    if (!usuarioId) return undefined;
    const channel = supabase
      .channel(`mis-gemas-${usuarioId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "usuarios", filter: `id=eq.${usuarioId}` },
        ({ new: fila }) => {
          if (fila && "gemas_verdes" in fila) setGemas(deFila(fila));
        }
      )
      .subscribe();
    const sondeo = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60000);
    const alVolver = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(sondeo);
      document.removeEventListener("visibilitychange", alVolver);
      supabase.removeChannel(channel);
    };
  }, [usuarioId, refresh]);

  return gemas;
}
