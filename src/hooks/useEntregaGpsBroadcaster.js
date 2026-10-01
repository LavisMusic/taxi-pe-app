import { useEffect } from "react";
import { supabase } from "../supabaseClient";
import { canalEntrega } from "./useEntregasRepartidor";

// Mientras el repartidor tiene entregas ACTIVAS (aceptado o en_ruta —
// ahora puede tener varias a la vez, ver DELIVERY.md §9) transmite su
// GPS por Broadcast en `entrega-<id>` de CADA UNA (cero costo de fila)
// y ADEMÁS guarda la última posición en `entregas.repartidor_*` de cada
// una con throttle (10 s) — así, si se le bloquea la pantalla y el
// broadcast se corta, el otro lado tiene un último punto y puede
// mostrar "hace X min". Un solo `watchPosition` para todas — no uno por
// entrega, sería pedirle el GPS al navegador varias veces por nada.
//
// Al volver la app a primer plano fuerza un fix fresco (el watchPosition
// puede haber quedado dormido).
const DB_THROTTLE_MS = 10000;

export function useEntregaGpsBroadcaster(entregaIds, conductorId) {
  // Clave estable (ids ordenados y unidos) en vez del array crudo como
  // dependencia — mismo criterio que useGpsBroadcaster.js con
  // 'pasajerosEnCarrera': un array nuevo en cada refresh() del panel no
  // debe reabrir los canales si el contenido es idéntico.
  const idsUnicos = [...new Set((entregaIds ?? []).filter(Boolean))];
  const idsKey = [...idsUnicos].sort().join(",");

  useEffect(() => {
    const idsActuales = idsKey ? idsKey.split(",") : [];
    if (idsActuales.length === 0 || !navigator.geolocation) return undefined;

    const canales = idsActuales.map((id) => {
      const ch = supabase.channel(canalEntrega(id), { config: { broadcast: { ack: false } } });
      ch.subscribe();
      return { id, ch };
    });
    let ultimoDb = 0;

    const emitir = (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      canales.forEach(({ ch }) =>
        ch.send({ type: "broadcast", event: "gps", payload: { lat, lng, t: Date.now() } }).catch(() => {})
      );
      if (conductorId && Date.now() - ultimoDb > DB_THROTTLE_MS) {
        ultimoDb = Date.now();
        canales.forEach(({ id }) => {
          supabase
            .rpc("rpc_entrega_pos", { p_entrega_id: id, p_conductor_id: conductorId, p_lat: lat, p_lng: lng })
            .catch(() => {});
        });
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
      canales.forEach(({ ch }) => supabase.removeChannel(ch));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, conductorId]);
}
