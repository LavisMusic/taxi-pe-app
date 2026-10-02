import { useMemo, useState } from "react";
import { X, Zap, Loader2, CalendarClock, Trash2, Receipt, AlertTriangle } from "lucide-react";
import RecargaRapidaForm from "../recolector/RecargaRapidaForm";
import PanelVentaRegistrada from "../PanelVentaRegistrada";
import { formatSoles, formatDate, formatTime } from "../../utils/format";
import { ESTADOS_CONDUCTOR_OPERATIVOS, METODOS_PAGO, TIPO_ITEM_MEMBRESIA } from "../../lib/taxiEnums";
import { ventaParaPanel } from "../../lib/ventaBoleta";

// Gestor de recarga de UN conductor (botón ⚡ de su tarjeta en el
// Directorio del Admin) — el mismo gestor que el del super admin de Caja
// Tonazo, separado en apartados:
//   * Membresía y estado: membresía actual (o "Sin membresía" si ya
//     venció), vencimiento, créditos y el estado operativo.
//   * Recarga rápida: el formulario de siempre con el conductor ya
//     elegido. Al registrar, sube el desplegable de venta registrada
//     (imprimir / resumen / boleta / copiar) al teléfono del conductor.
//   * Corregir vencimiento: arreglar a mano la fecha o los créditos
//     (no registra ninguna venta).
//   * Pagos: sus ventas con el diseño de "Mis ventas" de la caja —
//     Anular (revierte el saldo) y Boleta. Lo anulado se ve también en
//     el Historial de ventas general.
const APARTADOS = [
  { id: "estado", label: "Membresía y estado" },
  { id: "recarga", label: "Recarga rápida" },
  { id: "vencimiento", label: "Corregir vencimiento" },
  { id: "pagos", label: "Pagos" },
];

const aFechaInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function GestorRecargaConductorModal({
  conductor,
  ventas,
  usuarios,
  paquetes = [],
  onSetEstado,
  onUpdate,
  anular,
  busyId,
  recargaProps,
  onClose,
}) {
  const [apartado, setApartado] = useState("estado");
  const [ventaPanel, setVentaPanel] = useState(null);
  const [confirmandoId, setConfirmandoId] = useState(null);
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState("");
  const [fecha, setFecha] = useState(aFechaInput(conductor.vencimiento_suscripcion));
  const [creditos, setCreditos] = useState(String(conductor.creditos ?? 0));

  const vence = conductor.vencimiento_suscripcion ? new Date(conductor.vencimiento_suscripcion) : null;
  const dias = vence ? Math.ceil((vence - new Date()) / 86400000) : null;
  const membresiaVigente = dias != null && dias >= 0;
  const paqueteActual = paquetes.find((p) => String(p.id) === String(conductor.membresia_paquete_id));
  const labelMetodo = (key) => METODOS_PAGO.find((m) => m.key === key)?.label ?? key;
  const recolectorDe = (v) => usuarios.find((u) => u.id === v.recolector_id)?.nombre || "Admin";

  const susVentas = useMemo(
    () =>
      ventas
        .filter((v) => v.conductor_id === conductor.id)
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
    [ventas, conductor.id]
  );

  const cambiarEstado = async (e) => {
    setGuardando("estado");
    await onSetEstado(conductor.id, e.target.value);
    setGuardando("");
  };

  const corregir = async () => {
    setError("");
    const cred = Number(creditos);
    if (!Number.isInteger(cred) || cred < 0) return setError("Los créditos deben ser un número entero (0 o más).");
    setGuardando("corregir");
    const { error: err } = await onUpdate(conductor.id, {
      // Fin del día elegido (hora de Perú, UTC-5); vacío = sin membresía.
      vencimiento_suscripcion: fecha ? new Date(`${fecha}T23:59:59-05:00`).toISOString() : null,
      creditos: cred,
    });
    setGuardando("");
    if (err) return setError(err.message || "No se pudo guardar.");
    setAviso("Corrección guardada.");
  };

  const handleAnular = async (venta) => {
    setAviso("");
    const { error: err, eraFiado, fiadoEncontrado } = await anular(venta, conductor, null);
    setConfirmandoId(null);
    if (err) return setError("No se pudo anular la venta.");
    if (eraFiado && !fiadoEncontrado) {
      setAviso(`Esta venta era Fiado pero no encontramos la deuda vinculada — revisa la Libreta de Fiados de ${conductor.nombre}.`);
    }
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <h2>
          <Zap size={17} /> Recarga · {conductor.nombre}
        </h2>
        <p className="tz-brand-sub" style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="tz-plan-badge" style={{ "--tz-plan-color": membresiaVigente ? "var(--green)" : "var(--danger)" }}>
            {membresiaVigente ? "Membresía activa" : "Sin membresía"}
          </span>
          {membresiaVigente
            ? `Vence el ${formatDate(vence)} (${dias === 0 ? "hoy" : dias === 1 ? "mañana" : `en ${dias} días`}).`
            : vence
              ? `Venció el ${formatDate(vence)}.`
              : "Nunca tuvo membresía."}
        </p>

        <div className="tz-plan-filtros">
          {APARTADOS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`tz-gasto-tipo-btn ${apartado === a.id ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => {
                setApartado(a.id);
                setError("");
                setAviso("");
                if (a.id === "vencimiento") {
                  setFecha(aFechaInput(conductor.vencimiento_suscripcion));
                  setCreditos(String(conductor.creditos ?? 0));
                }
              }}
            >
              {a.label}
            </button>
          ))}
        </div>

        {apartado === "estado" && (
          <>
            <div className="tz-gestor-recarga-datos">
              <div className="tz-gestor-recarga-dato">
                <span>Membresía</span>
                <strong>{membresiaVigente ? paqueteActual?.nombre || "Membresía" : "Sin membresía"}</strong>
              </div>
              <div className="tz-gestor-recarga-dato">
                <span>Vence</span>
                <strong>{vence ? formatDate(vence) : "—"}</strong>
              </div>
              <div className="tz-gestor-recarga-dato">
                <span>Créditos</span>
                <strong>{conductor.creditos ?? 0}</strong>
              </div>
              <div className="tz-gestor-recarga-dato">
                <span>Teléfono</span>
                <strong>{conductor.telefono || "Sin registrar"}</strong>
              </div>
            </div>
            <label className="tz-plan-campo tz-plan-campo-ancho">
              <span>Estado</span>
              <select
                className="tz-text-input"
                value={conductor.estado ?? ""}
                onChange={cambiarEstado}
                disabled={guardando === "estado"}
              >
                {ESTADOS_CONDUCTOR_OPERATIVOS.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {apartado === "recarga" && (
          <RecargaRapidaForm
            {...recargaProps}
            lockedConductor={conductor}
            sinTitulo
            onVentaRegistrada={({ venta, destinatario, montoRecibido }) =>
              setVentaPanel(ventaParaPanel(venta, destinatario, { cajero: recolectorDe(venta), montoRecibido }))
            }
          />
        )}

        {apartado === "vencimiento" && (
          <div className="tz-plan-seccion" style={{ alignItems: "flex-end" }}>
            <label className="tz-plan-campo">
              <span>Membresía vence el</span>
              <input type="date" className="tz-text-input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </label>
            <label className="tz-plan-campo">
              <span>Créditos</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                className="tz-text-input"
                value={creditos}
                onChange={(e) => setCreditos(e.target.value)}
              />
            </label>
            <button type="button" className="tz-cliente-action-btn" onClick={corregir} disabled={guardando === "corregir"}>
              {guardando === "corregir" ? <Loader2 size={13} className="tz-spin" /> : <CalendarClock size={13} />} Guardar
            </button>
            <p className="tz-stock-editor-sub" style={{ flexBasis: "100%", margin: 0 }}>
              Solo para corregir un error: no registra ninguna venta. Deja la fecha vacía para quitarle la membresía.
            </p>
          </div>
        )}

        {apartado === "pagos" &&
          (susVentas.length === 0 ? (
            <p className="tz-method-history-empty">Todavía no tiene ventas registradas.</p>
          ) : (
            <div className="tz-cierre-list">
              {susVentas.map((v) => (
                <div key={v.id} className={`tz-receipt tz-receipt-compact ${v.anulado ? "tz-plan-pago-anulado" : ""}`}>
                  <div className="tz-receipt-header">
                    <span className="tz-receipt-title">{v.codigo_venta || "—"}</span>
                    <span className="tz-receipt-date">
                      {formatDate(v.created_at)} · {formatTime(v.created_at)} · {labelMetodo(v.metodo_pago)}
                    </span>
                  </div>
                  <div className="tz-receipt-divider" />
                  <div className="tz-receipt-row">
                    <span>{v.detalle || (v.tipo_item === TIPO_ITEM_MEMBRESIA ? "Membresía" : "Créditos")}</span>
                    <strong>{formatSoles(v.monto)}</strong>
                  </div>
                  <div className="tz-receipt-row tz-plan-pagos-nota">
                    <span>Recolector</span>
                    <span>{recolectorDe(v)}</span>
                  </div>
                  <div className="tz-receipt-divider" />
                  <div className="tz-receipt-row tz-receipt-total">
                    <span>Total</span>
                    <strong>{formatSoles(v.monto)}</strong>
                  </div>
                  {v.voucher_url && (
                    <a className="tz-plan-pago-ver" href={v.voucher_url} target="_blank" rel="noreferrer">
                      Ver comprobante
                    </a>
                  )}
                  {v.anulado ? (
                    <p className="tz-tag tz-tag-danger" style={{ marginTop: 10, textAlign: "center" }}>
                      Anulada
                    </p>
                  ) : confirmandoId === v.id ? (
                    <div className="tz-plan-pago-confirmar" style={{ marginTop: 10 }}>
                      ¿Anular? Se revierte el saldo.
                      <button
                        type="button"
                        className="tz-cliente-action-btn tz-cliente-action-deuda"
                        disabled={busyId === v.id}
                        onClick={() => handleAnular(v)}
                      >
                        {busyId === v.id ? <Loader2 size={13} className="tz-spin" /> : <Trash2 size={13} />} Anular
                      </button>
                      <button type="button" className="tz-cliente-action-btn" onClick={() => setConfirmandoId(null)}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="tz-cliente-actions" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="tz-cliente-action-btn tz-cliente-action-deuda"
                        style={{ flex: 1, justifyContent: "center" }}
                        onClick={() => setConfirmandoId(v.id)}
                      >
                        <Trash2 size={13} /> Anular Venta
                      </button>
                      <button
                        type="button"
                        className="tz-cliente-action-btn tz-cliente-action-pago"
                        style={{ flex: 1, justifyContent: "center" }}
                        onClick={() => setVentaPanel(ventaParaPanel(v, conductor, { cajero: recolectorDe(v) }))}
                      >
                        <Receipt size={13} /> Boleta
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}

        {aviso && (
          <p className="tz-success" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {aviso.startsWith("Esta venta") && <AlertTriangle size={14} />} {aviso}
          </p>
        )}
        {error && <p className="tz-error">{error}</p>}
      </div>

      <PanelVentaRegistrada venta={ventaPanel} onCerrar={() => setVentaPanel(null)} />
    </div>
  );
}
