import { Headset } from "lucide-react";
import { useContactoPlataforma } from "../hooks/useContactoPlataforma";
import { buildWhatsappLink } from "../lib/whatsapp";

// Botón "Soporte" de la cabecera (pasajero, conductor, recolector):
// abre WhatsApp con el número de soporte que el super admin configura
// en Caja Tonazo. Si todavía no hay número cargado, no se muestra.
export default function BotonSoporte({ mensaje = "Hola, necesito ayuda con Taxi-PE." }) {
  const { whatsapp_soporte: numero } = useContactoPlataforma();
  const link = buildWhatsappLink(numero, mensaje);
  if (!link) return null;

  return (
    <button
      type="button"
      className="tz-header-btn"
      onClick={() => window.open(link, "_blank", "noopener")}
      aria-label="Soporte por WhatsApp"
      title="Soporte"
    >
      <Headset size={19} />
      <span className="tz-header-btn-label">Soporte</span>
    </button>
  );
}
