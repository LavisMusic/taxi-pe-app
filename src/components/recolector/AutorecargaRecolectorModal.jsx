import { useState } from "react";
import { Wallet, X, Loader2, Camera, RotateCcw } from "lucide-react";
import ComprobanteScannerModal from "./ComprobanteScannerModal";
import { formatSoles } from "../../utils/format";
import { METODOS_PAGO, METODO_PAGO_EFECTIVO, TIPO_ITEM_CREDITOS, TIPO_ITEM_MEMBRESIA } from "../../lib/taxiEnums";

const METODOS_AUTORECARGA = METODOS_PAGO.filter((m) => m.key !== METODO_PAGO_EFECTIVO);

// Autorecarga: el propio Recolector pide saldo desde /recolector
// (botón "Recargar" del footer). A diferencia de la Recarga Rápida que
// hace el Admin sobre su tarjeta (que aplica el saldo al toque), esto
// crea una PETICIÓN pendiente — el Admin la revisa en el Centro de
// Peticiones antes de que el saldo se sume de verdad. Sin Efectivo (no
// hay a quién entregárselo desde acá) y con comprobante SIEMPRE
// obligatorio, sea cual sea el método elegido entre los 4 permitidos
// (Yape/Plin/Otros/Fiado) — a diferencia de Recarga Rápida, donde solo
// Yape/Plin/Otros lo piden.
export default function AutorecargaRecolectorModal({ recolector, paquetes, crearPeticion, onClose }) {
  const [tipoItem, setTipoItem] = useState(TIPO_ITEM_MEMBRESIA);
  const [paqueteId, setPaqueteId] = useState("");
  const [metodoPago, setMetodoPago] = useState("");
  const [comprobante, setComprobante] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const paquetesDelTipo = paquetes.filter((p) => p.tipo_item === tipoItem);
  const paquete = paquetesDelTipo.find((p) => String(p.id) === String(paqueteId)) || null;

  const elegirMetodo = (key) => {
    setMetodoPago(key);
    setComprobante(null);
    setScannerOpen(true);
  };

  const handleEnviar = async () => {
    setError("");
    setSuccessMsg("");
    if (!paquete) {
      setError("Elige un paquete.");
      return;
    }
    if (!metodoPago) {
      setError("Elige cómo vas a pagar.");
      return;
    }
    if (!comprobante) {
      setError("Escanea el comprobante antes de enviar la solicitud.");
      return;
    }
    setSaving(true);
    const { error: submitError } = await crearPeticion({
      recolector,
      paquete,
      metodoPago,
      comprobanteUrl: comprobante.voucherUrl,
      autoAprobar: false,
    });
    setSaving(false);
    if (submitError) {
      setError("No se pudo enviar la solicitud.");
      return;
    }
    setSuccessMsg("Solicitud enviada — el Admin la va a revisar en el Centro de Peticiones.");
    setPaqueteId("");
    setMetodoPago("");
    setComprobante(null);
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Wallet size={17} /> Recargar mi saldo
          </h2>

          <label className="tz-field-label">Tipo</label>
          <div className="tz-gasto-tipo-buttons">
            <button
              type="button"
              className={`tz-gasto-tipo-btn ${tipoItem === TIPO_ITEM_MEMBRESIA ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => {
                setTipoItem(TIPO_ITEM_MEMBRESIA);
                setPaqueteId("");
              }}
            >
              Membresía
            </button>
            <button
              type="button"
              className={`tz-gasto-tipo-btn ${tipoItem === TIPO_ITEM_CREDITOS ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => {
                setTipoItem(TIPO_ITEM_CREDITOS);
                setPaqueteId("");
              }}
            >
              Paquete de Créditos
            </button>
          </div>

          <label className="tz-field-label" style={{ marginTop: 12 }}>
            {tipoItem === TIPO_ITEM_MEMBRESIA ? "Membresía" : "Paquete de créditos"}
          </label>
          <select className="tz-text-input" value={paqueteId} onChange={(e) => setPaqueteId(e.target.value)}>
            <option value="">{paquetesDelTipo.length === 0 ? "Ninguna configurada" : "Elige una opción…"}</option>
            {paquetesDelTipo.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} — {formatSoles(p.precio)}
                {p.tipo_item === TIPO_ITEM_CREDITOS ? ` (${p.creditos} créditos)` : ` (${p.dias_membresia} días)`}
              </option>
            ))}
          </select>

          <label className="tz-field-label" style={{ marginTop: 12 }}>
            ¿Cómo vas a pagar?
          </label>
          <div className="tz-gasto-tipo-buttons">
            {METODOS_AUTORECARGA.map((m) => (
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

          {metodoPago && (
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
          {successMsg && <p className="tz-success">{successMsg}</p>}

          <button
            type="button"
            className="tz-scan-btn tz-payment-save"
            disabled={saving}
            onClick={handleEnviar}
            style={{ marginTop: 14 }}
          >
            {saving ? <Loader2 size={16} className="tz-spin" /> : <Wallet size={16} />}
            {saving ? "Enviando…" : "Enviar Solicitud"}
          </button>
        </div>
      </div>

      {scannerOpen && (
        <ComprobanteScannerModal
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
