import { useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";
import { ESTADO_CONDUCTOR_ACTIVO, ESTADO_CONDUCTOR_OCUPADO } from "../lib/taxiEnums";
import { CANAL_RADAR_PUBLICO } from "./useRadarPublico";

// No hay que escribir en la base en CADA tick del GPS (cada pocos
// segundos) solo para tener "la última posición conocida" fresca — un
// SELECT al abrir el Radar (ver useRadarPublico.js) no necesita
// precisión de tiempo real, el Broadcast ya se encarga de eso mientras
// el Radar sigue abierto. Esto solo evita perder al conductor del todo
// en la carga inicial.
const DB_WRITE_THROTTLE_MS = 8000;

// Topic del canal privado de UNA carrera puntual — mismo criterio que
// ya usa el chat para armar los suyos (conductor_id + pasajero_id, ver
// useChatMensajes.js), así los dos lados llegan al mismo nombre de
// canal sin coordinarse por otra vía.
export function canalViaje(conductorId, pasajeroId) {
  return `viaje-${conductorId}-${pasajeroId}`;
}

// Lado Conductor (montado en ConductorPage.jsx, vive mientras el
// conductor tenga sesión — no depende de que tenga el chat abierto):
// transmite su ubicación en vivo por Broadcast, nunca escribe en la
// base.
//
// Fase 3 "Colectivo" — antes 'En Carrera' apagaba el canal público del
// todo (el auto desaparecía del Radar apenas aceptaba UN pasajero).
// Ahora la visibilidad pública depende de si TODAVÍA HAY LUGAR
// (asientos_ocupados < asientos_totales), no del estado en sí: un auto
// 'En Carrera' con asientos libres sigue en el Radar (con el badge
// "EN CARRERA" de RadarGlobal.jsx) para que otro pasajero lo pueda
// sumar al colectivo — recién desaparece cuando se llena. El canal
// privado del viaje puntual en curso (si lo hay) se transmite EN
// PARALELO al público, nunca en su reemplazo.
//
// Fase 2: el canal se crea DENTRO del cuerpo del efecto y se cierra en
// su propio cleanup (no en un ref aparte) — React garantiza que el
// cleanup de la corrida anterior termina ANTES de arrancar la
// siguiente, así nunca hay dos canales pisándose para el mismo topic
// (la causa real del bug de "pines fantasma" de la ronda pasada).
// `tieneAcceso` (Paywall estricto, ver ConductorPage.jsx): default
// `true` para no romper nada que todavía no pase este parámetro.
// Gatea SOLO el canal PÚBLICO — un conductor a quien se le acaban los
// créditos/la membresía A MITAD DE UN VIAJE YA aceptado sigue pudiendo
// compartir su GPS con ESE pasajero puntual (canalPrivado); cortarle la
// comunicación en plena carrera sería un problema de seguridad/servicio
// mucho peor que dejarlo cobrar esa última carrera ya comprometida.
//
// Fase 5 (Motor de Viajes Simultáneos) — GPS Compartido: `pasajeroEnCarrera`
// (un solo id) pasó a `pasajerosEnCarrera` (array, ver
// useHilosChatConductor.js) — antes, con dos pasajeros a bordo, el
// broadcaster solo abría UN canal privado, dejando al segundo sin señal
// de GPS en vivo. Ahora abre/mantiene un canal privado POR CADA pasajero
// del array, y cada tick de GPS se manda a TODOS a la vez — nunca se
// "apaga" mientras el array no quede vacío, sin importar cuántos otros
// viajes hayan terminado. Cada canal usa el mismo topic de siempre
// (`viaje-{conductorId}-{pasajeroId}`, único por par) — Supabase
// Realtime reparte broadcasts por topic en el servidor, así que dos
// pasajeros distintos escuchando SUS PROPIOS topics nunca compiten ni
// se pisan entre sí, cada uno solo recibe lo suyo.
export function useGpsBroadcaster({
  conductorId,
  estado,
  pasajerosEnCarrera,
  asientosOcupados = 0,
  asientosTotales = 4,
  tieneAcceso = true,
}) {
  const ultimaEscrituraDbRef = useRef(0);
  // Clave estable (ids ordenados y unidos) en vez del array crudo como
  // dependencia — `pasajerosEnCarrera` es un array NUEVO en cada
  // `refresh()` de useHilosChatConductor.js aunque el contenido sea
  // idéntico; sin esto, el efecto de abajo cerraría y reabriría los
  // canales privados (y el watchPosition) en cada refresh de la bandeja,
  // no solo cuando de verdad cambia quién está a bordo.
  const idsPrivados = [...new Set((pasajerosEnCarrera ?? []).filter(Boolean))];
  const pasajerosKey = [...idsPrivados].sort().join(",");

  useEffect(() => {
    if (!conductorId || !navigator.geolocation) return undefined;

    const idsActuales = pasajerosKey ? pasajerosKey.split(",") : [];
    const hayLugar = asientosOcupados < asientosTotales;
    const vaAlPublico = tieneAcceso && hayLugar && (estado === ESTADO_CONDUCTOR_ACTIVO || estado === ESTADO_CONDUCTOR_OCUPADO);
    const vaAlPrivado = estado === ESTADO_CONDUCTOR_OCUPADO && idsActuales.length > 0;

    if (!vaAlPublico && !vaAlPrivado) return undefined;

    const canalPublico = vaAlPublico ? supabase.channel(CANAL_RADAR_PUBLICO) : null;
    canalPublico?.subscribe();
    // Un canal privado por pasajero a bordo/reservado — Map en vez de
    // un único `canalPrivado` suelto, así el broadcast de cada tick
    // puede iterarlos a todos.
    const canalesPrivados = vaAlPrivado
      ? new Map(
          idsActuales.map((pasajeroId) => {
            const canal = supabase.channel(canalViaje(conductorId, pasajeroId));
            canal.subscribe();
            return [pasajeroId, canal];
          })
        )
      : new Map();

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        // Público: hace falta identificar DE QUIÉN es cada punto (muchos
        // conductores comparten el canal). Privado: sobra, son los
        // únicos dos ahí — mismo formato exacto que pide la Fase 3
        // original ({lat,lng}). Se manda el MISMO punto a cada canal
        // privado — es la posición real del único vehículo, cada
        // pasajero a bordo/reservado la necesita igual.
        canalPublico?.send({ type: "broadcast", event: "gps_update", payload: { conductorId, lat, lng } });
        canalesPrivados.forEach((canal) => canal.send({ type: "broadcast", event: "gps_update", payload: { lat, lng } }));

        // Bug del Radar Ciego: además del Broadcast (en vivo mientras el
        // Radar sigue abierto), se guarda la última posición en la
        // propia fila del conductor — así useRadarPublico.js tiene algo
        // real que traer con un SELECT apenas se monta, en vez de
        // depender 100% de que llegue un tick nuevo justo después de
        // que el pasajero se suscribió. Solo mientras haya lugar
        // público (mismo criterio que decide si se transmite o no) y
        // con throttle — no hace falta un UPDATE por cada tick del GPS.
        if (vaAlPublico) {
          const ahora = Date.now();
          if (ahora - ultimaEscrituraDbRef.current > DB_WRITE_THROTTLE_MS) {
            ultimaEscrituraDbRef.current = ahora;
            supabase
              .from("conductores")
              .update({ ultima_lat: lat, ultima_lng: lng, ultima_actualizacion: new Date().toISOString() })
              .eq("id", conductorId)
              .then(({ error }) => {
                if (error) console.error("No se pudo guardar la última posición del conductor:", error);
              });
          }
        }
      },
      () => {
        // Sin permiso de GPS no hay nada que transmitir — el radar
        // simplemente no muestra a este conductor, no es un error fatal.
      },
      // Fix Precisión GPS: `maximumAge: 0` obliga al navegador a pedir
      // una lectura FRESCA del chip GPS en cada tick — antes 5000ms de
      // caché podía devolver una posición vieja (basada en red/torres
      // celulares) en vez del fix real de satélite, sobre todo en
      // interiores o con mala señal.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    // Limpieza estricta de TODOS los canales (público + cada privado) —
    // se ejecuta ANTES de que el efecto vuelva a correr (cambió el
    // estado, los asientos, o la lista de pasajeros a bordo) y también
    // al desmontar del todo.
    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (canalPublico) supabase.removeChannel(canalPublico);
      canalesPrivados.forEach((canal) => supabase.removeChannel(canal));
    };
    // `pasajerosKey` (no el array `pasajerosEnCarrera`) a propósito, ver
    // el comentario de arriba — es la identidad real que debe reiniciar
    // este efecto, no una referencia nueva con el mismo contenido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conductorId, estado, pasajerosKey, asientosOcupados, asientosTotales, tieneAcceso]);
}
