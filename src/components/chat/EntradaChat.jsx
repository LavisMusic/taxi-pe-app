import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Send, Mic, ImagePlus, Camera, Loader2, Trash2 } from "lucide-react";
import { subirAdjunto, minSeg } from "../../lib/adjuntosChat";
import AuraVoz from "./AuraVoz";

// Campo de escribir de los chats, con fotos y notas de voz:
//   - "+" dentro del campo, a la derecha: despliega "Subir foto" y "Tomar
//     foto" (abre la cámara del celular).
//   - A la derecha, el micrófono; apenas se activa el campo (foco o texto)
//     se convierte en el avión de papel de enviar.
//   - Mantener presionado el micrófono graba: en el medio del chat aparece
//     un aura arcoíris (AuraVoz) que se mueve con la voz, con el contador
//     al centro. Soltar envía; deslizar hacia afuera cancela.
//     Máximo 60 s (al llegar, se envía solo).
// `onEnviar(texto)` → Promise ({ error } opcional): el texto o, para una
// foto o un audio, el mensaje ya codificado (lib/adjuntosChat.js).
// `onEscribir()`: para el "escribiendo…".
// `validar(texto)` → mensaje de aviso o null: con aviso no se envía (ej.
// el chat del viaje no deja mandar números de teléfono).
const MAX_SEG = 60;
const DISTANCIA_CANCELAR = 90; // px desde donde se empezó a grabar

export default function EntradaChat({ onEnviar, onEscribir, validar = null, deshabilitado = false, placeholder = "Escribe un mensaje…", autoFocus = true }) {
  const [texto, setTexto] = useState("");
  const [foco, setFoco] = useState(false);
  const [menu, setMenu] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");
  const [grabando, setGrabando] = useState(null); // { cancelar: bool }
  const [segundos, setSegundos] = useState(0);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const camaraRef = useRef(null);
  const grab = useRef(null); // { recorder, stream, ctx, analyser, inicio, partes, x, y, cancelar, raf, tope }

  const activo = foco || texto.trim().length > 0;
  const aviso = validar && texto.trim() ? validar(texto) : null;

  const enviarTexto = async () => {
    const t = texto.trim();
    if (!t || deshabilitado || aviso) return;
    setTexto("");
    setError("");
    const r = await onEnviar(t);
    if (r?.error) setTexto((x) => x || t);
    inputRef.current?.focus();
  };

  const enviarAdjunto = async (adjunto) => {
    setSubiendo(true);
    setError("");
    try {
      const codificado = await subirAdjunto(adjunto);
      const r = await onEnviar(codificado);
      if (r?.error) setError("No se pudo enviar. Intenta de nuevo.");
    } catch {
      setError(adjunto.tipo === "foto" ? "No se pudo subir la foto." : "No se pudo subir la nota de voz.");
    } finally {
      setSubiendo(false);
    }
  };

  // ---- Nota de voz ----
  const pararTodo = () => {
    const g = grab.current;
    if (!g) return;
    clearInterval(g.reloj);
    g.stream?.getTracks().forEach((t) => t.stop());
    g.ctx?.close().catch(() => {});
  };

  // El aura lee el analizador del micrófono en cada cuadro.
  const analizador = useCallback(() => grab.current?.analyser ?? null, []);

  const empezarGrabacion = async (e) => {
    if (deshabilitado || subiendo || grab.current) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const x = e.clientX;
    const y = e.clientY;
    grab.current = { x, y, cancelar: false, partes: [], pendiente: true };
    setError("");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      grab.current = null;
      setError("Permite el micrófono para grabar notas de voz.");
      return;
    }
    // Soltó antes de que el navegador diera el micrófono.
    if (!grab.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const tipo = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => window.MediaRecorder?.isTypeSupported?.(t));
    const recorder = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
    const g = grab.current;
    Object.assign(g, { recorder, stream, inicio: Date.now(), pendiente: false });
    recorder.ondataavailable = (ev) => ev.data.size && g.partes.push(ev.data);
    recorder.onstop = () => {
      const dur = (Date.now() - g.inicio) / 1000;
      const blob = new Blob(g.partes, { type: recorder.mimeType || "audio/webm" });
      pararTodo();
      grab.current = null;
      setGrabando(null);
      if (!g.cancelar && dur >= 1) enviarAdjunto({ tipo: "audio", blob, duracion: dur });
    };
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.7;
      ctx.createMediaStreamSource(stream).connect(analyser);
      Object.assign(g, { ctx, analyser });
    } catch {
      // sin ondas, igual graba
    }
    recorder.start();
    setSegundos(0);
    setGrabando({ cancelar: false });
    g.reloj = setInterval(() => {
      const s = (Date.now() - g.inicio) / 1000;
      setSegundos(s);
      if (s >= MAX_SEG && g.recorder.state === "recording") g.recorder.stop();
    }, 200);
  };

  const moverGrabacion = (e) => {
    const g = grab.current;
    if (!g) return;
    const lejos = Math.hypot(e.clientX - g.x, e.clientY - g.y) > DISTANCIA_CANCELAR;
    if (lejos !== g.cancelar) {
      g.cancelar = lejos;
      setGrabando((v) => (v ? { cancelar: lejos } : v));
    }
  };

  const soltarGrabacion = () => {
    const g = grab.current;
    if (!g) return;
    if (g.pendiente) {
      // Todavía pidiendo el micrófono: se cancela.
      grab.current = null;
      return;
    }
    if (g.recorder?.state === "recording") g.recorder.stop();
  };

  useEffect(() => () => pararTodo(), []);

  const elegirFoto = (file) => {
    setMenu(false);
    if (file) enviarAdjunto({ tipo: "foto", blob: file });
  };

  return (
    <div className="tz-entrada">
      <div className="tz-entrada-campo">
        <input
          ref={inputRef}
          className="tz-text-input tz-entrada-input"
          placeholder={placeholder}
          value={texto}
          autoFocus={autoFocus}
          disabled={deshabilitado}
          onFocus={() => setFoco(true)}
          onBlur={() => setFoco(false)}
          onChange={(e) => {
            setTexto(e.target.value);
            if (e.target.value.trim()) onEscribir?.();
          }}
          onKeyDown={(e) => e.key === "Enter" && enviarTexto()}
        />
        <button
          type="button"
          className={`tz-entrada-mas ${menu ? "is-abierto" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenu((v) => !v)}
          aria-label={menu ? "Cerrar adjuntos" : "Adjuntar"}
          disabled={deshabilitado || subiendo}
        >
          <Plus size={18} />
        </button>
        {menu && (
          <div className="tz-entrada-menu">
            <button type="button" className="tz-entrada-menu-btn" onClick={() => fileRef.current?.click()}>
              <ImagePlus size={17} /> Subir foto
            </button>
            <button type="button" className="tz-entrada-menu-btn" onClick={() => camaraRef.current?.click()}>
              <Camera size={17} /> Tomar foto
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            elegirFoto(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={camaraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            elegirFoto(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {subiendo ? (
        <span className="tz-entrada-accion is-subiendo">
          <Loader2 size={18} className="tz-spin" />
        </span>
      ) : activo ? (
        <button
          key="enviar"
          type="button"
          className="tz-entrada-accion is-enviar"
          onMouseDown={(e) => e.preventDefault()}
          onClick={enviarTexto}
          disabled={deshabilitado || !texto.trim() || !!aviso}
          aria-label="Enviar mensaje"
        >
          <Send size={18} />
        </button>
      ) : (
        <button
          key="mic"
          type="button"
          className={`tz-entrada-accion is-mic ${grabando ? "is-grabando" : ""}`}
          onPointerDown={empezarGrabacion}
          onPointerMove={moverGrabacion}
          onPointerUp={soltarGrabacion}
          onPointerCancel={soltarGrabacion}
          onContextMenu={(e) => e.preventDefault()}
          disabled={deshabilitado}
          aria-label="Mantén presionado para grabar una nota de voz"
          title="Mantén presionado para grabar"
        >
          <Mic size={19} />
        </button>
      )}

      {(aviso || error) && <p className="tz-entrada-error">{aviso || error}</p>}

      {grabando &&
        createPortal(
          <div className={`tz-grabacion ${grabando.cancelar ? "is-cancelar" : ""}`} aria-live="polite">
            <AuraVoz analizador={analizador} cancelar={grabando.cancelar}>
              {grabando.cancelar ? <Trash2 size={22} /> : <span className="tz-grabacion-tiempo">{minSeg(segundos)}</span>}
            </AuraVoz>
            <p className="tz-grabacion-ayuda">{grabando.cancelar ? "Suelta para cancelar" : "Suelta para enviar · desliza afuera para cancelar"}</p>
          </div>,
          document.body
        )}
    </div>
  );
}
