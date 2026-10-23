import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Créditos (puntos) del cliente con sesión, en vivo: su propia fila de
// `usuarios` (la base los suma al confirmarse una compra en Caja Tonazo y
// los resta si se anula — fase B). Realtime + respaldo al volver a la
// pestaña y cada 60 s. `null` mientras carga o sin sesión.
export function useMisCreditos(usuarioId) {
  const [creditos, setCreditos] = useState(null);

  const refresh = useCallback(async () => {
    if (!usuarioId) {
      setCreditos(null);
      return;
    }
    const { data, error } = await supabase
      .from("usuarios")
      .select("creditos_disponibles")
      .eq("id", usuarioId)
      .maybeSingle();
    if (!error && data) setCreditos(Number(data.creditos_disponibles) || 0);
  }, [usuarioId]);

  useEffect(() => {
    refresh();
    if (!usuarioId) return undefined;
    const channel = supabase
      .channel(`mis-creditos-${usuarioId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "usuarios", filter: `id=eq.${usuarioId}` },
        ({ new: fila }) => {
          if (fila && "creditos_disponibles" in fila) setCreditos(Number(fila.creditos_disponibles) || 0);
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

  return creditos;
}
