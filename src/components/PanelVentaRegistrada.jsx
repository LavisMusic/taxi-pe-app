import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Copy, Loader2, MessageCircle, Printer } from "lucide-react";
import TicketBoleta from "./TicketBoleta";
import { imprimirBoleta, copiarBoletaAlPortapapeles } from "../lib/boleta";
import { buildWhatsappLink } from "../lib/whatsapp";

// Desplegable inferior "venta registrada" — el mismo que sale en la caja
// de los negocios al cobrar (barra .tz-submitbar): Imprimir boleta,
// Enviar resumen por WhatsApp, Enviar boleta por WhatsApp (abre el chat
// del número registrado) y Copiar boleta (para pegarla en ese chat).
// Lo usan el admin (gestor ⚡ del conductor) y el recolector al
// registrar una Recarga rápida, y "Boleta" en los Pagos del gestor.
//   venta: { mensaje, whatsapp, resumen, boleta: { orden, cliente,
//            productos, totales } } — null lo cierra.
export default function PanelVentaRegistrada({ venta, onCerrar }) {
  const ticketRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [copiando, setCopiando] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    if (!venta) return undefined;
    setError("");
    setAviso("");
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, [venta]);

  if (!venta) return null;

  const cerrar = () => {
    setVisible(false);
    setTimeout(() => onCerrar?.(), 450);
  };

  const linkResumen = buildWhatsappLink(venta.whatsapp, venta.resumen);
  const linkBoleta = buildWhatsappLink(venta.whatsapp, "Aquí está tu boleta");
  const sinNumero = "No tiene un número de teléfono registrado.";

  const imprimir = () => {
    setError("");
    imprimirBoleta(ticketRef).catch((err) => setError(err?.message || "No se pudo imprimir la boleta."));
  };

  const copiar = async () => {
    setError("");
    setAviso("");
    setCopiando(true);
    try {
      const res = await copiarBoletaAlPortapapeles(ticketRef, { compartir: true });
      if (res?.copiado) setAviso("¡Boleta copiada! Abre el chat y pégala.");
      else if (res?.descargado) setAviso("Este navegador no deja copiar imágenes: se descargó la boleta para adjuntarla.");
    } catch (err) {
      setError(err?.message || "No se pudo copiar la boleta.");
    } finally {
      setCopiando(false);
    }
  };

  return createPortal(
    <div
      className={`tz-submitbar tz-panel-venta ${visible ? "tz-submitbar-visible" : "tz-submitbar-hidden"}`}
      role="dialog"
      aria-label="Venta registrada"
    >
      <button type="button" className="tz-submitbar-collapse" onClick={cerrar} aria-label="Cerrar" title="Cerrar">
        <ChevronDown size={16} />
      </button>
      <div className="tz-submitbar-content">
        <p className="tz-success tz-submitbar-message">
          <Check size={16} /> {venta.mensaje}
        </p>
        <button type="button" className="tz-whatsapp-send-btn tz-print-boleta-btn" onClick={imprimir}>
          <Printer size={15} /> Imprimir Boleta
        </button>
        {linkResumen ? (
          <a href={linkResumen} target="_blank" rel="noreferrer" className="tz-whatsapp-send-btn">
            <MessageCircle size={15} /> Enviar resumen por WhatsApp
          </a>
        ) : (
          <button type="button" className="tz-whatsapp-send-btn" onClick={() => setError(sinNumero)}>
            <MessageCircle size={15} /> Enviar resumen por WhatsApp
          </button>
        )}
        <button
          type="button"
          className="tz-whatsapp-send-btn tz-whatsapp-send-btn-solid"
          onClick={() => (linkBoleta ? window.open(linkBoleta, "_blank") : setError(sinNumero))}
        >
          <MessageCircle size={15} /> Enviar Boleta por WhatsApp
        </button>
        <button type="button" className="tz-whatsapp-send-btn" onClick={copiar} disabled={copiando}>
          {copiando ? <Loader2 size={15} className="tz-spin" /> : <Copy size={15} />} {copiando ? "Copiando…" : "Copiar Boleta"}
        </button>
        {aviso && <p className="tz-sa-negocio-admin-ok" style={{ margin: 0 }}>{aviso}</p>}
        {error && <p className="tz-error" style={{ margin: 0 }}>{error}</p>}

        {/* Boleta oculta: solo existe para dibujarla (imprimir / copiar). */}
        <div ref={ticketRef} style={{ position: "absolute", left: -9999, top: 0 }}>
          <TicketBoleta {...venta.boleta} />
        </div>
      </div>
    </div>,
    document.body
  );
}
