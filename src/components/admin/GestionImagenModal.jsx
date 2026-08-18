import { useState } from "react";
import { createPortal } from "react-dom";
import Cropper from "react-easy-crop";
import { Upload, Camera, Wand2, Check, X, Loader2, Image as ImageIcon, Crop } from "lucide-react";
import { supabase } from "../../supabaseClient";
import { getCroppedImageBlob } from "../../lib/cropImage";

// Restaura el modal "Gestión de Imagen" de la caja registradora vieja
// (mismas clases tz-image-manager-*/tz-ai-*). Sube directo a Storage y
// avisa al padre por `onFotoUrlChange(url)` — NO hace el UPDATE a la
// tabla por su cuenta: así sirve tanto para un conductor que YA existe
// (el padre persiste al toque, ver ConductoresDirectorio/ConductorPage)
// como para el alta de uno nuevo que todavía no tiene fila en `conductores`
// (el padre solo guarda la url en su propio estado hasta el submit, ver
// RegistroConductorModal). `storageKey` reemplaza a "conductor.id" como
// prefijo del nombre de archivo — cualquier string único sirve (id real
// o uno temporal tipo `nuevo-${Date.now()}`).
//
// Elegir foto (Subir/Tomar) YA NO sube directo: entra a un paso de
// recorte (react-easy-crop, cuadrado) — recién "Guardar Recorte" genera
// el blob final (lib/cropImage.js) y lo sube. Sin esto la foto quedaba
// como la cámara la entregó, sin forma de encuadrarla al cuadro final
// de la tarjeta.
//
// `isProfilePic`: "Mejorar con IA" (quita el fondo) SOLO tiene sentido
// para la foto de perfil — las 3 fotos de verificación (Toma General/
// Interior/Conductor+DNI) tienen que quedar crudas, son evidencia para
// que el Admin las revise, no una foto de producto.
//
// "Mejorar con IA" quita el fondo 100% en el navegador
// (@imgly/background-removal, import dinámico — el modelo pesa varios
// MB, no tiene sentido cargarlo si nadie toca el botón) y deja el
// resultado en preview hasta decidir Guardar o Descartar. Opera sobre
// el resultado YA recortado (lastUploadedBlob), no sobre la foto cruda.
//
// createPortal a document.body: el bug reportado ("se encajona sobre
// la tarjeta, no difumina el fondo, y al sacar el mouse se re-centra
// con un parpadeo") era el modal montado DENTRO de una .tz-card — esa
// clase tiene `transform` en :hover, y en CSS cualquier ancestro con
// transform se vuelve el "containing block" de sus descendientes
// position:fixed. O sea: el backdrop/modal (fixed, inset:0) dejaba de
// posicionarse contra el viewport y pasaba a posicionarse contra la
// TARJETA, y al soltar el hover (transform vuelve a "none") saltaba de
// golpe a posicionarse contra el viewport de nuevo — de ahí el
// "glitch". Portal saca el modal del DOM de la tarjeta por completo,
// nunca hereda ese containing block sin importar quién lo abra.
export default function GestionImagenModal({
  nombre,
  fotoUrl,
  storageKey,
  isProfilePic = false,
  onFotoUrlChange,
  onClose,
}) {
  const [imagenUrl, setImagenUrl] = useState(fotoUrl || "");
  const [lastUploadedBlob, setLastUploadedBlob] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // ---- Recorte (paso previo a subir) ----
  const [rawSrc, setRawSrc] = useState("");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [cropError, setCropError] = useState("");

  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiPreviewBlob, setAiPreviewBlob] = useState(null);
  const [aiPreviewUrl, setAiPreviewUrl] = useState("");

  const discardAiPreview = () => {
    if (aiPreviewUrl) URL.revokeObjectURL(aiPreviewUrl);
    setAiPreviewBlob(null);
    setAiPreviewUrl("");
    setAiError("");
  };

  const cerrarRecorte = () => {
    if (rawSrc) URL.revokeObjectURL(rawSrc);
    setRawSrc("");
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setCropError("");
  };

  // 'forcedExt'/'forcedType' existen porque el recorte y el resultado
  // de la IA son Blobs puros (sin '.name', a diferencia de un File del
  // input) — sin esto, tomar ".name.split('.')" explotaría al subir.
  const uploadFoto = async (file, forcedExt, forcedType) => {
    if (!file) return;
    setUploading(true);
    setUploadError("");
    try {
      const ext = forcedExt || (file.name ? (file.name.split(".").pop() || "jpg").toLowerCase() : "jpg");
      const fileName = `${storageKey}-${Date.now()}.${ext}`;
      const { error: storageError } = await supabase.storage
        .from("conductores-fotos")
        .upload(fileName, file, {
          contentType: forcedType || file.type || "image/jpeg",
          upsert: false,
        });
      if (storageError) throw storageError;

      const { data } = supabase.storage.from("conductores-fotos").getPublicUrl(fileName);
      const url = data?.publicUrl;
      if (!url) throw new Error("No se pudo obtener la URL pública de la imagen.");

      setImagenUrl(url);
      onFotoUrlChange(url);
    } catch (err) {
      const rawMessage = err?.message || String(err || "");
      const isBucketMissing = /bucket not found/i.test(rawMessage);
      setUploadError(
        isBucketMissing
          ? "El bucket \"conductores-fotos\" todavía no existe en Supabase Storage — créalo (público) o corre el SQL correspondiente."
          : rawMessage
          ? `No se pudo subir la imagen: ${rawMessage}`
          : "No se pudo subir la imagen. Intenta de nuevo."
      );
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelected = (file) => {
    if (!file) return;
    discardAiPreview();
    cerrarRecorte();
    setRawSrc(URL.createObjectURL(file));
  };

  const handleGuardarRecorte = async () => {
    if (!croppedAreaPixels) {
      setCropError("Ajusta el recorte antes de guardar.");
      return;
    }
    setCropError("");
    try {
      const blob = await getCroppedImageBlob(rawSrc, croppedAreaPixels);
      setLastUploadedBlob(blob);
      await uploadFoto(blob, "jpg", "image/jpeg");
      cerrarRecorte();
    } catch {
      setCropError("No se pudo generar el recorte. Intenta de nuevo.");
    }
  };

  const handleAiEnhance = async () => {
    setAiProcessing(true);
    setAiError("");
    try {
      let source = lastUploadedBlob;
      if (!source) {
        if (!imagenUrl) throw new Error("Primero sube o toma una foto para poder mejorarla.");
        const res = await fetch(imagenUrl);
        if (!res.ok) throw new Error("No se pudo cargar la imagen actual para procesarla.");
        source = await res.blob();
      }

      const { removeBackground } = await import("@imgly/background-removal");
      const resultBlob = await removeBackground(source);

      setAiPreviewBlob(resultBlob);
      setAiPreviewUrl(URL.createObjectURL(resultBlob));
    } catch (err) {
      setAiError(
        err.message ? `No se pudo procesar la imagen: ${err.message}` : "No se pudo procesar la imagen con IA."
      );
    } finally {
      setAiProcessing(false);
    }
  };

  const confirmAiResult = async () => {
    if (!aiPreviewBlob) return;
    await uploadFoto(aiPreviewBlob, "png", "image/png");
    discardAiPreview();
  };

  return createPortal(
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>

        <h2>Gestión de Imagen</h2>
        <p className="tz-stock-editor-sub">{nombre}</p>

        {rawSrc ? (
          <>
            <div className="tz-cropper-container">
              <Cropper
                image={rawSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, areaPixels) => setCroppedAreaPixels(areaPixels)}
              />
              {isProfilePic && (
                // Silueta guía — SVG con viewBox (no px fijos), así se
                // reescala sola con el contenedor sin deformarse en
                // celular ni en PC. pointer-events:none para no tapar
                // el drag/pinch del cropper que tiene debajo.
                <svg className="tz-cropper-guide" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                  <ellipse cx="100" cy="82" rx="40" ry="50" />
                  <path d="M 34 198 Q 34 138 100 128 Q 166 138 166 198" />
                </svg>
              )}
            </div>
            <label className="tz-field-label">Zoom</label>
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="tz-cropper-zoom"
            />
            {cropError && <p className="tz-error">{cropError}</p>}
            <div className="tz-image-manager-actions">
              <button
                type="button"
                className="tz-btn-solido-rojo tz-image-manager-btn"
                onClick={cerrarRecorte}
                disabled={uploading}
              >
                <X size={15} /> Cancelar
              </button>
              <button
                type="button"
                className="tz-btn-solido-verde tz-image-manager-btn"
                onClick={handleGuardarRecorte}
                disabled={uploading}
              >
                {uploading ? <Loader2 size={15} className="tz-spin" /> : <Crop size={15} />}
                Guardar Recorte
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="tz-image-manager-preview">
              {imagenUrl ? (
                <img src={imagenUrl} alt={nombre} />
              ) : (
                <div className="tz-product-image-placeholder">
                  <ImageIcon size={32} />
                </div>
              )}
            </div>

            {uploadError && <p className="tz-error">{uploadError}</p>}
            {uploading && (
              <p className="tz-stock-editor-sub">
                <Loader2 size={14} className="tz-spin" /> Subiendo imagen…
              </p>
            )}

            {!aiPreviewBlob && (
              <div className="tz-image-manager-actions">
                <label className="tz-camera-cancel tz-image-manager-btn">
                  <Upload size={15} /> Subir Foto
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={uploading || aiProcessing}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      handleFileSelected(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                <label className="tz-camera-cancel tz-image-manager-btn">
                  <Camera size={15} /> Tomar Foto
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    disabled={uploading || aiProcessing}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      handleFileSelected(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            )}

            {isProfilePic && !aiPreviewBlob && (
              <button
                type="button"
                className="tz-ai-magic-btn"
                onClick={handleAiEnhance}
                disabled={aiProcessing || uploading || !(lastUploadedBlob || imagenUrl)}
              >
                {aiProcessing ? (
                  <>
                    <Loader2 size={16} className="tz-spin" /> Procesando recorte con IA…
                  </>
                ) : (
                  <>
                    <Wand2 size={16} /> Mejorar con IA
                  </>
                )}
              </button>
            )}
            {aiError && <p className="tz-error">{aiError}</p>}

            {aiPreviewUrl && (
              <div className="tz-ai-result">
                <p className="tz-field-label">Vista previa — fondo removido</p>
                <div className="tz-ai-result-preview">
                  <img src={aiPreviewUrl} alt={`${nombre} sin fondo`} />
                </div>
                <div className="tz-image-manager-actions">
                  <button
                    type="button"
                    className="tz-btn-solido-rojo tz-image-manager-btn"
                    onClick={discardAiPreview}
                    disabled={uploading}
                  >
                    <X size={15} /> Descartar
                  </button>
                  <button
                    type="button"
                    className="tz-btn-solido-verde tz-image-manager-btn"
                    onClick={confirmAiResult}
                    disabled={uploading}
                  >
                    {uploading ? <Loader2 size={15} className="tz-spin" /> : <Check size={15} />}
                    Guardar recorte
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
