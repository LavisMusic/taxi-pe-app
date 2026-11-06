import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Gemas del pasajero con sesión, en vivo (Gemas cruzadas, migración
// 20261106100000_gemas.sql): su propia fila de `usuarios` trae la copia de
// las verdes (viven acá) y las celestes (viven en Caja Tonazo). Realtime +
// respaldo al volver a la pestaña y cada 60 s. `null` mientras carga o sin
// sesión; si no, { verdes, celestes }.
export function useMisGemas(usuarioId) {
  const [gemas, setGemas] = useState(null);

  const refresh = useCallback(async () => {
    if (!usuarioId) {
      setGemas(null);
      return;
    }
    const { data, error } = await supabase
      .from("usuarios")
      .select("gemas_verdes, gemas_celestes")
      .eq("id", usuarioId)
      .maybeSingle();
    if (!error && data) {
      setGemas({ verdes: Number(data.gemas_verdes) || 0, celestes: Number(data.gemas_celestes) || 0 });
    }
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
          if (fila && "gemas_verdes" in fila) {
            setGemas({ verdes: Number(fila.gemas_verdes) || 0, celestes: Number(fila.gemas_celestes) || 0 });
          }
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
