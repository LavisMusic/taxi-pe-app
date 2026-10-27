import { useEffect, useRef } from "react";
import { ArrowLeft, Pin, Bell, BellOff } from "lucide-react";
import VideoEnChat from "./VideoEnChat";
import TextoConEnlaces from "../TextoConEnlaces";
import logoTaxi from "../../assets/logo.webp";
import logoTonazo from "../../assets/logo-tonazo.webp";

// Piezas de los chats fijados "Taxi PE" y "Tonazo" (Mensajes): la fila de
// cada chat en una lista, el chat abierto (solo lectura) y el interruptor
// de avisos. Las usan MensajesModal (pasajero, recolector) y la bandeja
// del conductor. Los datos vienen de useMensajesPlataforma.
export const INFO_CANAL = {
  taxipe: { nombre: "Taxi PE", logo: logoTaxi },
  tonazo: { nombre: "Tonazo", logo: logoTonazo },
};

function horaCorta(iso) {
  const d = new Date(iso);
  const hoy = new Date();
  return d.toDateString() === hoy.toDateString()
    ? d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit" });
}

// `soloCanales`: limita los fijados que se muestran (al pasajero, solo
// "Taxi PE": en su Mensajes no aparece ningún negocio).
export function FilasChatsFijados({ canales, onAbrir, soloCanales = null }) {
  return Object.entries(INFO_CANAL)
    .filter(([canal]) => !soloCanales || soloCanales.includes(canal))
    .map(([canal, info]) => {
    const datos = canales[canal];
    const ultimo = datos?.ultimo;
    return (
      <li key={canal} className="tz-history-row tz-chatfijo-row">
        <button type="button" className="tz-chatfijo-btn" onClick={() => onAbrir(canal)}>
          <img src={info.logo} alt="" className="tz-chatfijo-logo" />
          <span className="tz-chatfijo-texto">
            <span className="tz-chatfijo-nombre">
              {info.nombre} <Pin size={11} className="tz-chatfijo-pin" aria-label="Fijado" />
            </span>
            <span className="tz-chatfijo-preview">
              {ultimo ? ultimo.titulo || ultimo.mensaje || "📢 Anuncio" : "Sin mensajes todavía"}
            </span>
          </span>
          <span className="tz-chatfijo-meta">
            {ultimo && <span className="tz-chatfijo-hora">{horaCorta(ultimo.programado_para)}</span>}
            {datos?.noLeidos > 0 && <span className="tz-chatfijo-badge">{datos.noLeidos > 9 ? "+9" : datos.noLeidos}</span>}
          </span>
        </button>
      </li>
    );
  });
}

export function ChatFijadoAbierto({ canal, datos, onVolver, onLeido }) {
  const info = INFO_CANAL[canal];
  const finRef = useRef(null);
  const cantidad = datos?.mensajes.length ?? 0;

  useEffect(() => {
    onLeido(canal);
    finRef.current?.scrollIntoView({ block: "end" });
    // Se marca leído al abrirlo y cada vez que llega un mensaje con el chat abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canal, cantidad]);

  return (
    <div className="tz-chatfijo-abierto">
      <div className="tz-chatfijo-cabecera">
        <button type="button" className="tz-chatfijo-volver" onClick={onVolver} aria-label="Volver a los chats">
          <ArrowLeft size={16} />
        </button>
        <img src={info.logo} alt="" className="tz-chatfijo-logo" />
        <span>
          <strong>{info.nombre}</strong>
          <small>Mensajes oficiales · solo lectura</small>
        </span>
      </div>
      <div className="tz-chatfijo-mensajes">
        {cantidad === 0 ? (
          <p className="tz-method-history-empty">Todavía no hay mensajes.</p>
        ) : (
          datos.mensajes.map((m) => (
            <div key={m.id} className="tz-chatfijo-burbuja">
              {/* Anuncio: su imagen o video, además del texto. */}
              {m.imagen_url && <img src={m.imagen_url} alt="" className="tz-chatfijo-media" />}
              {m.video_url && <VideoEnChat url={m.video_url} titulo={m.titulo} />}
              {m.titulo && <strong>{m.titulo}</strong>}
              {m.mensaje && (
                <p>
                  <TextoConEnlaces texto={m.mensaje} />
                </p>
              )}
              <span>
                {new Date(m.programado_para).toLocaleString("es-PE", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))
        )}
        <div ref={finRef} />
      </div>
    </div>
  );
}

export function InterruptorAvisos({ activos, onCambiar }) {
  return (
    <div className="tz-chatfijo-avisos-fila">
    <button
      type="button"
      className={`tz-chatfijo-avisos ${activos ? "is-activo" : ""}`}
      onClick={() => onCambiar(!activos)}
      aria-pressed={activos}
      title={activos ? "Desactivar avisos y sonido" : "Activar avisos y sonido"}
    >
      {activos ? <Bell size={13} /> : <BellOff size={13} />}
      {activos ? "Avisos activados" : "Avisos desactivados"}
    </button>
    </div>
  );
}
