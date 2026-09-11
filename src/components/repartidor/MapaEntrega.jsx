import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { supabase } from "../../supabaseClient";
import { canalEntrega } from "../../hooks/useEntregasRepartidor";
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION } from "../../lib/mapboxConfig";
import { MAPA_NIVEL_COLOR } from "../../lib/nivelServicio";

// Mapa en vivo de la entrega — MISMO estilo que el mapa del chat de un
// viaje en curso (MapaViaje.jsx): contenedor `tz-mapa-viaje`, pines
// chicos (26px), encuadre automático a los puntos visibles, toggle
// "Ocultar mapa". El pin del repartidor usa el ícono de categoría que
// asignó el Admin (coloreado por nivel_servicio) — sin el contador de
// asientos (esto es recolección de productos, no pasajeros) NI el
// badge LIBRE/EN CARRERA que tenía antes: ese badge mostraba
// `conductores.estado`, el switch de disponibilidad para VIAJES —
// ajeno a esta entrega, y cambia solo (el conductor lo toca a mano
// para pasajeros) sin que tenga nada que ver con aceptar/entregar el
// pedido. Mostrarlo acá confundía, como si "aceptar la entrega" fuera
// lo que lo ponía "en carrera".

const ICONO_DESTINO = L.divIcon({
  className: "tz-radar-marker-wrap",
  html: '<span class="tz-radar-marker tz-radar-marker-destino">🚩</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 26],
});
const ICONO_ORIGEN = L.divIcon({
  className: "tz-radar-marker-wrap",
  html: '<span class="tz-radar-marker">🏪</span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function iconoRepartidor(color, iconoUrl) {
  const vehiculo = iconoUrl
    ? `<img class="tz-radar-marker-mini-img" src="${iconoUrl}" alt="" style="--tz-marker-color:${color}" />`
    : `<span class="tz-radar-marker" style="--tz-marker-color:${color}">🚖</span>`;
  return L.divIcon({
    className: "tz-radar-marker-wrap",
    html: `<div class="tz-entrega-marker-group">${vehiculo}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// Encuadra a los puntos visibles (repartidor + destino). MapContainer
// solo usa center/zoom al montar.
function AjustarVista({ puntos }) {
  const map = useMap();
  useEffect(() => {
    const validos = puntos.filter(Boolean);
    if (validos.length >= 2) {
      map.fitBounds(
        validos.map((p) => [p.lat, p.lng]),
        { padding: [40, 40], maxZoom: 16 }
      );
    } else if (validos.length === 1) {
      map.setView([validos[0].lat, validos[0].lng], 15, { animate: true });
    }
  }, [puntos, map]);
  return null;
}

function frescura(atMs) {
  if (!atMs) return { txt: "sin ubicación", clase: "tz-fresh-none" };
  const s = Math.round((Date.now() - atMs) / 1000);
  if (s < 45) return { txt: "en vivo", clase: "tz-fresh-live" };
  if (s < 3600) return { txt: `hace ${Math.round(s / 60)} min`, clase: "tz-fresh-stale" };
  return { txt: `hace ${Math.round(s / 3600)} h`, clase: "tz-fresh-stale" };
}

export default function MapaEntrega({ entregaId, conductorId = null, destino = null, origen = null, posInicial = null, client = supabase }) {
  const [repartidor, setRepartidor] = useState(
    posInicial && typeof posInicial.lat === "number" ? { lat: posInicial.lat, lng: posInicial.lng } : null
  );
  const [marcador, setMarcador] = useState({ iconoUrl: null, nivel: "economico", estado: null });
  const [oculto, setOculto] = useState(false);
  const [posAt, setPosAt] = useState(posInicial?.at ? new Date(posInicial.at).getTime() : 0);
  const ultimo = useRef(0);

  // Re-render del chip de frescura cada 20 s.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 20000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!conductorId) return;
    let cancel = false;
    client.rpc("rpc_conductor_marcador", { p_conductor_id: conductorId }).then(({ data }) => {
      if (cancel || !data || !data[0]) return;
      setMarcador({
        iconoUrl: data[0].icono_url || null,
        nivel: data[0].nivel_servicio || "economico",
        estado: data[0].estado || null,
      });
    });
    return () => {
      cancel = true;
    };
  }, [conductorId, client]);

  useEffect(() => {
    if (!entregaId) return;
    const ch = client
      .channel(canalEntrega(entregaId))
      .on("broadcast", { event: "gps" }, ({ payload }) => {
        if (typeof payload?.lat !== "number" || typeof payload?.lng !== "number") return;
        if (payload.t && payload.t < ultimo.current) return;
        ultimo.current = payload.t || Date.now();
        setRepartidor({ lat: payload.lat, lng: payload.lng });
        setPosAt(Date.now());
      })
      .subscribe();
    return () => {
      client.removeChannel(ch);
    };
  }, [entregaId, client]);

  const color = MAPA_NIVEL_COLOR[marcador.nivel] || MAPA_NIVEL_COLOR.economico;
  const puntos = [repartidor, destino, origen];
  const centro = repartidor || destino || origen || { lat: -12.0464, lng: -77.0428 };
  const ubicando = !repartidor;
  const fr = frescura(posAt);

  return (
    <div className="tz-entrega-mapa-wrap">
      <div className="tz-entrega-mapa-bar">
        <button type="button" className="tz-entrega-mapa-toggle" onClick={() => setOculto((v) => !v)}>
          {oculto ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          {oculto ? "Mostrar mapa" : "Ocultar mapa"}
        </button>
        <span className={`tz-fresh ${fr.clase}`}>{fr.txt}</span>
      </div>

      {!oculto && (
        <div style={{ position: "relative" }}>
          {ubicando && (
            <div className="tz-mapa-viaje-loading tz-mapa-viaje-loading-overlay">
              <Loader2 size={14} className="tz-spin" />
              <span>Ubicando al repartidor…</span>
            </div>
          )}
          <MapContainer
            center={[centro.lat, centro.lng]}
            zoom={15}
            className="tz-mapa-viaje"
            zoomControl={false}
            scrollWheelZoom={false}
          >
            <AjustarVista puntos={puntos} />
            <TileLayer attribution={MAPBOX_ATTRIBUTION} url={MAPBOX_TILE_URL} />
            {origen && <Marker position={[origen.lat, origen.lng]} icon={ICONO_ORIGEN} />}
            {destino && <Marker position={[destino.lat, destino.lng]} icon={ICONO_DESTINO} />}
            {repartidor && (
              <Marker position={[repartidor.lat, repartidor.lng]} icon={iconoRepartidor(color, marcador.iconoUrl)} />
            )}
          </MapContainer>
        </div>
      )}
    </div>
  );
}
