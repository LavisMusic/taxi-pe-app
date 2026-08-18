import { useEffect, useRef, useState } from "react";
import { Camera, Check, AlertTriangle, X, Loader2, Paperclip } from "lucide-react";
import { createWorker } from "tesseract.js";
import { supabase } from "../../supabaseClient";
import { formatSoles } from "../../utils/format";

// Mismos patrones de la caja vieja (detectPaymentInfo en App.jsx) para
// adivinar el ID de operación a partir del texto OCR — acá SOLO el ID:
// el monto nunca se lee de la foto, por seguridad se ingresa a mano en
// Recarga Rápida (este modal ni siquiera lo pide).
const ID_PATTERNS = [
  /N[°ºO.]{0,3}\s*(?:DE\s*)?OPERACI[OÓ]N[:\s]*([A-Z0-9-]{4,20})/,
  /C[OÓ]DIGO\s*(?:DE\s*)?OPERACI[OÓ]N[:\s]*([A-Z0-9-]{4,20})/,
  /N[°ºO.]{0,3}\s*OPERACI[OÓ]N[:\s]*([A-Z0-9-]{4,20})/,
  /ID[:\s]*([A-Z0-9-]{4,20})/,
];

function detectOpId(rawText) {
  const text = (rawText || "").toUpperCase();
  for (const re of ID_PATTERNS) {
    const m = text.match(re);
    if (m && m[1]) return m[1];
  }
  const numbers = text.match(/\d{6,}/g);
  return numbers && numbers.length > 0 ? numbers.sort((a, b) => b.length - a.length)[0] : "";
}

const nowDateInput = () => new Date().toISOString().slice(0, 10);
const nowTimeInput = () => new Date().toTimeString().slice(0, 5);

// Escáner de comprobante para Yape/Plin/Otros: cámara + OCR
// (Tesseract.js, mismo motor que ya usaba la caja registradora vieja)
// para adivinar el ID de operación — el recolector siempre revisa y
// puede corregirlo antes de confirmar. Fecha/Hora se prellenan con el
// momento actual pero son editables. El monto NUNCA se lee de la foto
// (por seguridad) — pero si se pasa `precioEsperado` (el precio del
// paquete elegido en Recarga Rápida), se pide re-ingresarlo a mano acá
// y se valida que coincida exacto, mismo patrón "Debe ser exacto" que
// ya usaba la caja vieja para verificar el monto recibido antes de
// cerrar la venta. Requiere el bucket 'comprobantes-fotos' en Storage
// (ver SQL entregado).
export default function ComprobanteScannerModal({ precioEsperado, onConfirm, onClose }) {
  const [view, setView] = useState("camera"); // camera | processing | result
  const [cameraSupported, setCameraSupported] = useState(true);
  const [opId, setOpId] = useState("");
  const [fecha, setFecha] = useState(nowDateInput());
  const [hora, setHora] = useState(nowTimeInput());
  const [montoVerificado, setMontoVerificado] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [uploadError, setUploadError] = useState("");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const attachInputRef = useRef(null);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraSupported(false);
      fileInputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setCameraSupported(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch {
      setCameraSupported(false);
      fileInputRef.current?.click();
    }
  };

  useEffect(() => {
    startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadComprobante = async (blob) => {
    const fileName = `comprobante-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
    const { error } = await supabase.storage
      .from("comprobantes-fotos")
      .upload(fileName, blob, { contentType: "image/jpeg", upsert: false });
    if (error) return { url: null, error: error.message || String(error) };
    const { data } = supabase.storage.from("comprobantes-fotos").getPublicUrl(fileName);
    return { url: data?.publicUrl || null, error: null };
  };

  const processImage = async (blob) => {
    setView("processing");
    setUploadError("");
    try {
      const [ocrText, uploadResult] = await Promise.all([
        (async () => {
          const worker = await createWorker("spa");
          const {
            data: { text },
          } = await worker.recognize(blob);
          await worker.terminate();
          return text;
        })(),
        uploadComprobante(blob),
      ]);
      setOpId(detectOpId(ocrText));
      if (uploadResult.url) setPhotoUrl(uploadResult.url);
      if (uploadResult.error) setUploadError(uploadResult.error);
    } catch (err) {
      setUploadError(err.message || "No se pudo leer el comprobante. Escribe el ID a mano.");
    } finally {
      setView("result");
    }
  };

  const captureFromCamera = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 1280;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    stopCamera();
    canvas.toBlob((blob) => blob && processImage(blob), "image/jpeg", 0.85);
  };

  const handleFileCapture = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) processImage(file);
  };

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={handleClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Camera size={17} /> Escanear comprobante
          </h2>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={handleFileCapture}
          />
          {/* Sin `capture`: en PC (sin cámara trasera que forzar) abre el
             selector de archivos normal, para poder probar el OCR con
             una captura de pantalla o foto de voucher ya guardada. */}
          <input
            ref={attachInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={handleFileCapture}
          />
          <canvas ref={canvasRef} style={{ display: "none" }} />

          {view === "camera" && (
            <div className="tz-camera-view">
              {cameraSupported && (
                <video ref={videoRef} className="tz-camera-video" muted playsInline autoPlay />
              )}
              {!cameraSupported && <p className="tz-camera-note">Abriendo selector de fotos…</p>}
              <div className="tz-camera-actions">
                {cameraSupported && (
                  <button className="tz-scan-btn" onClick={captureFromCamera}>
                    <Camera size={16} /> Capturar y leer
                  </button>
                )}
                <button
                  type="button"
                  className="tz-camera-cancel"
                  onClick={() => attachInputRef.current?.click()}
                >
                  <Paperclip size={15} /> Adjuntar comprobante
                </button>
              </div>
            </div>
          )}

          {view === "processing" && (
            <div className="tz-scan-processing">
              <Loader2 size={26} className="tz-spin" />
              <p>Leyendo comprobante con OCR…</p>
            </div>
          )}

          {view === "result" && (
            <>
              <div className="tz-scan-result">
                <p className="tz-scan-result-title">
                  <Check size={14} /> Comprobante procesado
                </p>
                <div className="tz-scan-result-row">
                  <span>Foto:</span>
                  <strong>{photoUrl ? "Guardada ✓" : "No se pudo subir"}</strong>
                </div>
              </div>
              {uploadError && (
                <p className="tz-error">
                  <AlertTriangle size={14} /> {uploadError}
                </p>
              )}

              {precioEsperado > 0 && (
                <>
                  <label className="tz-field-label">Monto verificado (S/)</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    className="tz-text-input"
                    placeholder={formatSoles(precioEsperado)}
                    value={montoVerificado}
                    onChange={(e) => setMontoVerificado(e.target.value)}
                  />
                  {montoVerificado !== "" &&
                    (Number(montoVerificado) === Number(precioEsperado) ? (
                      <p className="tz-camera-note tz-monto-ok">
                        <Check size={13} /> Coincide con el precio del paquete.
                      </p>
                    ) : (
                      <p className="tz-error">
                        <AlertTriangle size={14} /> Debe ser exacto: {formatSoles(precioEsperado)}.
                      </p>
                    ))}
                </>
              )}

              <label className="tz-field-label">ID de operación</label>
              <input
                type="text"
                className="tz-text-input"
                value={opId}
                onChange={(e) => setOpId(e.target.value)}
                placeholder={opId ? undefined : "No se detectó — escríbelo a mano"}
              />
              <label className="tz-field-label">Fecha</label>
              <input
                type="date"
                className="tz-text-input"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
              <label className="tz-field-label">Hora</label>
              <input
                type="time"
                className="tz-text-input"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
              />

              <div className="tz-image-manager-actions" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="tz-camera-cancel tz-image-manager-btn"
                  onClick={() => {
                    setView("camera");
                    startCamera();
                  }}
                >
                  <Camera size={15} /> Reintentar
                </button>
                <button
                  type="button"
                  className="tz-btn-solido-verde tz-image-manager-btn"
                  onClick={() => onConfirm({ opId: opId.trim(), fecha, hora, voucherUrl: photoUrl })}
                  disabled={
                    !opId.trim() || (precioEsperado > 0 && Number(montoVerificado) !== Number(precioEsperado))
                  }
                >
                  <Check size={15} /> Usar estos datos
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
