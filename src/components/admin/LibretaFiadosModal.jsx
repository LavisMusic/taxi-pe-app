import { useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Plus,
  Save,
  Loader2,
  X,
  MinusCircle,
  CheckCircle2,
  MessageCircle,
  Trash2,
} from "lucide-react";
import { formatSoles, formatDate } from "../../utils/format";
import { buildWhatsappLink } from "../../lib/whatsapp";
import PagoFiadoModal from "./PagoFiadoModal";

// Fila de un conductor deudor: saldo agregado + los 4 botones de acción
// que tenía la libreta vieja (Restar Crédito / Cancelar Cuenta /
// Recordar / Eliminar) — ya no hay un botón "Pagado" por cargo suelto,
// eso quedó reemplazado por el modal de abono (PagoFiadoModal), que
// opera sobre el TOTAL de la cuenta.
function DeudorRow({ conductor, info, registrarPago, eliminarCuentaConductor }) {
  const [open, setOpen] = useState(false);
  const [pagoModo, setPagoModo] = useState(null); // 'restar' | 'cancelar' | null
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);
  const [borrando, setBorrando] = useState(false);

  const handleRecordar = () => {
    const link = buildWhatsappLink(
      conductor?.telefono,
      `Hola ${conductor?.nombre ?? ""}, recuerda que estás debiendo ${formatSoles(
        info.saldo
      )} y tienes 24 horas para pagarlo. Si quieres extender el tiempo, comunícate con nosotros.`
    );
    if (link) window.open(link, "_blank", "noopener");
  };

  const handleEliminar = async () => {
    setBorrando(true);
    await eliminarCuentaConductor(conductor.id);
    setBorrando(false);
  };

  return (
    <li className="tz-history-row">
      <button className="tz-history-row-head" onClick={() => setOpen((prev) => !prev)}>
        <span className="tz-history-row-method tz-cliente-nombre">
          {conductor?.nombre ?? "Conductor eliminado"}
          {conductor?.placa && (
            <span style={{ color: "var(--text-dim)", fontWeight: 600 }}> · {conductor.placa}</span>
          )}
        </span>
        <span className={`tz-history-row-amount ${info.saldo > 0 ? "tz-cliente-debe" : "tz-cliente-aldia"}`}>
          {info.saldo > 0 ? `${formatSoles(info.saldo)} debe` : "Al día"}
        </span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="tz-history-row-detail tz-cliente-detail">
          <span className="tz-product-history-label">Cargos</span>
          {info.cargos.length === 0 ? (
            <p className="tz-method-history-empty">Sin cargos registrados.</p>
          ) : (
            <ul className="tz-mov-list">
              {info.cargos.map((c) => (
                <li key={c.id} className="tz-mov-row tz-mov-deuda">
                  <span className="tz-mov-row-desc">
                    {c.concepto}
                    <span className="tz-mov-row-date">{c.fecha_fiado ? formatDate(c.fecha_fiado) : ""}</span>
                  </span>
                  <strong>{formatSoles(c.monto)}</strong>
                </li>
              ))}
            </ul>
          )}

          {info.pagos.length > 0 && (
            <>
              <span className="tz-product-history-label">Cobros registrados</span>
              <ul className="tz-mov-list">
                {info.pagos.map((p) => (
                  <li key={p.id} className="tz-mov-row tz-mov-pago">
                    <span className="tz-mov-row-desc">
                      {p.metodo_pago}
                      {p.comprobante_url ? " · con comprobante" : ""}
                      <span className="tz-mov-row-date">{p.created_at ? formatDate(p.created_at) : ""}</span>
                    </span>
                    <strong>{formatSoles(p.monto)}</strong>
                  </li>
                ))}
              </ul>
            </>
          )}

          {confirmandoBorrado ? (
            <div className="tz-vis-confirm-delete" style={{ marginTop: 10 }}>
              <p>
                ¿Eliminar toda la cuenta de <strong>{conductor?.nombre}</strong>? Se borran sus cargos y
                pagos — no se puede deshacer.
              </p>
              <div className="tz-vis-confirm-actions">
                <button
                  type="button"
                  className="tz-cliente-action-btn tz-cliente-action-deuda"
                  onClick={handleEliminar}
                  disabled={borrando}
                >
                  {borrando ? <Loader2 size={13} className="tz-spin" /> : <Trash2 size={13} />}
                  Sí, eliminar
                </button>
                <button
                  type="button"
                  className="tz-cliente-action-btn"
                  onClick={() => setConfirmandoBorrado(false)}
                  disabled={borrando}
                >
                  <X size={13} /> Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="tz-add-entry-actions" style={{ flexWrap: "wrap", marginTop: 10 }}>
              <button
                type="button"
                className="tz-cliente-action-btn"
                disabled={info.saldo <= 0}
                onClick={() => setPagoModo("restar")}
              >
                <MinusCircle size={13} /> Restar Crédito
              </button>
              <button
                type="button"
                className="tz-cliente-action-btn tz-cliente-action-pago"
                disabled={info.saldo <= 0}
                onClick={() => setPagoModo("cancelar")}
              >
                <CheckCircle2 size={13} /> Cancelar Cuenta
              </button>
              <button
                type="button"
                className="tz-cliente-action-btn tz-cliente-action-whatsapp"
                disabled={!conductor?.telefono}
                onClick={handleRecordar}
              >
                <MessageCircle size={13} /> Recordar
              </button>
              <button
                type="button"
                className="tz-cliente-action-btn tz-cliente-action-delete"
                onClick={() => setConfirmandoBorrado(true)}
              >
                <Trash2 size={13} /> Eliminar
              </button>
            </div>
          )}
        </div>
      )}

      {pagoModo && (
        <PagoFiadoModal
          conductor={conductor}
          saldo={info.saldo}
          modo={pagoModo}
          registrarPago={registrarPago}
          onClose={() => setPagoModo(null)}
        />
      )}
    </li>
  );
}

// Libreta de fiados — versión TaxiP calcada de la vieja: por cuenta
// (conductor), saldo agregado + los 4 botones de acción (ver
// DeudorRow). "Registrar fiado" (dar de alta un cargo nuevo) sigue
// igual que antes.
export default function LibretaFiadosModal({
  conductores,
  porConductor,
  agregarFiado,
  registrarPago,
  eliminarCuentaConductor,
  onClose,
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [conductorId, setConductorId] = useState("");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const conductoresById = new Map(conductores.map((c) => [c.id, c]));
  const deudores = Object.entries(porConductor).filter(([, info]) => info.cargos.length > 0 || info.pagos.length > 0);
  const totalPorCobrar = deudores.reduce((sum, [, info]) => sum + Math.max(info.saldo, 0), 0);

  const resetForm = () => {
    setAddOpen(false);
    setConductorId("");
    setConcepto("");
    setMonto("");
    setError("");
  };

  const handleGuardar = async () => {
    const montoNum = Number(monto);
    if (!conductorId) {
      setError("Elige un conductor.");
      return;
    }
    if (!concepto.trim()) {
      setError("Ingresa el concepto del fiado.");
      return;
    }
    if (!montoNum || montoNum <= 0) {
      setError("Ingresa un monto válido.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: saveError } = await agregarFiado({
      conductorId,
      concepto: concepto.trim(),
      monto: montoNum,
    });
    setSaving(false);
    if (saveError) {
      setError("No se pudo registrar el fiado.");
      return;
    }
    resetForm();
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <BookOpen size={17} /> Libreta (Fiados)
          </h2>

          {deudores.length > 0 && (
            <div className="tz-method-totals">
              <div className="tz-method-total">
                <span>Por cobrar</span>
                <strong className="tz-pink">{formatSoles(totalPorCobrar)}</strong>
              </div>
              <div className="tz-method-total">
                <span>Conductores</span>
                <strong>{deudores.length}</strong>
              </div>
            </div>
          )}

          {!addOpen ? (
            <button className="tz-scan-btn tz-add-entry-toggle" onClick={() => setAddOpen(true)}>
              <Plus size={16} /> Registrar fiado
            </button>
          ) : (
            <div className="tz-add-entry">
              <label className="tz-field-label">Conductor</label>
              <select
                className="tz-text-input"
                value={conductorId}
                onChange={(e) => setConductorId(e.target.value)}
              >
                <option value="">Elige un conductor…</option>
                {conductores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} · {c.placa}
                  </option>
                ))}
              </select>
              <label className="tz-field-label">Concepto</label>
              <input
                type="text"
                className="tz-text-input"
                placeholder="Ej. Membresía mensual"
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
              />
              <label className="tz-field-label">Monto (S/)</label>
              <input
                type="number"
                inputMode="decimal"
                className="tz-text-input"
                placeholder="0.00"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
              />
              {error && <p className="tz-error">{error}</p>}
              <div className="tz-add-entry-actions">
                <button className="tz-camera-cancel" onClick={resetForm}>
                  Cancelar
                </button>
                <button className="tz-pw-submit tz-payment-save" onClick={handleGuardar} disabled={saving}>
                  {saving ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
                  Guardar
                </button>
              </div>
            </div>
          )}

          {deudores.length === 0 ? (
            <p className="tz-method-history-empty">No hay fiados registrados todavía.</p>
          ) : (
            <div className="tz-method-history">
              <span className="tz-method-history-label">Conductores</span>
              <ul className="tz-history-rows">
                {deudores.map(([id, info]) => (
                  <DeudorRow
                    key={id}
                    conductor={conductoresById.get(id)}
                    info={info}
                    registrarPago={registrarPago}
                    eliminarCuentaConductor={eliminarCuentaConductor}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
