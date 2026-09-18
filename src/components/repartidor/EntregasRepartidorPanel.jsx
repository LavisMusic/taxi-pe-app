import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { PackageCheck, Bike, MapPin, Store, Check, X, Loader2, Map as MapIcon, AlertTriangle } from "lucide-react";
import { useEntregasRepartidor } from "../../hooks/useEntregasRepartidor";
import { useEntregaGpsBroadcaster } from "../../hooks/useEntregaGpsBroadcaster";
import { MAPBOX_TILE_URL, MAPBOX_ATTRIBUTION } from "../../lib/mapboxConfig";
import EntregaActivaModal from "./EntregaActivaModal";
import { formatSoles } from "../../utils/format";

// Bandeja de reparto en la pantalla del conductor (ver DELIVERY.md §7).
// Solo se muestra si hay algo que atender: entregas en curso o pedidos
// ofrecidos por la Caja. No mete ruido si no hay nada.
//
// Multi-oferta (DELIVERY.md §9): el conductor puede tener VARIAS
// entregas 'aceptado' a la vez (todavía sin recoger ninguna) — recién
// deja de recibir ofertas nuevas cuando alguna llega a 'en_ruta' (ya
// recogió y pagó esa). Por eso la lista de ofertas se sigue mostrando
// mientras `!tieneEnRuta`, sin importar cuántas 'aceptado' ya tenga.

const TIMEOUT_OFERTA_MS = 30000;

const ICONO_ORIGEN = L.divIcon({
  className: "tz-radar-marker-wrap",
  html: '<span class="tz-radar-marker">🏪</span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});
const ICONO_DESTINO = L.divIcon({
  className: "tz-radar-marker-wrap",
  html: '<span class="tz-radar-marker tz-radar-marker-destino">🚩</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 26],
});
const ICONO_YO = L.divIcon({
  className: "tz-radar-marker-wrap",
  html: '<span class="tz-radar-marker" style="--tz-marker-color:var(--cyan)">🚖</span>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

// Vista previa del trayecto — modal tradicional (botón "Ver ruta" junto
// al nombre del cliente lo abre, se cierra con la X o tocando afuera).
// Portal a <body> para superponer TODA la interfaz sin pelearse con el
// z-index/overflow de la tarjeta.
function RutaPreviewModal({ origen, destino, miPos, onClose }) {
  const puntos = [origen, destino, miPos].filter(Boolean);
  const centro = miPos || destino || origen || { lat: -12.0464, lng: -77.0428 };
  return createPortal(
    <div className="tz-ruta-preview-backdrop" onClick={onClose}>
      <div className="tz-ruta-preview-card" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <MapContainer
          center={[centro.lat, centro.lng]}
          zoom={14}
          className="tz-ruta-preview-map"
          zoomControl={false}
          attributionControl={false}
        >
          <AjustarVistaPreview puntos={puntos} />
          <TileLayer url={MAPBOX_TILE_URL} attribution={MAPBOX_ATTRIBUTION} />
          {origen && <Marker position={[origen.lat, origen.lng]} icon={ICONO_ORIGEN} />}
          {destino && <Marker position={[destino.lat, destino.lng]} icon={ICONO_DESTINO} />}
          {miPos && <Marker position={[miPos.lat, miPos.lng]} icon={ICONO_YO} />}
        </MapContainer>
        <div className="tz-ruta-preview-caption">
          <span className={origen ? "" : "tz-ruta-preview-faltante"}>🏪 Sucursal{!origen && " (sin coordenadas)"}</span>
          {" · "}
          <span className={destino ? "" : "tz-ruta-preview-faltante"}>🚩 Entrega{!destino && " (sin coordenadas)"}</span>
          {" · "}
          <span className={miPos ? "" : "tz-ruta-preview-faltante"}>🚖 Tu posición{!miPos && " (ubicando…)"}</span>
        </div>
      </div>
    </div>,
    document.body
  );
}

function AjustarVistaPreview({ puntos }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    const v = puntos.filter(Boolean);
    if (v.length >= 2) map.fitBounds(v.map((p) => [p.lat, p.lng]), { padding: [30, 30], maxZoom: 16 });
    else if (v.length === 1) map.setView([v[0].lat, v[0].lng], 15);
  }, [puntos, map]);
  return null;
}

export default function EntregasRepartidorPanel({ conductorId }) {
  const { ofertas, entregasActivas, tieneEnRuta, loading, error, aceptar, rechazar, expirarOferta, avanzar, finalizar } =
    useEntregasRepartidor(conductorId);
  const [abiertaId, setAbiertaId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [aviso, setAviso] = useState("");

  // Vista previa de ruta — modal tradicional, oferta_id visible o null.
  const [verRutaId, setVerRutaId] = useState(null);
  const [miPos, setMiPos] = useState(null);

  const abrirVistaRuta = (ofertaId) => {
    setVerRutaId(ofertaId);
    if (!miPos && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setMiPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    }
  };
  const cerrarVistaRuta = () => setVerRutaId(null);

  // Transmite el GPS del repartidor a TODAS sus entregas activas a la vez.
  useEntregaGpsBroadcaster(
    entregasActivas.map((e) => e.id),
    conductorId
  );

  // Cuando llega una oferta de reparto NUEVA, mostrar el mismo pantallazo
  // intrusivo de "¡Alguien necesita tu servicio!" que ya se usa para las
  // señas de un pasajero (ver alertaSenas en ConductorPage.jsx).
  const [alertaOferta, setAlertaOferta] = useState(false);
  const ofertasVistasRef = useRef(new Set());
  const hidratadoRef = useRef(false);
  useEffect(() => {
    const ids = ofertas.map((o) => o.oferta_id);
    if (!hidratadoRef.current) {
      // Primera pasada: sembrar lo que ya había sin avisar (ej. el
      // conductor recargó la página con una oferta pendiente).
      hidratadoRef.current = true;
      ids.forEach((id) => ofertasVistasRef.current.add(id));
      return;
    }
    if (tieneEnRuta) {
      ids.forEach((id) => ofertasVistasRef.current.add(id));
      return;
    }
    const hayNueva = ids.some((id) => !ofertasVistasRef.current.has(id));
    ids.forEach((id) => ofertasVistasRef.current.add(id));
    if (hayNueva) setAlertaOferta(true);
  }, [ofertas, tieneEnRuta]);

  // Reloj de 30s por oferta: tick cada 250ms (solo mientras hay ofertas
  // pendientes) para la barra verde regresiva, y dispara la expiración
  // automática apenas una llega a 0 — una sola vez por oferta (ref con
  // los ids ya expirados, el poll de refresh() igual la va a traer con
  // estado 'pendiente' un ratito hasta que el RPC la cierre).
  const [ahora, setAhora] = useState(() => Date.now());
  const expirandoRef = useRef(new Set());
  useEffect(() => {
    if (ofertas.length === 0) return undefined;
    const t = setInterval(() => setAhora(Date.now()), 250);
    return () => clearInterval(t);
  }, [ofertas.length]);
  useEffect(() => {
    ofertas.forEach((o) => {
      if (!o.oferta_creada_at) return;
      // Clave por oferta_id + su propio 'created_at': al reofertar a
      // alguien que ya había rechazado/expirado, la fila es la MISMA
      // (mismo oferta_id, upsert) pero con un created_at NUEVO — sin
      // esto, una vez expirada una vez, este cliente nunca la volvía a
      // chequear (quedaba "marcada" para siempre por su id solo).
      const clave = `${o.oferta_id}:${o.oferta_creada_at}`;
      if (expirandoRef.current.has(clave)) return;
      const transcurrido = ahora - new Date(o.oferta_creada_at).getTime();
      if (transcurrido >= TIMEOUT_OFERTA_MS) {
        expirandoRef.current.add(clave);
        expirarOferta(o.oferta_id, o.entrega_id);
      }
    });
  }, [ahora, ofertas, expirarOferta]);

  if (loading && entregasActivas.length === 0 && ofertas.length === 0) return null;
  if (error) return null;
  if (entregasActivas.length === 0 && ofertas.length === 0) return null;

  const onAceptar = async (id) => {
    setBusyId(id);
    setAviso("");
    const r = await aceptar(id);
    setBusyId(null);
    if (r.status === "ya_tomada") setAviso("Otro repartidor tomó ese pedido primero.");
    else if (r.status === "conductor_en_ruta") {
      setAviso("Ya recogiste un pedido — no podés aceptar otro hasta entregarlo.");
    } else if (r.status && r.status !== "ok") setAviso(`No se pudo aceptar (${r.status}).`);
  };

  const onRechazar = async (oferta) => {
    setBusyId(oferta.oferta_id);
    setAviso("");
    await rechazar(oferta.oferta_id, oferta.entrega_id);
    setBusyId(null);
  };

  const entregaAbierta = entregasActivas.find((e) => e.id === abiertaId) || null;
  const ofertaConRuta = ofertas.find((o) => o.oferta_id === verRutaId) || null;

  return (
    <section className="tz-method-history" style={{ marginTop: 18 }}>
      <span className="tz-method-history-label">
        <Bike size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} /> Reparto
      </span>

      {entregasActivas.map((entrega) => (
        <button
          key={entrega.id}
          type="button"
          className="tz-scan-btn tz-payment-save"
          style={{ width: "100%", marginTop: 8, justifyContent: "space-between" }}
          onClick={() => setAbiertaId(entrega.id)}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <PackageCheck size={16} /> Entrega en curso · {entrega.cliente_nombre || "Cliente"}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {entrega.caja_sucursal && (
              <span className="tz-entrega-badge tz-entrega-badge-sucursal">{entrega.caja_sucursal}</span>
            )}
            <span className={`tz-entrega-badge tz-entrega-badge-${entrega.estado}`}>
              {entrega.estado.replace("_", " ")}
            </span>
          </span>
        </button>
      ))}

      {!tieneEnRuta &&
        ofertas.map((o) => {
          const transcurrido = o.oferta_creada_at ? ahora - new Date(o.oferta_creada_at).getTime() : 0;
          const pct = Math.max(0, Math.min(1, 1 - transcurrido / TIMEOUT_OFERTA_MS));
          const tieneRuta = (o.entrega_lat && o.entrega_lng) || o.origen_lat != null;
          return (
            <div key={o.oferta_id} className="tz-add-entry tz-oferta-card" style={{ marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, margin: "0 0 4px" }}>
                <p style={{ margin: 0, fontWeight: 600 }}>{o.cliente_nombre || "Cliente"}</p>
                {tieneRuta && (
                  <button
                    type="button"
                    className="tz-oferta-ruta-btn"
                    aria-label="Ver ruta"
                    title="Ver ruta"
                    onClick={() => abrirVistaRuta(o.oferta_id)}
                  >
                    <MapIcon size={13} /> Ver ruta
                  </button>
                )}
              </div>
              <p className="tz-camera-note" style={{ margin: "0 0 3px", display: "flex", gap: 6 }}>
                <MapPin size={13} /> {o.direccion_entrega || "Sin dirección"}
              </p>
              <p className="tz-camera-note" style={{ margin: "0 0 3px", display: "flex", gap: 6 }}>
                <Store size={13} /> {o.caja_sucursal || "Sucursal"}
              </p>
              {o.total != null && (
                <p className="tz-camera-note" style={{ margin: "0 0 3px" }}>
                  Valor del pedido: {formatSoles(o.total)}
                </p>
              )}
              {o.tarifa != null && (
                <p
                  className="tz-camera-note"
                  style={{ margin: "0 0 6px", color: "var(--green)", fontWeight: 700 }}
                >
                  💰 Tarifa de envío: {formatSoles(o.tarifa)}
                </p>
              )}
              <div className="tz-add-entry-actions">
                <button
                  className="tz-camera-cancel"
                  disabled={busyId === o.oferta_id}
                  onClick={() => onRechazar(o)}
                >
                  <X size={15} /> Rechazar
                </button>
                <button
                  className="tz-scan-btn tz-payment-save"
                  disabled={busyId === o.oferta_id}
                  onClick={() => onAceptar(o.oferta_id)}
                >
                  {busyId === o.oferta_id ? <Loader2 size={15} className="tz-spin" /> : <Check size={15} />} Aceptar
                </button>
              </div>
              {/* Cuenta regresiva de 30s — se expira sola al llegar a 0. */}
              <div className="tz-oferta-timeout-track">
                <div className="tz-oferta-timeout-fill" style={{ width: `${pct * 100}%` }} />
              </div>
            </div>
          );
        })}

      {aviso && <p className="tz-error" style={{ marginTop: 6 }}>{aviso}</p>}

      {entregaAbierta && (
        <EntregaActivaModal
          entrega={entregaAbierta}
          conductorId={conductorId}
          avanzar={avanzar}
          finalizar={finalizar}
          onClose={() => setAbiertaId(null)}
        />
      )}

      {alertaOferta && !tieneEnRuta && (
        <div className="tz-modal-backdrop">
          <div className="tz-senas-alert" onClick={(e) => e.stopPropagation()}>
            <span className="tz-senas-alert-icon" aria-hidden="true">
              🙋‍♂️
            </span>
            <h2>¡Alguien necesita tu servicio!</h2>
            <button
              type="button"
              className="tz-scan-btn tz-senas-alert-btn"
              onClick={() => setAlertaOferta(false)}
            >
              Ver pedido
            </button>
          </div>
        </div>
      )}

      {ofertaConRuta && (
        <RutaPreviewModal
          origen={ofertaConRuta.origen_lat != null ? { lat: Number(ofertaConRuta.origen_lat), lng: Number(ofertaConRuta.origen_lng) } : null}
          destino={
            ofertaConRuta.entrega_lat && ofertaConRuta.entrega_lng
              ? { lat: Number(ofertaConRuta.entrega_lat), lng: Number(ofertaConRuta.entrega_lng) }
              : null
          }
          miPos={miPos}
          onClose={cerrarVistaRuta}
        />
      )}
    </section>
  );
}
