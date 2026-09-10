import { useEffect } from "react";
import { supabase } from "../supabaseClient";
import { canalEntrega } from "./useEntregasRepartidor";

// Mientras el repartidor tiene una entrega activa transmite su GPS por
// Broadcast en `entrega-<id>` (cero costo de fila) y ADEMÁS guarda la
// última posición en `entregas.repartidor_*` con throttle (10 s) — así,
// si se le bloquea la pantalla y el broadcast se corta, el otro lado
// tiene un último punto y puede mostrar "hace X min".
//
// Al volver la app a primer plano fuerza un fix fresco (el watchPosition
// puede haber quedado dormido).
const DB_THROTTLE_MS = 10000;

export function useEntregaGpsBroadcaster(entregaId, conductorId) {
  useEffect(() => {
    if (!entregaId || !navigator.geolocation) return;

    const ch = supabase.channel(canalEntrega(entregaId), { config: { broadcast: { ack: false } } });
    ch.subscribe();
    let ultimoDb = 0;

    const emitir = (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      ch.send({ type: "broadcast", event: "gps", payload: { lat, lng, t: Date.now() } }).catch(() => {});
      if (conductorId && Date.now() - ultimoDb > DB_THROTTLE_MS) {
        ultimoDb = Date.now();
        supabase
          .rpc("rpc_entrega_pos", { p_entrega_id: entregaId, p_conductor_id: conductorId, p_lat: lat, p_lng: lng })
          .catch(() => {});
      }
    };

    const watchId = navigator.geolocation.watchPosition(emitir, () => {}, {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 20000,
    });

    const alVolver = () => {
      if (document.visibilityState === "visible") {
        navigator.geolocation.getCurrentPosition(emitir, () => {}, { enableHighAccuracy: true, maximumAge: 0 });
      }
    };
    document.addEventListener("visibilitychange", alVolver);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      document.removeEventListener("visibilitychange", alVolver);
      supabase.removeChannel(ch);
    };
  }, [entregaId, conductorId]);
}
