import { useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { leerAdjunto } from "../../lib/adjuntosChat";
import NotaDeVoz from "./NotaDeVoz";

// Contenido de un mensaje de chat: si es una foto o una nota de voz
// (lib/adjuntosChat.js) la muestra; si no, `children` (el texto como ya lo
// pintaba cada chat). La foto se abre en grande con botón para descargarla:
// todo el chat se borra a las 24 h.
// `claseBurbuja`: las clases de la burbuja de ese chat — la nota de voz
// toma ese color (el del tema) sin ir dentro del cuadro del mensaje.
export default function AdjuntoMensaje({ texto, children, claseBurbuja = "" }) {
  const adjunto = leerAdjunto(texto);
  const [abierta, setAbierta] = useState(false);
  const [bajando, setBajando] = useState(false);
  if (!adjunto) return children;

  if (adjunto.tipo === "audio") {
    return <NotaDeVoz url={adjunto.url} duracion={adjunto.duracion} claseBurbuja={claseBurbuja} />;
  }

  const descargar = async () => {
    setBajando(true);
    try {
      const r = await fetch(adjunto.url);
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `foto-chat-${Date.now()}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch {
      window.open(adjunto.url, "_blank", "noopener");
    } finally {
      setBajando(false);
    }
  };

  return (
    <>
      <button type="button" className="tz-adjunto-foto" onClick={() => setAbierta(true)} aria-label="Ver foto">
        <img src={adjunto.url} alt="" loading="lazy" />
      </button>
      {abierta &&
        createPortal(
          <div className="tz-adjunto-visor" onClick={() => setAbierta(false)}>
            <img src={adjunto.url} alt="" onClick={(e) => e.stopPropagation()} />
            <div className="tz-adjunto-visor-acciones" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={descargar} disabled={bajando}>
                <Download size={17} /> {bajando ? "Descargando…" : "Descargar"}
              </button>
              <button type="button" onClick={() => setAbierta(false)} aria-label="Cerrar">
                <X size={17} />
              </button>
            </div>
            <p className="tz-adjunto-visor-nota">Este chat se borra a las 24 horas: descarga la foto si la necesitas.</p>
          </div>,
          document.body
        )}
    </>
  );
}
