import { useState } from "react";
import { Headset } from "lucide-react";
import { useContactoPlataforma } from "../hooks/useContactoPlataforma";
import { buildWhatsappLink } from "../lib/whatsapp";
import SoporteModal from "./SoporteModal";

// Botón "Soporte" de la cabecera (pasajero, conductor, recolector): abre
// el modal de Soporte — conversar por WhatsApp con el número que el super
// admin configura en Caja Tonazo, bloqueo de emergencia y recuperar
// cuenta (SoporteModal.jsx). Se muestra siempre: el bloqueo y la
// recuperación no dependen de que haya un número de soporte cargado.
export default function BotonSoporte({ mensaje = "Hola, necesito ayuda con Taxi-PE." }) {
  const { whatsapp_soporte: numero } = useContactoPlataforma();
  const link = buildWhatsappLink(numero, mensaje);
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button
        type="button"
        className="tz-header-btn"
        onClick={() => setAbierto(true)}
        aria-label="Soporte"
        title="Soporte"
      >
        <Headset size={19} />
        <span className="tz-header-btn-label">Soporte</span>
      </button>
      {abierto && <SoporteModal linkSoporte={link} onClose={() => setAbierto(false)} />}
    </>
  );
}
