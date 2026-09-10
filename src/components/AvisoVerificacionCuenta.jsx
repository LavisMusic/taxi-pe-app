import { useState } from "react";
import { ShieldAlert, X } from "lucide-react";

// Aviso fijo de "cuenta temporal sin verificar" (Conductor y Pasajero,
// ver ConductorPage.jsx/HomePage.jsx) — a diferencia de AvisoTop.jsx
// (un toast que se apaga solo a los pocos segundos), este NO se cierra
// solo: se queda hasta que el usuario lo cierra a mano con la X. Ese
// cierre es estado de React, NO localStorage — a propósito, para que
// vuelva a aparecer la próxima vez que entra a la app (nueva sesión o
// F5) mientras el plazo de verificación siga corriendo, en vez de que
// lo cierre una vez y se olvide para siempre.
//
// `variante="peligro"` (pedido: avisar al conductor en tiempo real
// cuando el Admin lo rechaza) reusa el mismo esqueleto en rojo en vez
// de naranja — ver ConductorPage.jsx, donde se muestra mientras
// `conductor.estado === 'rechazado'` (derivado directo de la fila, sin
// localStorage: como ese estado se limpia solo al reenviar la
// verificación, no hace falta rastrear si "ya se vio" — simplemente
// deja de existir la condición que lo muestra).
export default function AvisoVerificacionCuenta({
  mensaje,
  textoBoton = "Verificar cuenta",
  onVerificar,
  variante = "aviso",
}) {
  const [cerrado, setCerrado] = useState(false);
  if (cerrado) return null;

  const claseVariante = variante === "peligro" ? " tz-aviso-verificacion-peligro" : "";

  return (
    <div className={`tz-aviso-verificacion${claseVariante}`}>
      <button
        type="button"
        className="tz-aviso-verificacion-close"
        onClick={() => setCerrado(true)}
        aria-label="Cerrar aviso"
      >
        <X size={15} />
      </button>
      <div className="tz-aviso-verificacion-body">
        <ShieldAlert size={18} />
        <p>{mensaje}</p>
      </div>
      <button type="button" className="tz-scan-btn tz-aviso-verificacion-btn" onClick={onVerificar}>
        {textoBoton}
      </button>
    </div>
  );
}
