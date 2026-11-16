import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Maximize2 } from "lucide-react";
import RutaNeon, { divIconLuz, useConexionRuta } from "./RutaNeon";
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION } from "../lib/mapboxConfig";
import { COLOR_PASAJERO_MAPA } from "../lib/nivelServicio";

/* Mini-mapa del primer mensaje del pasajero ("Hacer señas"): A = dónde lo
   recogen, B = su destino. Antes era una imagen fija de Mapbox; ahora es un
   mapa de verdad (se puede mover y hacer zoom) con los mismos íconos con
   luz y la línea neón animada del mapa del viaje. ⤢ vuelve a encuadrar. */

const icono = (html, size) => ({ className: "tz-radar-marker-wrap", html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
const ESPEC_A = icono(`<span class="tz-radar-marker" style="--tz-marker-color:${COLOR_PASAJERO_MAPA}">🧍</span>`, 26);
const ESPEC_B = icono('<span class="tz-radar-marker tz-radar-marker-destino">🚩</span>', 28);
const COLOR_RUTA = "#2be8ff";

function Encuadre({ puntos, tick }) {
  const map = useMap();
  useEffect(() => {
    const encuadrar = () => {
      // El recuadro entra con una animación: se relee su tamaño real antes.
      map.invalidateSize();
      if (puntos.length >= 2) map.fitBounds(L.latLngBounds(puntos.map((p) => [p.lat, p.lng])), { padding: [26, 26], maxZoom: 16 });
      else if (puntos.length === 1) map.setView([puntos[0].lat, puntos[0].lng], 15);
    };
    encuadrar();
    const t = setTimeout(encuadrar, tick ? 0 : 650);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, map]);
  return null;
}

export default function MiniMapaSenas({ origen, destino }) {
  const [tick, setTick] = useState(0);
  const puntos = useMemo(() => [origen, destino].filter(Boolean), [origen, destino]);
  const { luces, dibujoKey } = useConexionRuta(!!(origen && destino));
  const iconoA = useMemo(() => divIconLuz(ESPEC_A, COLOR_RUTA, luces >= 1), [luces >= 1]); // eslint-disable-line react-hooks/exhaustive-deps
  const iconoB = useMemo(() => divIconLuz(ESPEC_B, COLOR_RUTA, luces >= 2), [luces >= 2]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!puntos.length) return null;
  const centro = puntos[0];

  return (
    <div className="tz-chat-minimapa" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="tz-mapa-viaje-recentrar" onClick={() => setTick((n) => n + 1)} aria-label="Volver a encuadrar" title="Volver a encuadrar">
        <Maximize2 size={14} />
      </button>
      <MapContainer
        center={[centro.lat, centro.lng]}
        zoom={15}
        className="tz-chat-minimapa-mapa"
        zoomControl={false}
        scrollWheelZoom={false}
        attributionControl={false}
      >
        <Encuadre puntos={puntos} tick={tick} />
        <TileLayer attribution={MAPBOX_ATTRIBUTION} url={MAPBOX_TILE_URL} />
        {origen && destino && <RutaNeon desde={origen} hasta={destino} color={COLOR_RUTA} dibujoKey={dibujoKey} />}
        {origen && <Marker position={[origen.lat, origen.lng]} icon={iconoA} />}
        {destino && <Marker position={[destino.lat, destino.lng]} icon={iconoB} />}
      </MapContainer>
    </div>
  );
}
