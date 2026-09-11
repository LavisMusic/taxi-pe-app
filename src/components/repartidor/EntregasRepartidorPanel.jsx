import { useEffect, useRef, useState } from "react";
import { PackageCheck, Bike, MapPin, Store, Check, X, Loader2 } from "lucide-react";
import { useEntregasRepartidor } from "../../hooks/useEntregasRepartidor";
import { useEntregaGpsBroadcaster } from "../../hooks/useEntregaGpsBroadcaster";
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

export default function EntregasRepartidorPanel({ conductorId }) {
  const { ofertas, entregasActivas, tieneEnRuta, loading, error, aceptar, rechazar, avanzar, finalizar } =
    useEntregasRepartidor(conductorId);
  const [abiertaId, setAbiertaId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [aviso, setAviso] = useState("");

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
          <span className={`tz-entrega-badge tz-entrega-badge-${entrega.estado}`}>
            {entrega.estado.replace("_", " ")}
          </span>
        </button>
      ))}

      {!tieneEnRuta &&
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
    </section>
  );
}
