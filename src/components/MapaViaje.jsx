import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2 } from "lucide-react";
import { supabase } from "../supabaseClient";
import { REMITENTE_PASAJERO } from "../hooks/useChatMensajes";
import { canalViaje } from "../hooks/useGpsBroadcaster";
import { distanciaMetros } from "../lib/haversine";
import { COORD_DEFAULT } from "../hooks/useLocalidades";
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION } from "../lib/mapboxConfig";
import { COLOR_PASAJERO_MAPA } from "../lib/nivelServicio";

function iconoPunto(color, emoji) {
  return L.divIcon({
    className: "tz-radar-marker-wrap",
    html: `<span class="tz-radar-marker" style="--tz-marker-color:${color}">${emoji}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// Panel de Categorías e Íconos: mismo criterio que iconoVehiculo() en
// RadarGlobal.jsx — si el Admin configuró un ícono para la categoría de
// este conductor, se usa esa imagen en vez del 🚖 genérico. Tamaño
// acorde a este mapa (mucho más chico que el del Radar — 26px, no
// 48px, ver el comentario de iconSize más abajo).
function iconoPuntoImagen(color, url) {
  return L.divIcon({
    className: "tz-radar-marker-wrap",
    html: `<img class="tz-radar-marker-mini-img" src="${url}" alt="" style="--tz-marker-color:${color}" />`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// Verde neón fijo — a propósito nunca se confunde con MAPA_NIVEL_COLOR
// (esos son colores de CATEGORÍA del vehículo; este es "esto es una
// persona, no un auto"). Desaparece del todo al ser recogido
// (ocultarPasajero, ver más abajo).
const ICONO_PASAJERO = iconoPunto(COLOR_PASAJERO_MAPA, "🧍");
const ICONO_DESTINO = L.divIcon({
  className: "tz-radar-marker-wrap",
  html: '<span class="tz-radar-marker tz-radar-marker-destino">🚩</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 26],
});

// Encuadra el mapa para que los pines que haya siempre queden a la
// vista — MapContainer solo usa `center`/`zoom` al montar, no
// reacciona solo cuando llega un pin nuevo o se mueve uno existente.
// Extirpación Total de OSRM: ya no hay ninguna ruta trazada que
// encuadrar — el cálculo vuelve a ser SOLO sobre los pines visibles
// (origen/conductor/destino), sin el caso especial de "hay una
// Polyline, encuadrá todo su trayecto" que existía antes.
function AjustarVista({ puntos }) {
  const map = useMap();
  useEffect(() => {
    if (puntos.length >= 2) {
      map.fitBounds(
        L.latLngBounds(puntos.map((p) => [p.lat, p.lng])),
        { padding: [30, 30], maxZoom: 16 }
      );
    } else if (puntos.length === 1) {
      map.setView([puntos[0].lat, puntos[0].lng], 15);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(puntos), map]);
  return null;
}

// Estado 2 de la Fase 3 — mapa privado de UNA carrera puntual. Vive en
// el panel superior del chat (ChatWindow.jsx) mientras viajeIniciado
// sea true, para los dos roles. El mapa (el `<MapContainer>` en sí)
// SIEMPRE se renderiza, incluso sin ninguna posición todavía — antes un
// spinner de texto reemplazaba el mapa entero mientras no hubiera
// centro, lo que en 'en_transito' (pin del pasajero oculto, ver
// `ocultarPasajero`) podía quedarse pegado si la primera posición del
// conductor tardaba en llegar; ahora el "Ubicando…" es un overlay chico
// ENCIMA del mapa, nunca lo tapa del todo.
//
// Quién transmite qué en `viaje-${conductorId}-${pasajeroId}`:
//   - El Conductor ya lo hace aparte con useGpsBroadcaster.js (mientras
//     esté 'En Carrera', sin depender de tener este mapa abierto) — acá
//     solo hace falta ESCUCHARLO, con el formato exacto de la Fase 3
//     ({lat,lng}, sin más).
//   - El Pasajero transmite la suya acá mismo, marcada con
//     role:'pasajero' para no confundirla con la del conductor.
//
// `destino` ({lat,lon}, Fase de Negociación/Ruta): si se conoce (el
// pasajero eligió un lugar en el Buscador antes de mandar la seña, ver
// ChatModal.jsx), se dibuja el pin de bandera. Extirpación Total de
// OSRM: ya NO se traza ninguna ruta interna hacia ahí — el mapa solo
// muestra los pines de origen/conductor/destino; la navegación real la
// hace el Conductor con Google Maps/Waze (ver los botones en
// ChatWindow.jsx), no esta app.
//
// `onCercaDeDestino(distanciaMetros|null)`: se llama cada vez que se
// recalcula la distancia auto-destino — ChatWindow.jsx decide ahí si
// dispara el aviso de proximidad y el reciclaje del botón de Cancelar.
// `onDistanciaPasajero(distanciaMetros|null)`: la OTRA distancia (Regla
// de Doble Proximidad) — auto al punto de recojo del pasajero, la que
// habilita el botón "Pasajero Recogido" en ChatWindow.jsx.
// `onConductorLocalizado(bool)`: avisa cuándo el pin del conductor ya
// tiene datos — ChatWindow.jsx lo usa para apagar el spinner de
// "Buscando..." y cambiar a "Conductor en camino" del lado Pasajero.
export default function MapaViaje({
  conductorId,
  pasajeroId,
  remitentePropio,
  ocultarPasajero = false,
  destino = null,
  origenPasajero = null,
  colorCategoria = "#00ffff",
  iconoCategoriaUrl = null,
  onCercaDeDestino,
  onDistanciaPasajero,
  onConductorLocalizado,
}) {
  const [posicionPasajero, setPosicionPasajero] = useState(null);
  const [posicionConductor, setPosicionConductor] = useState(null);
  const soyPasajero = remitentePropio === REMITENTE_PASAJERO;
  // El vehículo se pinta con el color de SU categoría (VIP/Premium/
  // Ejecutivo/Económico) — antes quedaba fijo en cian sin importar la
  // categoría real, acá se arma en cada render con el color que llega
  // por prop (no puede ser una constante de módulo, depende del
  // conductor de este hilo puntual). Panel de Categorías e Íconos: si
  // el Admin configuró un ícono propio para la categoría del VEHÍCULO
  // (Mototaxi/Minivan/etc. — no confundir con nivel_servicio, que es lo
  // que da `colorCategoria`), reemplaza al 🚖 acá también, igual que ya
  // pasa en el Radar — antes solo estaba conectado ahí.
  const iconoConductor = iconoCategoriaUrl ? iconoPuntoImagen(colorCategoria, iconoCategoriaUrl) : iconoPunto(colorCategoria, "🚖");

  // Canal privado de la carrera — UN SOLO efecto para escuchar Y
  // transmitir, de los DOS lados, desde el segundo uno en que este
  // componente se monta (que ahora es "apenas se abre el chat", ver
  // ChatWindow.jsx — ya no depende de que exista ninguna oferta
  // aceptada). Antes esto estaba partido en dos efectos: uno abría el
  // canal y escuchaba (y el Pasajero transmitía ahí mismo), pero la
  // transmisión del CONDUCTOR vivía en un efecto aparte que NO tocaba
  // el canal — solo actualizaba su propio estado local. La transmisión
  // real del conductor dependía de useGpsBroadcaster.js, que solo abre
  // el canal privado cuando `estado === 'ocupado'` (recién después de
  // Aceptar) — durante la negociación (oferta pendiente, conductor
  // todavía 'activo') ese hook nunca transmitía acá, y el Pasajero
  // perdía la señal apenas entraba al chat. Ahora el propio Conductor
  // transmite desde ACÁ, sin condición de fase — useGpsBroadcaster.js
  // sigue transmitiendo aparte una vez aceptado (redundante pero
  // inofensivo, mismo canal/formato).
  useEffect(() => {
    if (!conductorId || !pasajeroId || !navigator.geolocation) return undefined;

    const channel = supabase.channel(canalViaje(conductorId, pasajeroId));
    channel.on("broadcast", { event: "gps_update" }, ({ payload }) => {
      if (typeof payload?.lat !== "number" || typeof payload?.lng !== "number") return;
      const punto = { lat: payload.lat, lng: payload.lng };
      if (payload.role === "pasajero") {
        if (!soyPasajero) setPosicionPasajero(punto);
      } else if (soyPasajero) {
        setPosicionConductor(punto);
      }
    });
    channel.subscribe();

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const punto = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (soyPasajero) {
          setPosicionPasajero(punto);
          channel.send({ type: "broadcast", event: "gps_update", payload: { ...punto, role: "pasajero" } });
        } else {
          setPosicionConductor(punto);
          channel.send({ type: "broadcast", event: "gps_update", payload: punto });
        }
      },
      () => {},
      // Fix Precisión GPS: `maximumAge: 0` — sin caché, cada punto que
      // se transmite en el mapa del viaje EN CURSO es una lectura
      // fresca del chip GPS real, no una posición de red guardada.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      supabase.removeChannel(channel);
    };
  }, [conductorId, pasajeroId, soyPasajero]);

  // Bug de mapa "atascado" esperando datos (mismo hueco arquitectónico
  // que ya se corrigió en useRadarPublico.js para el Radar público,
  // ahora acá para el mapa privado de UNA carrera): el canal de arriba
  // es 100% Broadcast — si el Conductor recién abrió el chat y su GPS
  // todavía no tuvo un tick nuevo (celular quieto un momento,
  // useGpsBroadcaster.js recién arrancando), el Pasajero se quedaba sin
  // nada que pintar hasta que llegara el primer broadcast. Como
  // useGpsBroadcaster.js ya guarda la última posición conocida del
  // Conductor en `conductores.ultima_lat/ultima_lng` (con throttle),
  // acá se hace un fetch inicial para sembrar `posicionConductor` de
  // una — el Broadcast de arriba lo mantiene fresco después, esto solo
  // cubre la carga inicial.
  useEffect(() => {
    if (!soyPasajero || !conductorId) return undefined;
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase.from("conductores").select("ultima_lat, ultima_lng").eq("id", conductorId).maybeSingle();
      if (cancelado || error || !data) return;
      if (data.ultima_lat != null && data.ultima_lng != null) {
        // Funcional con `prev`: si ya llegó algo más fresco por
        // Broadcast mientras este fetch estaba en vuelo, no lo pisa.
        setPosicionConductor((prev) => prev ?? { lat: data.ultima_lat, lng: data.ultima_lng });
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [soyPasajero, conductorId]);

  // Fix del Atasco del Conductor — la mitad simétrica del fix de
  // arriba: el punto de recojo del Pasajero (Punto de Recojo,
  // `origen_lat`/`origen_lng` en chat_mensajes, ver ChatModal.jsx/
  // ChatWindow.jsx) ya viene resuelto por PROP desde `mensajes` — ni
  // siquiera hace falta un fetch aparte acá, ChatWindow.jsx ya lo tenía
  // cargado. Solo importa del lado del Conductor (`!soyPasajero`): el
  // Pasajero ya conoce su propia posición en vivo por su propio GPS,
  // no necesita este respaldo.
  useEffect(() => {
    if (soyPasajero || !origenPasajero) return;
    setPosicionPasajero((prev) => prev ?? { lat: origenPasajero.lat, lng: origenPasajero.lon });
  }, [soyPasajero, origenPasajero]);

  // Ya a bordo: el pin del pasajero deja de existir para el mapa (ni se
  // renderiza ni cuenta para encuadrar la vista) — de acá en más solo
  // importa el movimiento del vehículo.
  const pasajeroVisible = ocultarPasajero ? null : posicionPasajero;

  // Le avisa a ChatWindow.jsx cuándo el pin del conductor YA tiene
  // datos (Fase 2) — ahí decide si sigue mostrando "Buscando..." con
  // spinner o pasa a "Conductor en camino" sin spinner.
  useEffect(() => {
    onConductorLocalizado?.(!!posicionConductor);
  }, [posicionConductor, onConductorLocalizado]);

  // Proximidad al destino (Haversine) — ChatWindow.jsx decide qué hacer
  // con el número (aviso al chat, reciclar el botón). null si falta
  // conductor o destino, para que quien escucha sepa distinguir "no se
  // puede calcular" de "0 metros".
  useEffect(() => {
    if (!onCercaDeDestino) return;
    if (!posicionConductor || !destino) {
      onCercaDeDestino(null);
      return;
    }
    onCercaDeDestino(distanciaMetros(posicionConductor.lat, posicionConductor.lng, destino.lat, destino.lon));
  }, [posicionConductor, destino, onCercaDeDestino]);

  // Regla de Doble Proximidad — la OTRA distancia: auto al punto de
  // recojo (posicionPasajero SIN filtrar por ocultarPasajero, a
  // propósito — esto solo importa ANTES de recogerlo, cuando el pin
  // todavía es visible igual). Habilita "Pasajero Recogido" recién a
  // <100m, ver ChatWindow.jsx.
  useEffect(() => {
    if (!onDistanciaPasajero) return;
    if (!posicionConductor || !posicionPasajero) {
      onDistanciaPasajero(null);
      return;
    }
    onDistanciaPasajero(distanciaMetros(posicionConductor.lat, posicionConductor.lng, posicionPasajero.lat, posicionPasajero.lng));
  }, [posicionConductor, posicionPasajero, onDistanciaPasajero]);

  const puntosParaEncuadre = [pasajeroVisible, posicionConductor, destino ? { lat: destino.lat, lng: destino.lon } : null].filter(
    Boolean
  );
  const centro = posicionConductor || pasajeroVisible || (destino ? { lat: destino.lat, lng: destino.lon } : null) || {
    lat: COORD_DEFAULT[0],
    lng: COORD_DEFAULT[1],
  };
  const ubicando = !posicionConductor && !pasajeroVisible;

  return (
    <div style={{ position: "relative" }}>
      {ubicando && (
        <div className="tz-mapa-viaje-loading tz-mapa-viaje-loading-overlay">
          <Loader2 size={14} className="tz-spin" />
          <span>Ubicando…</span>
        </div>
      )}
      <MapContainer
        center={[centro.lat, centro.lng]}
        zoom={15}
        className="tz-mapa-viaje"
        zoomControl={false}
        scrollWheelZoom={false}
      >
        <AjustarVista puntos={puntosParaEncuadre} />
        {/* Migración Mapbox (Fase 1): estilo 'dark-v11' — combina con el
           resto de la UI neón de esta app, reemplaza al tile claro de
           OpenStreetMap. */}
        <TileLayer attribution={MAPBOX_ATTRIBUTION} url={MAPBOX_TILE_URL} />
        {destino && <Marker position={[destino.lat, destino.lon]} icon={ICONO_DESTINO} />}
        {pasajeroVisible && <Marker position={[pasajeroVisible.lat, pasajeroVisible.lng]} icon={ICONO_PASAJERO} />}
        {posicionConductor && <Marker position={[posicionConductor.lat, posicionConductor.lng]} icon={iconoConductor} />}
      </MapContainer>
    </div>
  );
}
