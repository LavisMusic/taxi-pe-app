import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Send } from "lucide-react";
import { EstrellasElegir, RUTA_ESTRELLA } from "./Estrellas";

/* Ventana para calificar un servicio — MISMO archivo en Taxi-PE y Caja
   (src/components/CalificarModal.jsx): mantener iguales.
   Props: nombre, foto, titulo ("¿Cómo te fue con tu conductor?"),
   detalle (placa, fecha…), onEnviar(estrellas, comentario) → { error? },
   onCerrar() (cerrar sin calificar: queda como pendiente). */

const TEXTOS = ["", "Malo", "Regular", "Bien", "Muy bien", "¡Excelente!"];
const MAX = 280;

export default function CalificarModal({ nombre, foto, titulo, detalle, onEnviar, onCerrar }) {
  const [estrellas, setEstrellas] = useState(0);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);

  useEffect(() => {
    if (!listo) return undefined;
    const t = setTimeout(() => onCerrar?.(true), 1700);
    return () => clearTimeout(t);
  }, [listo, onCerrar]);

  const enviar = async () => {
    if (!estrellas) return setError("Elige de 1 a 5 estrellas.");
    setEnviando(true);
    setError("");
    const r = await onEnviar(estrellas, comentario.trim());
    setEnviando(false);
    if (r?.error) return setError(r.error.message || "No se pudo enviar la calificación.");
    setListo(true);
  };

  return createPortal(
    <div className="tz-calif-fondo" onClick={() => !enviando && !listo && onCerrar?.(false)}>
      <style>{ESTILO}</style>
      <div className={`tz-calif ${listo ? "is-listo" : ""}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {!listo && (
          <button type="button" className="tz-calif-cerrar" onClick={() => onCerrar?.(false)} aria-label="Calificar después">
            <X size={18} />
          </button>
        )}
        {listo ? (
          <div className="tz-calif-gracias">
            <div className="tz-calif-explosion" aria-hidden="true">
              {Array.from({ length: 10 }, (_, i) => (
                <svg key={i} viewBox="0 0 24 24" style={{ "--a": `${i * 36}deg`, "--r": `${70 + (i % 3) * 18}px`, "--d": `${i * 25}ms` }}>
                  <path d={RUTA_ESTRELLA} />
                </svg>
              ))}
              <svg viewBox="0 0 24 24" className="tz-calif-estrella-grande"><path d={RUTA_ESTRELLA} /></svg>
            </div>
            <strong>¡Gracias!</strong>
            <span>Tu calificación ayuda a toda la comunidad.</span>
          </div>
        ) : (
          <>
            <div className="tz-calif-foto">
              {foto ? <img src={foto} alt="" /> : <span>{(nombre || "?").replace("@", "").slice(0, 1).toUpperCase()}</span>}
            </div>
            <h3 className="tz-calif-titulo">{titulo}</h3>
            <p className="tz-calif-nombre">
              {nombre}
              {detalle && <small> · {detalle}</small>}
            </p>
            <EstrellasElegir valor={estrellas} onCambiar={(n) => { setEstrellas(n); setError(""); }} disabled={enviando} />
            <p className={`tz-calif-texto ${estrellas ? "is-visible" : ""}`} key={estrellas}>{TEXTOS[estrellas] || "Toca las estrellas"}</p>
            <div className={`tz-calif-comentario ${estrellas ? "is-abierto" : ""}`}>
              <textarea
                value={comentario}
                maxLength={MAX}
                rows={3}
                placeholder="Cuéntanos más (opcional)"
                onChange={(e) => setComentario(e.target.value)}
                disabled={enviando}
              />
              <small>{comentario.length}/{MAX}</small>
            </div>
            {error && <p className="tz-calif-error">{error}</p>}
            <div className="tz-calif-acciones">
              <button type="button" className="tz-calif-luego" onClick={() => onCerrar?.(false)} disabled={enviando}>
                Después
              </button>
              <button type="button" className="tz-calif-enviar" onClick={enviar} disabled={enviando || !estrellas}>
                {enviando ? <Loader2 size={16} className="tz-spin" /> : <Send size={16} />}
                Enviar
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

const ESTILO = `
.tz-calif-fondo { position: fixed; inset: 0; z-index: 9000; display: grid; place-items: center; padding: 16px;
  background: rgba(5,3,12,0.72); backdrop-filter: blur(6px); animation: tz-calif-fade .3s ease both; }
.tz-calif { position: relative; width: min(380px, 100%); display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 26px 20px 18px; border-radius: 24px; text-align: center; color: var(--text, #f4f2ff);
  background: linear-gradient(160deg, rgba(30,22,58,0.97), rgba(14,9,30,0.97));
  border: 1px solid rgba(255,216,74,0.35); box-shadow: 0 0 40px rgba(255,216,74,0.18), 0 20px 60px rgba(0,0,0,0.5);
  animation: tz-calif-in .55s cubic-bezier(.34,1.56,.64,1) both; }
.tz-calif-cerrar { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border-radius: 50%; border: 0; cursor: pointer;
  display: grid; place-items: center; color: var(--text-dim, #9c93c2); background: rgba(255,255,255,0.06);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), color .2s ease; }
.tz-calif-cerrar:hover { transform: rotate(90deg) scale(1.1); color: #fff; }
.tz-calif-foto { width: 74px; height: 74px; border-radius: 50%; overflow: hidden; display: grid; place-items: center;
  border: 2px solid #ffd84a; box-shadow: 0 0 22px rgba(255,216,74,0.5); background: #14101f; font-size: 28px; font-weight: 900; color: #ffd84a;
  animation: tz-calif-flota 3s ease-in-out infinite; }
.tz-calif-foto img { width: 100%; height: 100%; object-fit: cover; }
.tz-calif-titulo { margin: 6px 0 0; font-size: 18px; font-weight: 900; color: #fff; }
.tz-calif-nombre { margin: 0 0 6px; font-size: 14px; font-weight: 700; color: var(--text-dim, #9c93c2); }
.tz-calif-nombre small { font-weight: 600; }
.tz-calif-texto { margin: 2px 0 0; min-height: 22px; font-size: 15px; font-weight: 800; color: #ffd84a;
  text-shadow: 0 0 10px rgba(255,216,74,0.5); animation: tz-calif-texto .4s cubic-bezier(.34,1.56,.64,1) both; }
.tz-calif-texto:not(.is-visible) { color: var(--text-dim, #9c93c2); text-shadow: none; font-weight: 600; font-size: 13px; }
.tz-calif-comentario { position: relative; width: 100%; display: grid; grid-template-rows: 0fr; opacity: 0;
  transition: grid-template-rows .45s cubic-bezier(.34,1.3,.64,1), opacity .35s ease, margin .35s ease; }
.tz-calif-comentario.is-abierto { grid-template-rows: 1fr; opacity: 1; margin-top: 4px; }
.tz-calif-comentario > * { min-height: 0; }
.tz-calif-comentario textarea { width: 100%; box-sizing: border-box; resize: none; padding: 10px 12px; border-radius: 14px; font: inherit; font-size: 14px;
  color: #fff; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.14); outline: none;
  transition: border-color .25s ease, box-shadow .25s ease; }
.tz-calif-comentario textarea:focus { border-color: rgba(255,216,74,0.6); box-shadow: 0 0 14px rgba(255,216,74,0.25); }
.tz-calif-comentario small { position: absolute; right: 10px; bottom: 6px; font-size: 10px; color: var(--text-dim, #9c93c2); }
.tz-calif-error { margin: 0; font-size: 12.5px; color: #ff5470; }
.tz-calif-acciones { width: 100%; display: flex; gap: 8px; margin-top: 8px; }
.tz-calif-acciones button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 11px; border-radius: 14px;
  font-weight: 800; font-size: 14px; cursor: pointer; border: 0; transition: transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease, opacity .3s ease; }
.tz-calif-luego { color: var(--text-dim, #9c93c2); background: rgba(255,255,255,0.06); }
.tz-calif-enviar { color: #1a1300; background: linear-gradient(110deg, #ffd84a, #ff9500); box-shadow: 0 0 18px rgba(255,216,74,0.45); }
.tz-calif-enviar:disabled { opacity: .45; box-shadow: none; cursor: default; }
.tz-calif-acciones button:hover:not(:disabled) { transform: translateY(-2px); }
.tz-calif-gracias { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 0 6px; }
.tz-calif-gracias strong { font-size: 24px; color: #ffd84a; text-shadow: 0 0 16px rgba(255,216,74,0.6); animation: tz-calif-texto .5s .25s cubic-bezier(.34,1.56,.64,1) both; }
.tz-calif-gracias span { font-size: 13px; color: var(--text-dim, #9c93c2); animation: tz-calif-fade .5s .4s ease both; }
.tz-calif-explosion { position: relative; width: 120px; height: 110px; display: grid; place-items: center; }
.tz-calif-explosion svg { position: absolute; width: 16px; height: 16px; fill: #ffd84a; filter: drop-shadow(0 0 6px #ffd84a);
  animation: tz-calif-chispa 1.1s var(--d) cubic-bezier(.2,.8,.3,1) both; }
.tz-calif-explosion .tz-calif-estrella-grande { width: 64px; height: 64px; filter: drop-shadow(0 0 18px #ffd84a);
  animation: tz-calif-grande .7s cubic-bezier(.34,1.56,.64,1) both, tz-calif-flota 2.4s .7s ease-in-out infinite; }
@keyframes tz-calif-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes tz-calif-in { from { opacity: 0; transform: translateY(24px) scale(.9); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes tz-calif-flota { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes tz-calif-texto { from { opacity: 0; transform: translateY(6px) scale(.9); } to { opacity: 1; transform: none; } }
@keyframes tz-calif-chispa { 0% { opacity: 0; transform: rotate(var(--a)) translateY(0) scale(.3); } 30% { opacity: 1; }
  100% { opacity: 0; transform: rotate(var(--a)) translateY(calc(var(--r) * -1)) scale(1); } }
@keyframes tz-calif-grande { 0% { transform: scale(0) rotate(-90deg); } 100% { transform: scale(1) rotate(0); } }
`;
