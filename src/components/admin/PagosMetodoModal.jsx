import { useState } from "react";
import { CreditCard, X, ChevronDown, ChevronUp } from "lucide-react";
import { formatSoles, formatDate, formatTime } from "../../utils/format";
import { startOfTodayISO, METODOS_PAGO, METODO_PAGO_EFECTIVO } from "../../lib/taxiEnums";

// "Pagos" del header → dropdown (cada método con lo recaudado hoy) →
// este modal. Mismo diseño que "Pagos" de las cajas de Caja Tonazo: dos
// medidores (Hoy / Histórico) y el historial de ESE método en filas que
// se despliegan con hora, fecha, código, destinatario y la foto del
// comprobante. Todo derivado de `ventas` (ya cargado en
// AdminDashboardPage), sin hook nuevo.
export default function PagosMetodoModal({ metodo, ventasVigentes, conductores, usuarios = [], onClose }) {
  const [abiertoId, setAbiertoId] = useState(null);
  const label = METODOS_PAGO.find((m) => m.key === metodo)?.label ?? metodo;
  const conductoresById = new Map(conductores.map((c) => [c.id, c]));
  const usuariosById = new Map(usuarios.map((u) => [u.id, u]));
  const nombreDe = (v) =>
    v.cliente_id
      ? usuariosById.get(v.cliente_id)?.nombre ?? "Cliente eliminado"
      : conductoresById.get(v.conductor_id)?.nombre ?? "Conductor eliminado";

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
            <CreditCard size={17} /> {label}
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

          <div className="tz-method-history">
            <span className="tz-method-history-label">Historial</span>
            {ventasDelMetodo.length === 0 ? (
              <p className="tz-method-history-empty">Aún no hay ingresos registrados por esta vía.</p>
            ) : (
              <ul className="tz-history-rows">
                {ventasDelMetodo.map((v) => {
                  const abierto = abiertoId === v.id;
                  return (
                    <li key={v.id} className="tz-history-row">
                      <button className="tz-history-row-head" onClick={() => setAbiertoId(abierto ? null : v.id)}>
                        <span className="tz-history-row-method">
                          {v.created_at ? formatDate(v.created_at) : ""} · {nombreDe(v)}
                        </span>
                        <span className="tz-history-row-amount">{formatSoles(v.monto)}</span>
                        {abierto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {abierto && (
                        <div className="tz-history-row-detail">
                          <span>
                            <strong>Hora:</strong> {v.created_at ? formatTime(v.created_at) : "—"}
                          </span>
                          <span>
                            <strong>Fecha:</strong> {v.created_at ? formatDate(v.created_at) : "—"}
                          </span>
                          <span>
                            <strong>Código:</strong> {v.codigo_venta || "—"}
                          </span>
                          <span>
                            <strong>{v.cliente_id ? "Cliente" : "Conductor"}:</strong> {nombreDe(v)}
                          </span>
                          <span>
                            <strong>Detalle:</strong> {v.detalle || "—"}
                          </span>
                          {v.voucher_url ? (
                            <a href={v.voucher_url} target="_blank" rel="noreferrer" className="tz-history-row-photo-link">
                              <img src={v.voucher_url} alt="Comprobante escaneado" className="tz-history-row-photo" />
                            </a>
                          ) : (
                            metodo !== METODO_PAGO_EFECTIVO && (
                              <span className="tz-history-row-manual-note">Sin captura adjunta</span>
                            )
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
