import { useEffect, useRef, useState } from "react";
import {
  Html5Qrcode,
  Html5QrcodeSupportedFormats,
  Html5QrcodeScannerState,
} from "html5-qrcode";
import { X, Image as ImageIcon, Loader2 } from "lucide-react";

const SCANNER_ELEMENT_ID = "tz-barcode-scanner-region";

const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.ITF,
];

/* Escáner de "cero clics": se usa el API de bajo nivel (Html5Qrcode)
   en vez de Html5QrcodeScanner porque ESE trae su propia UI (botón de
   permiso, tabs de cámara/archivo, link de "Stop Scanning") — acá no
   queremos nada de eso, solo el feed de cámara. La cámara arranca sola
   apenas el componente se monta (sin ningún botón de "iniciar"), lee
   en video continuo, y en el milisegundo exacto en que decodifica un
   código válido detiene la cámara y avisa al padre — quien decide qué
   hacer (sumar +1 si el producto ya existe, o abrir el alta rápida si
   el código es nuevo) y normalmente cierra este modal de inmediato.
   Acepta tanto códigos de barras 1D (EAN/UPC) como QR 2D. Usa la
   cámara trasera por defecto.

   También ofrece un fallback de subir una foto ya tomada (galería) —
   útil cuando el autoenfoque de la cámara web no engancha bien un
   código, o para pruebas de escritorio sin cámara trasera real. Usa
   html5QrCode.scanFile() sobre la MISMA instancia, así que se detiene
   el video antes de procesar el archivo (no conviven bien al mismo
   tiempo) y, si la imagen no trae ningún código legible, se reactiva
   la cámara para no dejar el modal en un estado muerto. */
export default function BarcodeScannerModal({ onScan, onClose }) {
  const [cameraError, setCameraError] = useState("");
  const [fileBusy, setFileBusy] = useState(false);
  const [fileError, setFileError] = useState("");

  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const html5QrCodeRef = useRef(null);
  const handledRef = useRef(false);
  const cancelledRef = useRef(false);
  const fileInputRef = useRef(null);

  const stopCamera = async () => {
    const html5QrCode = html5QrCodeRef.current;
    if (!html5QrCode) return;
    try {
      if (html5QrCode.getState() === Html5QrcodeScannerState.SCANNING) {
        await html5QrCode.stop();
      }
    } catch {
      // Puede fallar si ya se estaba deteniendo — no es un error que
      // el usuario necesite ver, la cámara igual queda liberada.
    }
  };

  /* qrbox rectangular y ancho (no cuadrado): los códigos de barras 1D
     (EAN/UPC) son alargados, así que un recuadro angosto obliga a
     alejar el producto para que "entre" — y al alejarlo se pierde
     foco. Un rectángulo que ocupa casi todo el ancho del visor da
     margen de sobra para encuadrar sin tener que alejarse. Nota
     técnica real: en esta versión de html5-qrcode el qrbox no es solo
     una guía visual, ES la región que se recorta y decodifica (ver
     getShadedRegionBounds en la librería) — no existe una forma de
     "solo mostrar la guía pero leer toda la pantalla", así que en vez
     de eso se agranda el recuadro al máximo razonable para que en la
     práctica cubra casi todo el visor. */
  const computeQrbox = (viewfinderWidth, viewfinderHeight) => {
    const width = Math.min(viewfinderWidth - 24, Math.floor(viewfinderWidth * 0.92));
    const height = Math.min(viewfinderHeight - 24, Math.floor(viewfinderHeight * 0.5));
    return {
      width: Math.max(width, 200),
      height: Math.max(height, 110),
    };
  };

  const startCamera = async ({ withZoom = true } = {}) => {
    const html5QrCode = html5QrCodeRef.current;
    if (!html5QrCode) return;

    // Resolución alta siempre (más densidad de píxeles ayuda a leer
    // códigos chicos o de lejos); el zoom digital vía "advanced" es
    // best-effort — no todos los navegadores/cámaras lo soportan, así
    // que si start() lo rechaza se reintenta una vez sin él.
    const videoConstraints = {
      facingMode: "environment",
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    };
    if (withZoom) {
      videoConstraints.advanced = [{ zoom: 2.0 }];
    }

    try {
      await html5QrCode.start(
        { facingMode: "environment" },
        {
          fps: 15,
          qrbox: computeQrbox,
          videoConstraints,
        },
        (decodedText) => {
          if (handledRef.current || cancelledRef.current) return;
          handledRef.current = true;
          // Detiene la cámara y avisa al padre en el mismo instante del
          // match — no hay paso de "capturar" ni confirmación manual.
          stopCamera();
          onScanRef.current(decodedText);
        },
        () => {
          // Se llama en CADA frame sin código detectado — flujo normal,
          // no un error, así que se ignora.
        }
      );
    } catch (err) {
      if (cancelledRef.current) return;
      if (withZoom) {
        // El zoom digital no fue aceptado (cámara/navegador sin
        // soporte de la constraint "advanced.zoom") — reintenta con
        // solo la resolución alta, sin zoom.
        return startCamera({ withZoom: false });
      }
      console.error("No se pudo iniciar la cámara:", err);
      setCameraError("No se pudo acceder a la cámara. Revisa los permisos del navegador.");
    }
  };

  useEffect(() => {
    cancelledRef.current = false;
    handledRef.current = false;
    const html5QrCode = new Html5Qrcode(SCANNER_ELEMENT_ID, {
      formatsToSupport: SUPPORTED_FORMATS,
      verbose: false,
    });
    html5QrCodeRef.current = html5QrCode;
    startCamera();

    return () => {
      cancelledRef.current = true;
      handledRef.current = true;
      stopCamera().finally(() => {
        try {
          html5QrCode.clear();
        } catch {
          // Idem — el DOM del modal ya se está desmontando de todas
          // formas.
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileChange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const html5QrCode = html5QrCodeRef.current;
    if (!html5QrCode) return;

    setFileError("");
    setFileBusy(true);
    // scanFile no convive bien con un escaneo de video corriendo al
    // mismo tiempo sobre la misma instancia — se frena la cámara
    // primero.
    await stopCamera();

    try {
      const decodedText = await html5QrCode.scanFile(file, /* showImage= */ false);
      if (handledRef.current || cancelledRef.current) return;
      handledRef.current = true;
      html5QrCode.clear();
      // Mismo flujo que un match de cámara: avisa al padre, que
      // normalmente cierra el modal.
      onScanRef.current(decodedText);
    } catch (err) {
      console.error("No se pudo leer el código en la imagen:", err);
      setFileError(
        "No se encontró ningún código legible en esa imagen. Probá con otra foto o usá la cámara."
      );
      // Reactiva la cámara para que puedan seguir intentando sin tener
      // que cerrar y reabrir el modal a mano.
      if (!cancelledRef.current) {
        startCamera();
      }
    } finally {
      setFileBusy(false);
    }
  };

  return (
    <div className="tz-modal-backdrop" onClick={onClose}>
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>Escanear Producto</h2>
          <p className="tz-stock-editor-sub">
            Encuadra el código dentro del recuadro ancho — no hace falta acercar el producto, se lee solo.
          </p>
          {cameraError && <p className="tz-error">{cameraError}</p>}
          <div id={SCANNER_ELEMENT_ID} className="tz-barcode-scanner-region" />
          {fileError && <p className="tz-error">{fileError}</p>}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="tz-camera-cancel tz-scanner-upload-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={fileBusy}
          >
            {fileBusy ? <Loader2 size={15} className="tz-spin" /> : <ImageIcon size={15} />}
            {fileBusy ? "Leyendo imagen…" : "Adjuntar imagen con código"}
          </button>
        </div>
      </div>
    </div>
  );
}
