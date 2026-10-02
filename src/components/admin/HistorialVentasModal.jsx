import { useMemo, useState } from "react";
import { History, Ban, AlertTriangle, X, ChevronLeft, ChevronRight } from "lucide-react";
import { formatSoles, formatDate } from "../../utils/format";
import { METODOS_PAGO, TIPO_ITEM_MEMBRESIA } from "../../lib/taxiEnums";

// Historial de ventas — mismo diseño que el Historial de ventas del
// super admin de Caja Tonazo: navegación mes por mes, total cobrado del
// mes (sin anuladas), y cada venta con su código de operación
// (TX-000001…, automático), cliente/conductor, membresía o créditos,
// método, comprobante y recolector.
// Anular (con confirmación de 2 pasos) revierte el saldo — ver
// useAnularVenta; si era Fiado anula la deuda vinculada y, si no la
// encuentra (datos viejos), avisa para ajustarla a mano.
// `puedeAnular` (default true): RecolectorPage.jsx lo pasa en false —
// el recolector no puede borrar sus propias ventas.
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export default function HistorialVentasModal({ ventas, conductores, usuarios, anular, busyId, onClose, puedeAnular = true }) {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth());
  const [confirmandoId, setConfirmandoId] = useState(null);
  const [aviso, setAviso] = useState("");
  const [ver, setVer] = useState(null);

  const conductoresById = new Map(conductores.map((c) => [c.id, c]));
  const usuariosById = new Map(usuarios.map((u) => [u.id, u]));

  const delMes = useMemo(() => {
    const desde = new Date(anio, mes, 1).getTime();
    const hasta = new Date(anio, mes + 1, 1).getTime();
    return ventas
      .filter((v) => {
        const t = v.created_at ? new Date(v.created_at).getTime() : 0;
        return t >= desde && t < hasta;
      })
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [ventas, anio, mes]);
  const vigentes = delMes.filter((v) => !v.anulado);
  const total = vigentes.reduce((s, v) => s + Number(v.monto || 0), 0);

  const mover = (delta) => {
    const d = new Date(anio, mes + delta, 1);
    setAnio(d.getFullYear());
    setMes(d.getMonth());
  };
  const esMesActual = anio === hoy.getFullYear() && mes === hoy.getMonth();
  const labelMetodo = (key) => METODOS_PAGO.find((m) => m.key === key)?.label ?? key;

  const handleAnular = async (venta) => {
    const conductor = conductoresById.get(venta.conductor_id);
    const cliente = usuariosById.get(venta.cliente_id);
    const { error, eraFiado, fiadoEncontrado } = await anular(venta, conductor, cliente);
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
        <h2>
          <History size={17} /> Historial de Ventas
        </h2>
        <div className="tz-sa-mes-nav">
          <button type="button" className="tz-vis-edit-btn" onClick={() => mover(-1)} aria-label="Mes anterior">
            <ChevronLeft size={16} />
          </button>
          <strong>
            {MESES[mes]} {anio}
          </strong>
          <button type="button" className="tz-vis-edit-btn" onClick={() => mover(1)} disabled={esMesActual} aria-label="Mes siguiente">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="tz-stat-chip tz-stat-chip-green" style={{ margin: "10px 0 14px" }}>
          <span className="tz-stat-label">Total cobrado</span>
          <span className="tz-stat-value">{formatSoles(total)}</span>
          <span className="tz-stat-sub">
            {vigentes.length} venta{vigentes.length === 1 ? "" : "s"}
            {delMes.length > vigentes.length ? ` · ${delMes.length - vigentes.length} anulada(s)` : ""}
          </span>
        </div>

        {aviso && (
          <p className="tz-error" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={14} /> {aviso}
          </p>
        )}

        {delMes.length === 0 ? (
          <p className="tz-method-history-empty">No hay ventas en este mes.</p>
        ) : (
          <ul className="tz-plan-pagos">
            {delMes.map((v) => {
              const conductor = conductoresById.get(v.conductor_id);
              const cliente = usuariosById.get(v.cliente_id);
              const esVentaCliente = !!v.cliente_id;
              const recolector = usuariosById.get(v.recolector_id);
              const confirmando = confirmandoId === v.id;
              const esMembresia = v.tipo_item === TIPO_ITEM_MEMBRESIA;
              return (
                <li key={v.id} className={v.anulado ? "tz-plan-pago-anulado" : ""}>
                  <span className="tz-plan-pago-codigo">{v.codigo_venta || "—"}</span>
                  <span>{v.created_at ? formatDate(v.created_at) : ""}</span>
                  <strong>
                    {esVentaCliente ? (cliente?.nombre ?? "Cliente eliminado") : (conductor?.nombre ?? "Conductor eliminado")}
                  </strong>
                  <span>
                    {esVentaCliente ? "Cliente" : "Conductor"} · {esMembresia ? "Membresía" : "Créditos"} · {v.detalle} ·{" "}
                    {formatSoles(v.monto)} · {labelMetodo(v.metodo_pago)}
                  </span>
                  <span className="tz-plan-pagos-nota">Recolector: {recolector?.nombre ?? "—"}</span>
                  {v.voucher_url && (
                    <button type="button" className="tz-plan-pago-ver" onClick={() => setVer(v)}>
                      Ver comprobante
                    </button>
                  )}
                  {v.anulado ? (
                    <span className="tz-tag tz-tag-danger">Anulada</span>
                  ) : !puedeAnular ? null : confirmando ? (
                    <span className="tz-plan-pago-confirmar">
                      ¿Anular? Se revierte el saldo.
                      <button
                        type="button"
                        className="tz-cliente-action-btn tz-cliente-action-deuda"
                        disabled={busyId === v.id}
                        onClick={() => handleAnular(v)}
                      >
                        <Ban size={13} /> Anular
                      </button>
                      <button type="button" className="tz-cliente-action-btn" onClick={() => setConfirmandoId(null)}>
                        Cancelar
                      </button>
                    </span>
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
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {ver && (
        <div className="tz-modal-backdrop" style={{ zIndex: 120 }}>
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="tz-modal-close" onClick={() => setVer(null)} aria-label="Cerrar">
              <X size={18} />
            </button>
            <h2>Comprobante · {ver.codigo_venta}</h2>
            <img src={ver.voucher_url} alt="Comprobante" style={{ width: "100%", borderRadius: 12 }} />
          </div>
        </div>
      )}
    </div>
  );
}
