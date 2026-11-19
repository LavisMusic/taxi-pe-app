import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, RefreshCw, Loader2, Send, RotateCcw } from "lucide-react";

/* Cámara propia del chat — MISMO archivo en Taxi-PE y Caja
   (src/components/chat/CamaraFoto.jsx): mantener iguales.

   "Tomar foto" (menú + de EntradaChat) abre directamente la cámara, sin el
   menú del sistema (que también ofrece la galería): pantalla completa con
   la cámara trasera, botón para disparar, cambiar de cámara si hay más de
   una, y vista previa para repetir o enviar.
   `onFoto(file)`: la foto lista (JPEG). `onCerrar()`. `onFallo(err)`: sin
   permiso o sin cámara (EntradaChat muestra el aviso). */
export default function CamaraFoto({ onFoto, onCerrar, onFallo }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [frontal, setFrontal] = useState(false);
  const [listo, setListo] = useState(false);
  const [variasCamaras, setVariasCamaras] = useState(false);
  const [foto, setFoto] = useState(null); // { file, url }
  const [destello, setDestello] = useState(0);
  const fotoRef = useRef(null);
  fotoRef.current = foto;

  useEffect(() => {
    let vivo = true;
    setListo(false);
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: frontal ? "user" : { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (!vivo) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
        }
        setListo(true);
        navigator.mediaDevices
          .enumerateDevices?.()
          .then((ds) => vivo && setVariasCamaras(ds.filter((d) => d.kind === "videoinput").length > 1))
          .catch(() => {});
      } catch (err) {
        if (vivo) onFallo?.(err);
      }
    })();
    return () => {
      vivo = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontal]);

  // La vista previa usa una URL local: se libera al salir.
  useEffect(() => () => fotoRef.current && URL.revokeObjectURL(fotoRef.current.url), []);

  useEffect(() => {
    const alTeclado = (e) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [onCerrar]);

  const disparar = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    // La frontal se ve como espejo: la foto sale igual que en pantalla.
    if (frontal) {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0);
    setDestello((n) => n + 1);
    c.toBlob(
      (b) => {
        if (!b) return;
        const file = new File([b], `foto-${Date.now()}.jpg`, { type: "image/jpeg" });
        setFoto({ file, url: URL.createObjectURL(b) });
      },
      "image/jpeg",
      0.9
    );
  };

  const repetir = () => {
    if (foto) URL.revokeObjectURL(foto.url);
    setFoto(null);
  };

  return createPortal(
    <div className="tz-camara" role="dialog" aria-label="Cámara">
      <video ref={videoRef} className={`tz-camara-video ${frontal ? "is-espejo" : ""}`} playsInline muted autoPlay />
      {foto && <img src={foto.url} alt="Foto tomada" className="tz-camara-previa" />}
      {!listo && !foto && <Loader2 className="tz-spin tz-camara-cargando" size={34} />}
      {destello > 0 && <div key={destello} className="tz-camara-destello" />}

      <button type="button" className="tz-camara-cerrar" onClick={onCerrar} aria-label="Cerrar cámara">
        <X size={22} />
      </button>

      <div className="tz-camara-barra">
        {foto ? (
          <>
            <button type="button" className="tz-camara-accion" onClick={repetir}>
              <RotateCcw size={18} /> Repetir
            </button>
            <button type="button" className="tz-camara-accion is-enviar" onClick={() => onFoto(foto.file)}>
              <Send size={18} /> Enviar
            </button>
          </>
        ) : (
          <>
            <span className="tz-camara-hueco" />
            <button type="button" className="tz-camara-disparador" onClick={disparar} disabled={!listo} aria-label="Tomar foto">
              <span />
            </button>
            {variasCamaras ? (
              <button type="button" className="tz-camara-girar" onClick={() => setFrontal((f) => !f)} aria-label="Cambiar de cámara">
                <RefreshCw size={20} />
              </button>
            ) : (
              <span className="tz-camara-hueco" />
            )}
          </>
        )}
      </div>

      <style>{`
.tz-camara { position: fixed; inset: 0; z-index: 2147483100; background: #000; display: flex; align-items: center; justify-content: center; overflow: hidden;
  animation: tz-camara-in .45s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes tz-camara-in { from { opacity: 0; transform: scale(.92); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
.tz-camara-video, .tz-camara-previa { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.tz-camara-video.is-espejo { transform: scaleX(-1); }
.tz-camara-previa { object-fit: contain; background: #000; animation: tz-camara-previa-in .4s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes tz-camara-previa-in { from { opacity: 0; transform: scale(1.06); } to { opacity: 1; transform: none; } }
.tz-camara-cargando { color: #2be8ff; position: relative; }
.tz-camara-destello { position: absolute; inset: 0; background: #fff; pointer-events: none; animation: tz-camara-destello .35s ease-out both; }
@keyframes tz-camara-destello { from { opacity: .85; } to { opacity: 0; } }
.tz-camara-cerrar { position: absolute; top: calc(14px + env(safe-area-inset-top, 0px)); right: 14px; width: 44px; height: 44px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.35); background: rgba(0,0,0,.45); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer;
  backdrop-filter: blur(6px); transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
.tz-camara-cerrar:active { transform: scale(.88); }
.tz-camara-barra { position: absolute; left: 0; right: 0; bottom: 0; padding: 18px 26px calc(26px + env(safe-area-inset-bottom, 0px));
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  background: linear-gradient(180deg, transparent, rgba(0,0,0,.6)); }
.tz-camara-hueco { width: 48px; height: 48px; }
.tz-camara-disparador { width: 78px; height: 78px; border-radius: 999px; border: 4px solid #fff; background: transparent; padding: 5px; cursor: pointer;
  box-shadow: 0 0 22px rgba(43,232,255,.55); transition: transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease; }
.tz-camara-disparador span { display: block; width: 100%; height: 100%; border-radius: 999px; background: #fff; transition: transform .25s cubic-bezier(.34,1.56,.64,1); }
.tz-camara-disparador:active span { transform: scale(.82); }
.tz-camara-disparador:disabled { opacity: .45; box-shadow: none; }
.tz-camara-girar { width: 48px; height: 48px; border-radius: 999px; border: 1px solid rgba(255,255,255,.35); background: rgba(0,0,0,.45); color: #fff;
  display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform .5s cubic-bezier(.34,1.56,.64,1); }
.tz-camara-girar:active { transform: rotate(180deg) scale(.9); }
.tz-camara-accion { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 16px; border-radius: 16px; cursor: pointer;
  font: inherit; font-weight: 800; font-size: 15px; color: #fff; border: 1px solid rgba(255,255,255,.4); background: rgba(0,0,0,.5); backdrop-filter: blur(6px);
  animation: tz-camara-previa-in .45s cubic-bezier(.34,1.56,.64,1) both; transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
.tz-camara-accion:active { transform: scale(.94); }
.tz-camara-accion.is-enviar { border-color: rgba(57,255,176,.8); background: rgba(16,120,80,.75); box-shadow: 0 0 20px rgba(57,255,176,.5); }
`}</style>
    </div>,
    document.body
  );
}
