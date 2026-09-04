import { CheckCircle2, AlertTriangle } from "lucide-react";

// Aviso chico y no-intrusivo en la parte superior de la pantalla, para
// el resultado de un login (éxito/fallido) — ver useAvisoTop.js para el
// timer que lo apaga solo. Puramente visual, no bloquea nada por
// detrás (a diferencia de un modal/alert()).
export default function AvisoTop({ aviso }) {
  if (!aviso) return null;
  return (
    <div className={`tz-aviso-top ${aviso.tipo === "error" ? "tz-aviso-top-error" : "tz-aviso-top-exito"}`} role="status">
      {aviso.tipo === "error" ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
      {aviso.texto}
    </div>
  );
}
