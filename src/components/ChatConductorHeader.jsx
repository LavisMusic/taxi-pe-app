import { ESTADO_CONDUCTOR_ACTIVO, NIVEL_SERVICIO_ECONOMICO } from "../lib/taxiEnums";

// Cabecera COMPACTA del conductor dentro del Chat — a propósito NO es
// ConductorPublicCard: acá se pidió explícitamente sacar la foto y la
// descripción (le comían demasiado espacio vertical al chat, que
// además ahora tiene que quedar fijo arriba mientras solo los mensajes
// scrollean, ver .tz-chat-modal-shell en Styles.jsx). Solo
// Nombre/Placa/Estado, con el mismo glow por categoría que el resto
// de las tarjetas (data-nivel).
export default function ChatConductorHeader({ conductor }) {
  if (!conductor) return null;
  const activo = conductor.estado === ESTADO_CONDUCTOR_ACTIVO;

  return (
    <div className="tz-chat-conductor-compact" data-nivel={conductor.nivel_servicio || NIVEL_SERVICIO_ECONOMICO}>
      <span className="tz-chat-conductor-compact-name">{conductor.nombre}</span>
      <span className="tz-chat-conductor-compact-meta">
        <span className="tz-price" style={{ fontSize: 13 }}>
          {conductor.placa}
        </span>
        <span className={`tz-tag ${activo ? "tz-tag-ok" : "tz-tag-warn"}`}>{activo ? "Libre" : "En carrera"}</span>
      </span>
    </div>
  );
}
