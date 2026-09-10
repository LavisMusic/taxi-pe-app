import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

// Lado repartidor del delivery Caja Tonazo ↔ Taxi-PE (ver DELIVERY.md).
// Todo pasa por RPCs `security definer` — este proyecto no tiene RLS por
// usuario para el conductor (identidad a nivel app), así que el hook
// manda siempre `p_conductor_id`.
//
// - `ofertas`: entregas en estado 'buscando' que el cajero le ofreció a
//   ESTE conductor (varias a la vez; gana el primero que acepta).
// - `entregaActiva`: su entrega en curso ('aceptado' | 'retirado' | 'en_ruta').
//
// Polling cada 8 s + al volver el foco a la pestaña (mismo criterio que
// el resto de la app — ver useConductorSesion.js). Cuando hay entrega
// activa, además se suscribe al canal Broadcast `entrega-<id>` para
// refrescar al toque ante cambios de estado / mensajes.

const POLL_MS = 8000;

export function canalEntrega(entregaId) {
  return `entrega-${entregaId}`;
}

export function useEntregasRepartidor(conductorId) {
  const [ofertas, setOfertas] = useState([]);
  const [entregaActiva, setEntregaActiva] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const yaCargo = useRef(false);

  const refresh = useCallback(async () => {
    if (!conductorId) {
      setOfertas([]);
      setEntregaActiva(null);
      setLoading(false);
      return;
    }
    if (!yaCargo.current) setLoading(true);

    const [ofertasRes, activaRes] = await Promise.all([
      supabase.rpc("rpc_entrega_ofertas_conductor", { p_conductor_id: conductorId }),
      supabase.rpc("rpc_entrega_activa_conductor", { p_conductor_id: conductorId }),
    ]);

    if (ofertasRes.error || activaRes.error) {
      setError("No se pudieron cargar las entregas.");
    } else {
      setError("");
      setOfertas(ofertasRes.data ?? []);
      setEntregaActiva((activaRes.data && activaRes.data[0]) || null);
    }
    yaCargo.current = true;
    setLoading(false);
  }, [conductorId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  // Refresco instantáneo por Broadcast mientras hay entrega activa.
  useEffect(() => {
    if (!entregaActiva?.id) return;
    const ch = supabase
      .channel(canalEntrega(entregaActiva.id))
      .on("broadcast", { event: "estado" }, refresh)
      .on("broadcast", { event: "mensaje" }, refresh)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [entregaActiva?.id, refresh]);

  const aceptar = useCallback(
    async (ofertaId) => {
      const { data, error: e } = await supabase.rpc("rpc_entrega_aceptar", {
        p_oferta_id: ofertaId,
        p_conductor_id: conductorId,
      });
      await refresh();
      return { status: e ? "error" : data?.status, error: e };
    },
    [conductorId, refresh]
  );

  const rechazar = useCallback(
    async (ofertaId, entregaId) => {
      const { data, error: e } = await supabase.rpc("rpc_entrega_rechazar", {
        p_oferta_id: ofertaId,
        p_conductor_id: conductorId,
      });
      // Avisa al cajero (radar) que este conductor rechazó.
      if (!e && entregaId) {
        await supabase
          .channel(canalEntrega(entregaId))
          .send({ type: "broadcast", event: "oferta", payload: { estado: "rechazada", conductor_id: conductorId } })
          .catch(() => {});
      }
      await refresh();
      return { status: e ? "error" : data?.status, error: e };
    },
    [conductorId, refresh]
  );

  const avanzar = useCallback(
    async (entregaId, nuevo) => {
      const { data, error: e } = await supabase.rpc("rpc_entrega_avanzar", {
        p_entrega_id: entregaId,
        p_conductor_id: conductorId,
        p_nuevo: nuevo,
      });
      if (!e) {
        await supabase.channel(canalEntrega(entregaId)).send({
          type: "broadcast",
          event: "estado",
          payload: { estado: nuevo },
        }).catch(() => {});
      }
      await refresh();
      return { status: e ? "error" : data?.status, error: e };
    },
    [conductorId, refresh]
  );

  const finalizar = useCallback(
    async (entregaId, pin) => {
      const { data, error: e } = await supabase.rpc("rpc_entrega_finalizar", {
        p_entrega_id: entregaId,
        p_conductor_id: conductorId,
        p_pin: String(pin || "").trim(),
      });
      if (!e && data?.status === "ok") {
        await supabase.channel(canalEntrega(entregaId)).send({
          type: "broadcast",
          event: "estado",
          payload: { estado: "entregado" },
        }).catch(() => {});
      }
      await refresh();
      return { status: e ? "error" : data?.status, error: e };
    },
    [conductorId, refresh]
  );

  return { ofertas, entregaActiva, loading, error, refresh, aceptar, rechazar, avanzar, finalizar };
}
