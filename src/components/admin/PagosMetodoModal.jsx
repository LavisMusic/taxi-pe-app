import { Wallet, X, ExternalLink } from "lucide-react";
import { formatSoles, formatDate } from "../../utils/format";
import { startOfTodayISO, METODOS_PAGO } from "../../lib/taxiEnums";

// "Pagos" del header → dropdown Yape/Plin/Otros/Fiados → este modal
// para los 3 primeros (Fiados sigue abriendo la Libreta de siempre).
// Dos medidores (Hoy/Histórico, mismo look que "Por cobrar" de la
// Libreta) + el historial de comprobantes de ESE método — todo
// derivado de `ventas` que ya está cargado en AdminDashboardPage, sin
// hook nuevo.
export default function PagosMetodoModal({ metodo, ventasVigentes, conductores, onClose }) {
  const label = METODOS_PAGO.find((m) => m.key === metodo)?.label ?? metodo;
  const conductoresById = new Map(conductores.map((c) => [c.id, c]));

  const ventasDelMetodo = ventasVigentes
    .filter((v) => v.metodo_pago === metodo)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  const startToday = startOfTodayISO();
  const totalHoy = ventasDelMetodo
    .filter((v) => v.created_at && v.created_at >= startToday)
    .reduce((sum, v) => sum + Number(v.monto || 0), 0);
  const totalHistorico = ventasDelMetodo.reduce((sum, v) => sum + Number(v.monto || 0), 0);

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Wallet size={17} /> {label}
          </h2>

          <div className="tz-method-totals">
            <div className="tz-method-total">
              <span>Hoy</span>
              <strong className="tz-green">{formatSoles(totalHoy)}</strong>
            </div>
            <div className="tz-method-total">
              <span>Histórico</span>
              <strong>{formatSoles(totalHistorico)}</strong>
            </div>
          </div>

          {ventasDelMetodo.length === 0 ? (
            <p className="tz-method-history-empty">Aún no hay ingresos registrados por esta vía.</p>
          ) : (
            <div className="tz-method-history">
              <span className="tz-method-history-label">Historial</span>
              <ul className="tz-history-rows">
                {ventasDelMetodo.map((v) => (
                  <li key={v.id} className="tz-history-row">
                    <div
                      className="tz-history-row-detail"
                      style={{ padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                    >
                      <span>
                        <strong style={{ color: "var(--text)" }}>
                          {conductoresById.get(v.conductor_id)?.nombre ?? "Conductor eliminado"}
                        </strong>
                        <p style={{ margin: "2px 0", color: "var(--text-dim)", fontSize: 12.5 }}>
                          {v.created_at ? formatDate(v.created_at) : ""}
                          {v.voucher_url && (
                            <>
                              {" · "}
                              <a href={v.voucher_url} target="_blank" rel="noreferrer" style={{ color: "var(--cyan)" }}>
                                comprobante <ExternalLink size={11} style={{ verticalAlign: "-1px" }} />
                              </a>
                            </>
                          )}
                        </p>
                      </span>
                      <strong>{formatSoles(v.monto)}</strong>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
