import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { ESTADO_CONDUCTOR_ACTIVO, ESTADO_CONDUCTOR_OCUPADO } from "../lib/taxiEnums";

// Canal público compartido por TODOS los conductores "Libres" — cada
// uno transmite su posición acá en vivo (ver useGpsBroadcaster.js, lado
// Conductor). Puro Realtime Broadcast, no toca ninguna tabla para las
// actualizaciones en vivo: cero costo de fila en la base por cada
// movimiento del GPS.
export const CANAL_RADAR_PUBLICO = "radar_publico";

// Lado Pasajero (RadarGlobal.jsx) — solo escucha broadcast, nunca
// transmite acá. Devuelve un mapa { [conductorId]: {lat,lng} } con la
// última posición conocida de cada conductor.
export function useRadarPublico() {
  const [posiciones, setPosiciones] = useState({});

  // Bug del Radar Ciego: antes esto era 100% Broadcast — un pasajero
  // que recién abría el Radar no veía a NADIE hasta que llegara el
  // PRIMER tick de GPS nuevo después de suscribirse. Si el conductor
  // tenía el celular quieto (sin movimiento real, watchPosition no
  // dispara), esa espera podía ser larga — "no ve conductores a menos
  // que el conductor cambie de estado a mano" (eso sí retriggerea
  // useGpsBroadcaster.js y fuerza un tick fresco). Ahora se hace un
  // fetch inicial a `conductores` (con `ultima_lat`/`ultima_lng`, que
  // useGpsBroadcaster.js va guardando con throttle) para sembrar el
  // mapa de una — el Broadcast sigue siendo quien lo mantiene fresco
  // mientras el Radar sigue abierto, esto solo cubre la carga inicial.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase
        .from("conductores")
        .select("id, ultima_lat, ultima_lng, asientos_ocupados, asientos_totales, creditos, vencimiento_suscripcion")
        .in("estado", [ESTADO_CONDUCTOR_ACTIVO, ESTADO_CONDUCTOR_OCUPADO])
        .not("ultima_lat", "is", null)
        .not("ultima_lng", "is", null);
      if (cancelado || error || !data) return;

      const iniciales = {};
      for (const c of data) {
        const ocupados = c.asientos_ocupados ?? 0;
        const totales = c.asientos_totales ?? 4;
        // Mismo criterio de useGpsBroadcaster.js: sin lugar, ese
        // conductor tampoco estaría transmitiendo al público — no
        // resucitarlo acá con una posición vieja.
        if (ocupados >= totales) continue;
        // Paywall Estricto: mismo criterio que ConductorPage.jsx
        // (tieneAcceso) — membresía vigente O créditos > 0. Sin esto,
        // un conductor sin saldo cuyo `estado` sigue "activo" en la
        // base (columna vieja, todavía no la actualizó el auto-apagado)
        // igual aparecía sembrado acá en la carga inicial del Radar.
        const vencida = c.vencimiento_suscripcion ? new Date(c.vencimiento_suscripcion) < new Date() : false;
        const tieneAcceso = !vencida || (c.creditos ?? 0) > 0;
        if (!tieneAcceso) continue;
        iniciales[c.id] = { lat: c.ultima_lat, lng: c.ultima_lng };
      }
      // El Broadcast pudo haber llegado ANTES de que este fetch
      // resolviera (es async) — se pisa con lo ya recibido, nunca al
      // revés, para no reemplazar un dato más fresco por uno viejo.
      setPosiciones((prev) => ({ ...iniciales, ...prev }));
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(CANAL_RADAR_PUBLICO)
      .on("broadcast", { event: "gps_update" }, ({ payload }) => {
        if (!payload?.conductorId || typeof payload.lat !== "number" || typeof payload.lng !== "number") return;
        setPosiciones((prev) => ({ ...prev, [payload.conductorId]: { lat: payload.lat, lng: payload.lng } }));
      })
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  return posiciones;
}
