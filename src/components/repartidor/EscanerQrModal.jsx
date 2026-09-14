import { useEffect, useRef, useState } from "react";
import { X, Loader2, PartyPopper } from "lucide-react";
import jsQR from "jsqr";
import Confetti from "../Confetti";

// Escáner de QR para confirmar la entrega. El QR del cliente codifica el
// PIN (DELIVERY.md §6). Devuelve el texto leído por `onLeido`. Si pasan
// ~20 s sin leer nada, llama `onTimeout`. Si no hay cámara o el usuario
// niega el permiso, llama `onSinCamara(mensaje)` (ahí la pantalla padre
// muestra directo el input de PIN).
//
// `confirmado`: el padre (EntregaActivaModal) lo pone en true apenas la
// entrega quedó confirmada de verdad — este modal se queda ABIERTO
// mostrando la pantalla de éxito + serpentinas en vez de cerrarse al
// toque, y es el padre quien lo cierra un rato después.

const TIMEOUT_MS = 20000;

export default function EscanerQrModal({ onLeido, onTimeout, onSinCamara, onCancelar, confirmado = false }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let cancelado = false;
    let raf = null;
    let timeoutId = null;
    let stream = null;

    const detener = () => {
      cancelado = true;
      if (raf) cancelAnimationFrame(raf);
      if (timeoutId) clearTimeout(timeoutId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };

    const tick = () => {
      if (cancelado) return;
      const v = videoRef.current;
      const c = canvasRef.current;
      if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
        if (code && code.data) {
          detener();
          onLeido(code.data.trim());
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const arrancar = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        onSinCamara("Este dispositivo no permite usar la cámara.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current;
        v.srcObject = stream;
        await v.play();
        setListo(true);
        timeoutId = setTimeout(() => {
          if (!cancelado) {
            detener();
            onTimeout();
          }
        }, TIMEOUT_MS);
        raf = requestAnimationFrame(tick);
      } catch (err) {
        onSinCamara(
          err && err.name === "NotAllowedError"
            ? "No diste permiso para usar la cámara."
            : "No se pudo abrir la cámara."
        );
      }
    };

    arrancar();
    return detener;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="tz-modal-backdrop" style={{ zIndex: 90 }}>
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        {!confirmado && (
          <button className="tz-modal-close" onClick={onCancelar} aria-label="Cerrar">
            <X size={18} />
          </button>
        )}
        {confirmado ? (
          <div className="tz-qr-confirmado">
            <span className="tz-qr-confirmado-icono">
              <PartyPopper size={30} />
            </span>
            <h3>¡Entrega confirmada!</h3>
            <p className="tz-camera-note">Gracias por completar el reparto.</p>
          </div>
        ) : (
          <>
            <h2>Escanear QR del cliente</h2>
            <p className="tz-camera-note">Apuntá la cámara al QR que te muestra el cliente.</p>
            <div className="tz-qr-viewport">
              <video ref={videoRef} playsInline muted />
              {!listo && (
                <div className="tz-qr-loading">
                  <Loader2 size={24} className="tz-spin" />
                </div>
              )}
              <div className="tz-qr-frame" />
            </div>
            <canvas ref={canvasRef} style={{ display: "none" }} />
            <div className="tz-add-entry-actions" style={{ marginTop: 10 }}>
              <button className="tz-camera-cancel" onClick={onCancelar}>Cancelar</button>
            </div>
          </>
        )}
      </div>
      {confirmado && <Confetti />}
    </div>
  );
}
