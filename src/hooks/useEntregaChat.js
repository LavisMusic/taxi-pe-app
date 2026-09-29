import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { canalEntrega } from "./useEntregasRepartidor";

// Chat de una entrega delivery. Historial + persistencia por RPC
// (`rpc_entrega_mensajes` / `rpc_entrega_mensaje_nuevo`); entrega
// instantánea por Broadcast en el canal `entrega-<id>` (mismo patrón que
// useChatMensajes de los viajes).
//
// Auth: el repartidor pasa `entregaId` + `conductorId`; el cajero/cliente
// (app Caja, a futuro) pasan `sessionToken`. `emisorRol` es 'conductor' |
// 'cajero' | 'cliente'.

export function useEntregaChat({ entregaId, conductorId = null, sessionToken = null, emisorRol }) {
  const [mensajes, setMensajes] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const ultimaCarga = useRef("-infinity");
  // Canal persistente para reusar al emitir (ver 'enviar' más abajo) —
  // antes cada mensaje abría un canal NUEVO y emitía sin haberlo
  // suscrito nunca, así que pagaba el handshake de "join" de Realtime
  // completo en cada envío. Eso explicaba el retraso real reportado
  // del lado del cliente (Caja): el mensaje llegaba recién en el
  // siguiente poll de 8s en vez de instantáneo. Mismo patrón que
  // useChatMensajes.js (channelRef) para el chat de viajes.
  const channelRef = useRef(null);

  const cargar = useCallback(async () => {
    if (!entregaId) return;
    const { data, error } = await supabase.rpc("rpc_entrega_mensajes", {
      p_session_token: sessionToken,
      p_entrega_id: sessionToken ? null : entregaId,
      p_conductor_id: sessionToken ? null : conductorId,
      p_desde: "-infinity",
    });
    if (!error && data) {
      setMensajes(data);
      if (data.length) ultimaCarga.current = data[data.length - 1].created_at;
    }
  }, [entregaId, conductorId, sessionToken]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!entregaId) return;
    const ch = supabase
      .channel(canalEntrega(entregaId))
      .on("broadcast", { event: "mensaje" }, cargar)
      .subscribe();
    channelRef.current = ch;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [entregaId, cargar]);

  const marcarLeido = useCallback(
    async (hilo) => {
      if (!entregaId || !hilo) return;
      await supabase.rpc("rpc_entrega_marcar_leido", {
        p_hilo: hilo,
        p_rol_propio: emisorRol,
        p_session_token: sessionToken,
        p_entrega_id: sessionToken ? null : entregaId,
        p_conductor_id: sessionToken ? null : conductorId,
      });
    },
    [entregaId, conductorId, sessionToken, emisorRol]
  );

  const enviar = useCallback(
    async (hilo, texto) => {
      const mensaje = String(texto || "").trim();
      if (!mensaje) return { error: new Error("Mensaje vacío") };
      setEnviando(true);
      const { data, error } = await supabase.rpc("rpc_entrega_mensaje_nuevo", {
        p_hilo: hilo,
        p_emisor_rol: emisorRol,
        p_mensaje: mensaje,
        p_session_token: sessionToken,
        p_entrega_id: sessionToken ? null : entregaId,
        p_conductor_id: sessionToken ? null : conductorId,
      });
      setEnviando(false);
      if (!error && data?.status === "ok") {
        channelRef.current
          ?.send({ type: "broadcast", event: "mensaje", payload: { hilo } })
          .catch(() => {});
        await cargar();
        return { error: null };
      }
      return { error: error || new Error(data?.status || "No se pudo enviar") };
    },
    [entregaId, conductorId, sessionToken, emisorRol, cargar]
  );

  return { mensajes, enviar, enviando, recargar: cargar, marcarLeido };
}
