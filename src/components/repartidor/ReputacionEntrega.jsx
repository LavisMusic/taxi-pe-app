import { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";
import { supabaseCaja } from "../../lib/supabaseCaja";
import InsigniaReputacion from "../InsigniaReputacion";

/* Estrellas del negocio o del cliente de una entrega, para el repartidor
   (fase 3 de Reportes y reputación). Su reputación vive en Caja: Taxi-PE
   da el pedido y el token de ESA entrega (solo a su repartidor o a quien
   tiene la oferta) y Caja responde solo con ese token. Una consulta por
   entrega, compartida entre el negocio y el cliente. */

const cache = new Map();

function leer(entregaId) {
  if (!cache.has(entregaId)) {
    cache.set(
      entregaId,
      (async () => {
        const { data: claves } = await supabase.rpc("taxi_entrega_claves", { p_entrega_id: entregaId });
        if (!claves?.caja_pedido_ref || !claves?.session_token) return null;
        const { data } = await supabaseCaja.rpc("caja_reputacion_entrega", {
          p_pedido: claves.caja_pedido_ref,
          p_token: String(claves.session_token),
        });
        return data || null;
      })().catch(() => null)
    );
    // Se vuelve a leer a los 5 minutos (por si cambió).
    setTimeout(() => cache.delete(entregaId), 300000);
  }
  return cache.get(entregaId);
}

export default function ReputacionEntrega({ entregaId, tipo }) {
  const [rep, setRep] = useState(null);
  useEffect(() => {
    let vivo = true;
    if (entregaId) leer(entregaId).then((d) => vivo && setRep(d?.[tipo] || null));
    return () => {
      vivo = false;
    };
  }, [entregaId, tipo]);
  if (!rep) return null;
  return <InsigniaReputacion rep={rep} etiquetas={rep.etiquetas || []} tamano="chico" />;
}
