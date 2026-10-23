import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";

// Anular una venta: UNA operación de la base (taxi_anular_venta,
// migración 20261011130000). Le quita al conductor lo que recibió (los
// créditos, sin bajar de 0, o los días de membresía), le devuelve al
// recolector los créditos que gastó en esa venta y marca
// `ventas.anulado = true` — no se borra la fila, queda en el Historial con
// su badge. Si fue Fiado, la deuda vinculada queda 'anulado'.
//
// El Admin anula cualquier venta; cada recolector solo las suyas (la base
// lo hace cumplir). Si la venta era Fiado y no apareció la deuda (datos de
// antes de que existiera venta_id), se avisa para revisarla a mano.
//
// (`conductor` / `cliente` se siguen recibiendo para no cambiar a quien
// llama, pero la base ya sabe a quién revertir.)
const MENSAJES = {
  sin_permiso: "Solo puedes anular tus propias ventas.",
  no_existe: "No se encontró la venta.",
  ya_anulada: "Esta venta ya estaba anulada.",
  ya_cerrada: "Esta venta ya entró en un cierre de caja: ya no se puede anular.",
};

export function useAnularVenta({ onDone }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const anular = useCallback(
    async (venta) => {
      setBusyId(venta.id);
      setError("");

      const { data, error: rpcError } = await supabase.rpc("taxi_anular_venta", { p_venta_id: String(venta.id) });
      setBusyId(null);
      if (rpcError || data?.estado !== "ok") {
        const message = rpcError ? "No se pudo anular la venta." : MENSAJES[data?.estado] || "No se pudo anular la venta.";
        setError(message);
        return { error: rpcError || new Error(data?.estado || "error"), message };
      }

      onDone?.();
      return { error: null, eraFiado: !!data.era_fiado, fiadoEncontrado: data.fiado_encontrado !== false };
    },
    [onDone]
  );

  return { anular, busyId, error };
}
