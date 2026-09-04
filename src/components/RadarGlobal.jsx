import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { X, Loader2, MapPin } from "lucide-react";
import { useRadarPublico } from "../hooks/useRadarPublico";
import { useBuscadorDireccion } from "../hooks/useBuscadorDireccion";
import { coordsDeLocalidad } from "../hooks/useLocalidades";
import { ESTADO_CONDUCTOR_ACTIVO } from "../lib/taxiEnums";
import { MAPA_NIVEL_COLOR } from "../lib/nivelServicio";
import { reverseGeocode } from "../lib/reverseGeocode";
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION } from "../lib/mapboxConfig";

// Fase 3 "Colectivo": el badge de al lado del carrito muestra el
// estado operativo (LIBRE/EN CARRERA, fondo celeste/naranja) y la
// ocupación de asientos (ej. "2/4") — se arma como HTML plano porque
// L.divIcon no acepta JSX, no porque el resto de la app también use
// este patrón (todo lo demás sigue siendo componentes React normales).
// Panel de Categorías e Íconos (Admin, ver CategoriasModal.jsx): si el
// Admin configuró un ícono para la categoría de este conductor, se
// renderiza esa imagen en vez del 🚖 genérico — `iconoCategoriaUrl`
// llega ya resuelto desde afuera (buscado por `categoria_id`, ver el
// `.map()` de más abajo) para no repetir el `.find()` por cada
// vehículo en cada render del ícono.
function iconoVehiculo(conductor, color, iconoCategoriaUrl) {
  const libre = conductor.estado === ESTADO_CONDUCTOR_ACTIVO;
  const estadoLabel = libre ? "LIBRE" : "EN CARRERA";
  const estadoClase = libre ? "tz-vehiculo-badge-libre" : "tz-vehiculo-badge-carrera";
  const totales = conductor.asientos_totales ?? 4;
  // Fase 4 (Colectivo): el badge ahora muestra DISPONIBLES, no ocupados
  // — es el dato que de verdad le importa a un pasajero nuevo mirando
  // el radar ("¿me puedo subir acá?"), no cuántos ya viajan.
  const disponibles = Math.max(0, totales - (conductor.asientos_ocupados ?? 0));
  const vehiculoHtml = iconoCategoriaUrl
    ? `<img class="tz-radar-marker-vehiculo-img" src="${iconoCategoriaUrl}" alt="" style="--tz-marker-color:${color}" />`
    : `<span class="tz-radar-marker tz-radar-marker-vehiculo" style="--tz-marker-color:${color}">🚖</span>`;
  return L.divIcon({
    className: "tz-radar-marker-wrap",
    html: `<div class="tz-vehiculo-marker-group">
        ${vehiculoHtml}
        <span class="tz-vehiculo-badge">
          <span class="tz-vehiculo-badge-estado ${estadoClase}">${estadoLabel}</span>
          <span class="tz-vehiculo-badge-asientos">💺 ${disponibles}/${totales}</span>
        </span>
      </div>`,
    // Círculo del vehículo a 48x48 (w-12 h-12) — más grande que el pin
    // genérico de 26px que sigue usando MapaViaje.jsx (ese vive en un
    // mapa mucho más chico, 48px ahí se comería medio panel).
    iconSize: [176, 48],
    iconAnchor: [24, 24],
  });
}

// Pin del destino elegido en el Buscador Inteligente (HomePage.jsx) —
// distinto de los vehículos: forma de bandera clavada (iconAnchor abajo
// al centro, no centrado como los puntos redondos de arriba) y color
// dorado para que no se confunda con ningún nivel de servicio.
const ICONO_DESTINO = L.divIcon({
  className: "tz-radar-marker-wrap",
  html: '<span class="tz-radar-marker tz-radar-marker-destino">🚩</span>',
  iconSize: [30, 30],
  iconAnchor: [15, 28],
});

// MapContainer solo usa `centro`/`zoom` para el montaje inicial — si el
// GPS del pasajero resuelve DESPUÉS del primer render (lo normal, es
// async), sin esto el mapa se queda plantado en el fallback de
// localidad aunque el estado ya haya cambiado.
function Recentrador({ centro, zoom }) {
  const map = useMap();
  useEffect(() => {
    map.setView(centro, zoom);
  }, [centro, map, zoom]);
  return null;
}

// Selección Manual de Destino: sin esto el pin fijo del centro (ver
// abajo, CSS puro sobre el mapa) quedaría clavado en la posición
// inicial — este listener es lo que lo mantiene sincronizado con las
// coordenadas reales bajo el pin mientras el pasajero arrastra el mapa.
// Solo importa mientras `activo` (o sea, sin destino elegido todavía);
// se sigue montando siempre para no des-suscribir/re-suscribir el mapa
// cada vez que `destino` cambia.
function RastreadorCentroManual({ activo, onMover }) {
  useMapEvents({
    move(e) {
      if (!activo) return;
      const centro = e.target.getCenter();
      onMover([centro.lat, centro.lng]);
    },
  });
  return null;
}

// Estado 1 de la Fase 3 — el Radar público: el pasajero ve acá a
// cualquier conductor transmitiendo en vivo al canal público (ver
// useRadarPublico.js). Fase 3 "Colectivo": eso ya NO es solo "Libre" —
// useGpsBroadcaster.js sigue mandando al público mientras haya asientos
// libres, esté 'Libre' o 'En Carrera' (recién se apaga cuando se llena)
// — por eso acá NO se filtra por estado, la visibilidad la decide el
// propio broadcaster del conductor, no este componente.
//
// Centrado, en orden de prioridad:
//   1) `destino` — el pasajero ya eligió un lugar en el Buscador
//      Inteligente (HomePage.jsx/useBuscadorDireccion.js): el radar se
//      abre mirando EXACTAMENTE ahí, el GPS propio ni se pide.
//   2) GPS del navegador, si lo autoriza.
//   3) La localidad que ya tenía filtrada en la Home (o San Ramón si
//      todavía no eligió ninguna).
export default function RadarGlobal({
  conductores,
  categorias = [],
  localidadFiltro,
  localidades,
  destino,
  onSeleccionarConductor,
  onDestinoElegido,
  onLimpiarDestino,
  onClose,
}) {
  const [centro, setCentro] = useState(() =>
    destino ? [destino.lat, destino.lon] : coordsDeLocalidad(localidades, localidadFiltro)
  );
  const [resolviendoGps, setResolviendoGps] = useState(!destino);
  const posiciones = useRadarPublico();
  const zoomInicial = destino ? 16 : 15;

  // Filtro Geográfico del buscador (Fase de la Home, ver HomePage.jsx):
  // si el pasajero ya filtró una localidad, sus coordenadas (definidas
  // por el Admin en AdminLocalidadesModal.jsx) acotan las sugerencias de
  // Nominatim a esa zona (viewbox+bounded=1, ver useBuscadorDireccion.js)
  // — sin esto, buscar "Jirón Lima" podía traer resultados de cualquier
  // "Jirón Lima" del Perú, no el de la localidad que el pasajero ya
  // eligió mirar.
  const localidadFiltroFila = (localidades ?? []).find((l) => l.nombre === localidadFiltro);
  const viewboxCoords = localidadFiltroFila ? { lat: localidadFiltroFila.lat, lon: localidadFiltroFila.lon } : null;

  // Buscador de direcciones — vivía en la barra superior de HomePage.jsx,
  // ahora vive ÚNICAMENTE acá adentro (Filtro Geográfico y Buscador en
  // el Radar): el pasajero abre el Radar primero, y desde ahí busca su
  // destino O arrastra el pin manual, las dos opciones conviven mientras
  // `modoManual` (ver más abajo) siga activo.
  const [textoBusqueda, setTextoBusqueda] = useState("");
  const [mostrarSugerencias, setMostrarSugerencias] = useState(false);
  const { sugerencias, buscando } = useBuscadorDireccion(textoBusqueda, localidadFiltro, viewboxCoords);

  const seleccionarDestinoBuscado = (sugerencia) => {
    const lat = Number(sugerencia.lat);
    const lon = Number(sugerencia.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return;
    setCentro([lat, lon]);
    setMostrarSugerencias(false);
    setTextoBusqueda(sugerencia.display_name ?? "");
    onDestinoElegido?.({ lat, lon, nombre: sugerencia.display_name });
  };

  // Modo de Selección Manual: activo exactamente cuando el pasajero NO
  // escribió ni eligió nada en el Buscador Inteligente (destino vacío).
  // `centroManual` es la posición real bajo el pin fijo (ver
  // RastreadorCentroManual arriba) — arranca igual que `centro` y se
  // resincroniza cada vez que `centro` cambia (ej. cuando el GPS
  // resuelve después del primer render), pero solo mientras siga sin
  // destino: una vez que el pasajero confirma, `destino` deja de ser
  // null y este modo se apaga solo.
  const modoManual = !destino;
  const [centroManual, setCentroManual] = useState(centro);
  const [geocodificando, setGeocodificando] = useState(false);
  const [errorManual, setErrorManual] = useState("");
  const debounceGeocodeRef = useRef(null);

  useEffect(() => {
    if (modoManual) setCentroManual(centro);
  }, [centro, modoManual]);

  // Limpieza del debounce si el Radar se cierra a mitad de la espera —
  // sin esto, un setTimeout suelto podía llamar a setState de un
  // componente ya desmontado.
  useEffect(() => () => clearTimeout(debounceGeocodeRef.current), []);

  // Freno a Nominatim: debounce de 800ms sobre el reverse geocoding —
  // el botón ya se deshabilita mientras `geocodificando` es true, pero
  // esto además cancela cualquier pedido en cola si se llega a tocar
  // "Confirmar" más de una vez seguida (ej. doble-tap accidental) en
  // vez de mandar dos requests casi pegadas a la API pública.
  const confirmarUbicacionManual = () => {
    clearTimeout(debounceGeocodeRef.current);
    setGeocodificando(true);
    setErrorManual("");
    const [lat, lon] = centroManual;
    debounceGeocodeRef.current = setTimeout(async () => {
      try {
        const nombre = await reverseGeocode(lat, lon);
        onDestinoElegido?.({ lat, lon, nombre });
      } catch (err) {
        console.error("No se pudo resolver el nombre del destino manual:", err);
        setErrorManual("No se pudo obtener el nombre del lugar. Intenta de nuevo.");
      } finally {
        setGeocodificando(false);
      }
    }, 800);
  };

  useEffect(() => {
    // Ya sabemos exactamente dónde centrar — pedir el GPS acá encima
    // solo movería el mapa lejos del destino que el pasajero eligió.
    if (destino) return;
    if (!navigator.geolocation) {
      setResolviendoGps(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCentro([pos.coords.latitude, pos.coords.longitude]);
        setResolviendoGps(false);
      },
      () => {
        // Denegado o falló — se queda con el fallback de localidad que
        // ya está en el estado inicial, no hace falta tocar nada más.
        setResolviendoGps(false);
      },
      // Fix Precisión GPS: `maximumAge: 0` (antes no se especificaba, y
      // aunque el default del navegador ya es 0, se deja explícito) +
      // timeout subido a 15s (desde 10s) — le da más margen al chip GPS
      // real para resolver antes de caer al fallback de localidad.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
    // Solo al abrir el radar — no queremos recentrar de golpe si el
    // pasajero ya movió el mapa a mano mientras mira los vehículos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fase 4 (Colectivo): antes solo filtraba por "¿tenemos una posición
  // sembrada/en vivo para este conductor?" — un auto que se llenaba
  // DESPUÉS de que el pasajero ya tenía el Radar abierto simplemente
  // dejaba de recibir ticks nuevos (useGpsBroadcaster.js corta el
  // Broadcast público sin lugar), pero su ÚLTIMA posición conocida
  // seguía en `posiciones` — quedaba un pin fantasma mostrando "LIBRE"/
  // el badge viejo, sin actualizarse nunca más. `conductores` sí está
  // suscrito a Realtime (useConductoresPublicos.js), así que basta con
  // sumar el chequeo de asientos acá para que el auto desaparezca del
  // radar EN VIVO apenas se llena, sin esperar a un refresco manual.
  const vehiculosEnRadar = useMemo(
    () =>
      (conductores ?? []).filter((c) => posiciones[c.id] && (c.asientos_ocupados ?? 0) < (c.asientos_totales ?? 4)),
    [conductores, posiciones]
  );

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-radar-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-anuncio-close" onClick={onClose} aria-label="Cerrar radar">
          <X size={18} />
        </button>

        {/* Botón "Cambiar Ubicación": el pin manual y el buscador de la
           Home limpian este mismo `destino`, pero mientras el Radar está
           abierto (a pantalla completa) no hay forma de llegar al botón
           de limpiar que vive en la barra de búsqueda, tapada detrás del
           modal — este es el único punto de salida mientras se está acá
           adentro. Al limpiar, `modoManual` (= !destino) vuelve a true
           solo, así que el pin fijo y "Confirmar Ubicación" reaparecen
           sin necesitar ningún reseteo aparte. */}
        {destino && !resolviendoGps && (
          <button
            type="button"
            className="tz-radar-cambiar-btn"
            onClick={() => {
              setErrorManual("");
              setTextoBusqueda("");
              onLimpiarDestino?.();
            }}
          >
            ❌ Cambiar Ubicación
          </button>
        )}

        {/* Buscador de direcciones — solo mientras no hay destino
           elegido (modoManual), mismo criterio que el pin fijo de más
           abajo: las dos formas de elegir destino conviven acá. */}
        {modoManual && (
          <div className="tz-buscador-wrap tz-radar-buscador-wrap">
            <input
              type="text"
              className="tz-radar-input"
              placeholder="¿A dónde vas?"
              value={textoBusqueda}
              onChange={(e) => {
                setTextoBusqueda(e.target.value);
                setMostrarSugerencias(true);
              }}
              onFocus={() => setMostrarSugerencias(true)}
              // Delay corto (no 'onClick' que llegaría tarde): sin esto
              // el blur del input esconde el dropdown ANTES de que el
              // click en una sugerencia llegue a dispararse.
              onBlur={() => setTimeout(() => setMostrarSugerencias(false), 150)}
            />
            {mostrarSugerencias && textoBusqueda.trim().length >= 2 && (
              <div className="tz-buscador-dropdown">
                {buscando ? (
                  <p className="tz-buscador-empty">
                    <Loader2 size={13} className="tz-spin" /> Buscando…
                  </p>
                ) : sugerencias.length === 0 ? (
                  <p className="tz-buscador-empty">Sin resultados para "{textoBusqueda}".</p>
                ) : (
                  sugerencias.map((s) => (
                    <button key={s.place_id} type="button" className="tz-buscador-item" onClick={() => seleccionarDestinoBuscado(s)}>
                      <MapPin size={14} />
                      <span>{s.display_name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {resolviendoGps && (
          <div className="tz-radar-loading">
            <Loader2 className="tz-spin" size={20} />
            <span>Ubicándote…</span>
          </div>
        )}

        <MapContainer center={centro} zoom={zoomInicial} className="tz-radar-map" scrollWheelZoom zoomControl={false}>
          <Recentrador centro={centro} zoom={zoomInicial} />
          <RastreadorCentroManual activo={modoManual} onMover={setCentroManual} />
          {/* Fix UI: el control de zoom por default de Leaflet vive
             arriba a la izquierda — justo donde cae la barra de
             búsqueda de direcciones (`tz-radar-buscador-wrap`),
             tapándolo. Se desactiva el default (`zoomControl={false}`
             arriba) y se reubica acá, abajo a la derecha, lejos de
             cualquier otro control superpuesto. */}
          <ZoomControl position="bottomright" />
          {/* Migración Mapbox (Fase 1): estilo 'dark-v11'. */}
          <TileLayer attribution={MAPBOX_ATTRIBUTION} url={MAPBOX_TILE_URL} />
          {destino && <Marker position={[destino.lat, destino.lon]} icon={ICONO_DESTINO} />}
          {vehiculosEnRadar.map((c) => (
            <Marker
              key={c.id}
              position={[posiciones[c.id].lat, posiciones[c.id].lng]}
              icon={iconoVehiculo(
                c,
                MAPA_NIVEL_COLOR[c.nivel_servicio] || MAPA_NIVEL_COLOR.economico,
                categorias.find((cat) => cat.id === c.categoria_id)?.icono_url
              )}
              eventHandlers={{ click: () => onSeleccionarConductor?.(c) }}
            />
          ))}
        </MapContainer>

        {modoManual && (
          <>
            {/* Pin fijo en CSS, no un Marker de Leaflet — es el mapa el
               que se arrastra debajo, tal como pide el flujo (estilo
               "elegir ubicación" de apps de mapas). */}
            <span className="tz-radar-pin-manual" aria-hidden="true">
              🚩
            </span>
            <button
              type="button"
              className="tz-radar-confirmar-btn"
              onClick={confirmarUbicacionManual}
              disabled={geocodificando}
            >
              {geocodificando ? (
                <>
                  <Loader2 className="tz-spin" size={16} /> Buscando lugar…
                </>
              ) : (
                "📍 Confirmar Ubicación"
              )}
            </button>
            {errorManual && <p className="tz-radar-manual-error">{errorManual}</p>}
          </>
        )}

        {!resolviendoGps && (conductores ?? []).length === 0 ? (
          <p className="tz-radar-empty">Buscando conductores cercanos…</p>
        ) : (
          !resolviendoGps &&
          vehiculosEnRadar.length === 0 && (
            <p className="tz-radar-empty">Todavía no hay conductores transmitiendo su ubicación cerca tuyo.</p>
          )
        )}
      </div>
    </div>
  );
}
