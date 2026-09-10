import { useState } from "react";
import { PackageCheck, Bike, MapPin, Store, Check, X, Loader2 } from "lucide-react";
import { useEntregasRepartidor } from "../../hooks/useEntregasRepartidor";
import { useEntregaGpsBroadcaster } from "../../hooks/useEntregaGpsBroadcaster";
import EntregaActivaModal from "./EntregaActivaModal";
import { formatSoles } from "../../utils/format";

// Bandeja de reparto en la pantalla del conductor (ver DELIVERY.md §7).
// Solo se muestra si hay algo que atender: una entrega en curso o
// pedidos ofrecidos por la Caja. No mete ruido si no hay nada.

export default function EntregasRepartidorPanel({ conductorId }) {
  const { ofertas, entregaActiva, loading, error, aceptar, rechazar, avanzar, finalizar } =
    useEntregasRepartidor(conductorId);
  const [abierta, setAbierta] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [aviso, setAviso] = useState("");

  // Transmite el GPS del repartidor mientras haya entrega activa.
  useEntregaGpsBroadcaster(entregaActiva?.id, entregaActiva?.conductor_id);

  if (loading && !entregaActiva && ofertas.length === 0) return null;
  if (error) return null;
  if (!entregaActiva && ofertas.length === 0) return null;

  const onAceptar = async (id) => {
    setBusyId(id);
    setAviso("");
    const r = await aceptar(id);
    setBusyId(null);
    if (r.status === "ya_tomada") setAviso("Otro repartidor tomó ese pedido primero.");
    else if (r.status === "ok") setAbierta(true);
    else if (r.status && r.status !== "ok") setAviso(`No se pudo aceptar (${r.status}).`);
  };

  const onRechazar = async (oferta) => {
    setBusyId(oferta.oferta_id);
    setAviso("");
    await rechazar(oferta.oferta_id, oferta.entrega_id);
    setBusyId(null);
  };

  return (
    <section className="tz-method-history" style={{ marginTop: 18 }}>
      <span className="tz-method-history-label">
        <Bike size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} /> Reparto
      </span>

      {entregaActiva && (
        <button
          type="button"
          className="tz-scan-btn tz-payment-save"
          style={{ width: "100%", marginTop: 8, justifyContent: "space-between" }}
          onClick={() => setAbierta(true)}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <PackageCheck size={16} /> Entrega en curso · {entregaActiva.cliente_nombre || "Cliente"}
          </span>
          <span className={`tz-entrega-badge tz-entrega-badge-${entregaActiva.estado}`}>
            {entregaActiva.estado.replace("_", " ")}
          </span>
        </button>
      )}

      {!entregaActiva &&
        ofertas.map((o) => (
          <div key={o.oferta_id} className="tz-add-entry" style={{ marginTop: 8 }}>
            <p style={{ margin: "0 0 4px", fontWeight: 600 }}>{o.cliente_nombre || "Cliente"}</p>
            <p className="tz-camera-note" style={{ margin: "0 0 3px", display: "flex", gap: 6 }}>
              <MapPin size={13} /> {o.direccion_entrega || "Sin dirección"}
            </p>
            <p className="tz-camera-note" style={{ margin: "0 0 3px", display: "flex", gap: 6 }}>
              <Store size={13} /> {o.caja_sucursal || "Sucursal"}
            </p>
            {o.total != null && (
              <p className="tz-camera-note" style={{ margin: "0 0 6px" }}>
                Valor del pedido: {formatSoles(o.total)}
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
          </div>
        ))}

      {aviso && <p className="tz-error" style={{ marginTop: 6 }}>{aviso}</p>}

      {abierta && entregaActiva && (
        <EntregaActivaModal
          entrega={entregaActiva}
          conductorId={conductorId}
          avanzar={avanzar}
          finalizar={finalizar}
          onClose={() => setAbierta(false)}
        />
      )}
    </section>
  );
}
