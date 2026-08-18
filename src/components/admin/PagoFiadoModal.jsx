import { useState } from "react";
import { Wallet, Save, X, Loader2, Camera, RotateCcw } from "lucide-react";
import ComprobanteScannerModal from "../recolector/ComprobanteScannerModal";
import { formatSoles } from "../../utils/format";
import {
  METODOS_PAGO,
  METODOS_CON_COMPROBANTE,
  METODO_PAGO_FIADO,
} from "../../lib/taxiEnums";

const METODOS_PARA_PAGO_FIADO = METODOS_PAGO.filter((m) => m.key !== METODO_PAGO_FIADO);

// Abono contra el saldo de un conductor — "Restar Crédito" (parcial,
// el monto tiene que quedar ESTRICTAMENTE por debajo del saldo total:
// si quiere pagar todo, es "Cancelar Cuenta", no un "Restar" que
// coincida con el total) y "Cancelar Cuenta" (el mismo modal, con el
// monto precargado en el saldo completo y bloqueado — no tiene sentido
// "cancelar" por un monto distinto al saldo). Mismo patrón de método de
// pago que Recarga Rápida: Efectivo confirma directo, Yape/Plin/Otros
// obligan a escanear un comprobante antes de poder confirmar.
export default function PagoFiadoModal({ conductor, saldo, modo, registrarPago, onClose }) {
  const esCancelar = modo === "cancelar";
  const [monto, setMonto] = useState(esCancelar ? String(saldo) : "");
  const [metodoPago, setMetodoPago] = useState("");
  const [comprobante, setComprobante] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const montoNum = Number(monto) || 0;
  const requiereComprobante = METODOS_CON_COMPROBANTE.includes(metodoPago);

  const elegirMetodo = (key) => {
    setMetodoPago(key);
    setComprobante(null);
    if (METODOS_CON_COMPROBANTE.includes(key)) setScannerOpen(true);
  };

  const handleConfirmar = async () => {
    setError("");
    if (montoNum <= 0) {
      setError("Ingresa un monto válido.");
      return;
    }
    if (!esCancelar && montoNum >= saldo) {
      setError('El monto debe ser menor a la deuda total. Para pagar todo, usa "Cancelar Cuenta".');
      return;
    }
    if (!metodoPago) {
      setError("Elige cómo pagó.");
      return;
    }
    if (requiereComprobante && !comprobante) {
      setError("Escanea el comprobante antes de confirmar.");
      return;
    }

    setSaving(true);
    const { error: saveError } = await registrarPago({
      conductorId: conductor.id,
      monto: montoNum,
      metodoPago,
      comprobanteUrl: comprobante?.voucherUrl,
    });
    setSaving(false);
    if (saveError) {
      setError("No se pudo registrar el pago.");
      return;
    }
    onClose();
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Wallet size={17} /> {esCancelar ? "Cancelar Cuenta" : "Restar Crédito"}
          </h2>
          <p className="tz-stock-editor-sub">
            {conductor.nombre} · Deuda total: {formatSoles(saldo)}
          </p>

          <label className="tz-field-label">Monto a {esCancelar ? "cancelar" : "restar"} (S/)</label>
          <input
            type="number"
            inputMode="decimal"
            className="tz-amount-input"
            placeholder="0.00"
            value={monto}
            disabled={esCancelar}
            onChange={(e) => setMonto(e.target.value)}
          />
          {!esCancelar && (
            <p className="tz-camera-note" style={{ margin: "4px 0 0" }}>
              Debe ser menor a {formatSoles(saldo)}. Para pagar todo, usa "Cancelar Cuenta".
            </p>
          )}

          <label className="tz-field-label" style={{ marginTop: 12 }}>
            ¿Cómo pagó?
          </label>
          <div className="tz-gasto-tipo-buttons">
            {METODOS_PARA_PAGO_FIADO.map((m) => (
              <button
                key={m.key}
                type="button"
                className={`tz-gasto-tipo-btn tz-metodo-btn tz-metodo-btn-${m.key} ${
                  metodoPago === m.key ? "tz-gasto-tipo-active" : ""
                }`}
                onClick={() => elegirMetodo(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>

          {requiereComprobante && (
            <div className="tz-add-entry" style={{ marginTop: 4 }}>
              {comprobante ? (
                <div className="tz-scan-result">
                  <p className="tz-scan-result-title">Comprobante listo</p>
                  <div className="tz-scan-result-row">
                    <span>ID operación:</span>
                    <strong>{comprobante.opId || "s/d"}</strong>
                  </div>
                  <button
                    type="button"
                    className="tz-camera-cancel tz-image-manager-btn"
                    style={{ marginTop: 8 }}
                    onClick={() => setScannerOpen(true)}
                  >
                    <RotateCcw size={14} /> Volver a escanear
                  </button>
                </div>
              ) : (
                <button type="button" className="tz-scan-btn" onClick={() => setScannerOpen(true)}>
                  <Camera size={16} /> Escanear comprobante
                </button>
              )}
            </div>
          )}

          {error && <p className="tz-error">{error}</p>}
          <button
            type="button"
            className="tz-scan-btn tz-payment-save"
            disabled={saving}
            onClick={handleConfirmar}
            style={{ marginTop: 14 }}
          >
            {saving ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
            {saving ? "Guardando…" : "Confirmar"}
          </button>
        </div>
      </div>

      {scannerOpen && (
        <ComprobanteScannerModal
          precioEsperado={montoNum}
          onConfirm={(data) => {
            setComprobante(data);
            setScannerOpen(false);
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  );
}
