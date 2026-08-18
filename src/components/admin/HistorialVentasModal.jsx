import { useState } from "react";
import { History, Ban, AlertTriangle, X } from "lucide-react";
import { formatSoles, formatDate } from "../../utils/format";
import { TIPO_ITEM_MEMBRESIA } from "../../lib/taxiEnums";

// Historial completo de `ventas` (incluye anuladas, con su badge) +
// botón "Anular" con confirmación inline (mismo patrón de 2 pasos que
// ya usaba CatalogVisibilityAccordion para borrar productos, en vez de
// un window.confirm()). Si la venta era Fiado, useAnularVenta ya anula
// la deuda vinculada automáticamente (vía fiados_conductores.venta_id)
// — el aviso de acá solo aparece si no encontró ninguna (datos de
// antes de que existiera esa columna).
export default function HistorialVentasModal({ ventas, conductores, usuarios, anular, busyId, onClose }) {
  const [confirmandoId, setConfirmandoId] = useState(null);
  const [aviso, setAviso] = useState("");

  const conductoresById = new Map(conductores.map((c) => [c.id, c]));
  const usuariosById = new Map(usuarios.map((u) => [u.id, u]));

  const handleAnular = async (venta) => {
    const conductor = conductoresById.get(venta.conductor_id);
    const { error, eraFiado, fiadoEncontrado } = await anular(venta, conductor);
    setConfirmandoId(null);
    if (!error && eraFiado && !fiadoEncontrado) {
      setAviso(
        `Esta venta era Fiado pero no encontramos la deuda vinculada — revisa la Libreta de Fiados de ${
          conductor?.nombre ?? "este conductor"
        } y ajústala a mano.`
      );
    }
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <History size={17} /> Historial de Ventas
          </h2>

          {aviso && (
            <p className="tz-error" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={14} /> {aviso}
            </p>
          )}

          {ventas.length === 0 ? (
            <p className="tz-method-history-empty">Todavía no hay ventas registradas.</p>
          ) : (
            <ul className="tz-history-rows">
              {ventas.map((v) => {
                const conductor = conductoresById.get(v.conductor_id);
                const recolector = usuariosById.get(v.recolector_id);
                const confirmando = confirmandoId === v.id;
                const esMembresia = v.tipo_item === TIPO_ITEM_MEMBRESIA;

                return (
                  <li key={v.id} className="tz-history-row">
                    <div className="tz-history-row-detail" style={{ padding: 12 }}>
                      <div className="tz-mov-row" style={{ background: "transparent", borderLeft: "none", padding: 0 }}>
                        <span className="tz-mov-row-desc">
                          {conductor?.nombre ?? "Conductor eliminado"} ·{" "}
                          {esMembresia ? "Membresía" : "Créditos"} · {v.detalle}
                          <span className="tz-mov-row-date">
                            {formatDate(v.created_at)} · {v.metodo_pago} · recolector:{" "}
                            {recolector?.nombre ?? "—"}
                          </span>
                        </span>
                        <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                          <strong>{formatSoles(v.monto)}</strong>
                          {v.anulado ? (
                            <span className="tz-tag tz-tag-danger">Anulada</span>
                          ) : confirmando ? (
                            <>
                              <button
                                type="button"
                                className="tz-cliente-action-btn tz-cliente-action-deuda"
                                disabled={busyId === v.id}
                                onClick={() => handleAnular(v)}
                              >
                                Confirmar
                              </button>
                              <button
                                type="button"
                                className="tz-metodo-pago-change"
                                onClick={() => setConfirmandoId(null)}
                              >
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              className="tz-vis-reject-btn"
                              onClick={() => setConfirmandoId(v.id)}
                              aria-label="Anular venta"
                              title="Anular"
                            >
                              <Ban size={14} />
                            </button>
                          )}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
