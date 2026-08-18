import { useState } from "react";
import { X, Camera, Send } from "lucide-react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import { formatSoles } from "../utils/format";

// Flujo estricto: el cliente NUNCA modifica su deuda directamente. Esto
// solo sube el comprobante a Storage e inserta una fila 'pendiente' en
// pagos_pendientes — el descuento real ocurre cuando el admin aprueba
// (ver resolverPagoPendiente en App.jsx).
export default function EnviarComprobanteModal({
  tipo, // 'restar' | 'cancelar'
  clienteId,
  saldoTotal,
  onClose,
  onSubmitted,
}) {
  const { session } = useAuth();
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [monto, setMonto] = useState(tipo === "cancelar" ? saldoTotal.toFixed(2) : "");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const montoNum = parseFloat(monto);
  const montoValido =
    tipo === "cancelar"
      ? !isNaN(montoNum) && Math.abs(montoNum - saldoTotal) <= 0.009
      : !isNaN(montoNum) && montoNum > 0 && montoNum - saldoTotal <= 0.009;
  const canSubmit = !!file && montoValido && !isSubmitting;

  const handleFileChange = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setError("");
  };

  const handleSubmit = async () => {
    if (!canSubmit || !session?.user?.id) return;
    setIsSubmitting(true);
    setError("");

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const requestedPath = `${session.user.id}/${Date.now()}.${ext}`;

    try {
      console.log("[EnviarComprobante] subiendo a Storage:", {
        bucket: "comprobantes",
        path: requestedPath,
        size: file.size,
        type: file.type,
      });

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("comprobantes")
        .upload(requestedPath, file, { contentType: file.type || "image/jpeg" });

      if (uploadError) {
        // Causa más probable: falta (o no se aplicó) la política RLS de
        // INSERT en storage.objects para el bucket 'comprobantes' — el
        // mensaje de Supabase suele decir algo como "new row violates
        // row-level security policy".
        console.error("[EnviarComprobante] Error al subir a Storage:", uploadError);
        setError(
          uploadError.message
            ? `No se pudo subir la imagen: ${uploadError.message}`
            : "No se pudo subir la imagen. Intenta de nuevo."
        );
        return;
      }

      // Usamos la ruta que Supabase confirma haber guardado (uploadData.path),
      // no la que armamos localmente, para no insertar una referencia a un
      // archivo que en realidad no quedó ahí.
      const confirmedPath = uploadData?.path || requestedPath;
      console.log("[EnviarComprobante] subida OK:", uploadData);

      const { error: insertError } = await supabase.from("pagos_pendientes").insert({
        cliente_id: clienteId,
        monto: montoNum,
        tipo,
        url_comprobante: confirmedPath,
        estado: "pendiente",
      });

      if (insertError) {
        console.error("[EnviarComprobante] Error al registrar pago pendiente:", insertError);
        setError(
          insertError.message
            ? `No se pudo enviar el comprobante: ${insertError.message}`
            : "No se pudo enviar el comprobante. Intenta de nuevo."
        );
        return;
      }

      onSubmitted?.();
    } catch (err) {
      console.error("[EnviarComprobante] Error inesperado:", err);
      setError("Ocurrió un error inesperado. Intenta de nuevo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="tz-modal-backdrop" onClick={onClose}>
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>

        <h2>Enviar evidencia de pago</h2>
        <p className="tz-stock-editor-sub">
          {tipo === "cancelar"
            ? `Cancelar cuenta — debe ser exactamente ${formatSoles(saldoTotal)}.`
            : `Restar crédito — hasta ${formatSoles(saldoTotal)}.`}
        </p>

        <div className="tz-add-entry">
          <label className="tz-field-label">Comprobante (foto o captura)</label>
          <label className="tz-scan-btn" style={{ cursor: "pointer" }}>
            <Camera size={16} />
            {file ? "Cambiar imagen" : "Adjuntar imagen"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </label>
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Vista previa del comprobante"
              style={{ width: "100%", borderRadius: 10, marginTop: 4 }}
            />
          )}

          <label className="tz-field-label">
            {tipo === "cancelar" ? "Monto (debe ser exacto)" : "Monto a restar (S/)"}
          </label>
          <input
            type="text"
            inputMode="decimal"
            className="tz-amount-input"
            placeholder="0.00"
            value={monto}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^\d*\.?\d{0,2}$/.test(v)) setMonto(v);
            }}
          />
          {monto && !montoValido && (
            <p className="tz-error">
              {tipo === "cancelar"
                ? `El monto debe ser exactamente ${formatSoles(saldoTotal)}.`
                : `Ingresa un monto mayor a 0 y hasta ${formatSoles(saldoTotal)}.`}
            </p>
          )}
          {error && <p className="tz-error">{error}</p>}

          <div className="tz-add-entry-actions">
            <button className="tz-camera-cancel" onClick={onClose}>
              Cancelar
            </button>
            <button
              className="tz-scan-btn tz-payment-save"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              <Send size={16} />
              {isSubmitting ? "Enviando..." : "Enviar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
