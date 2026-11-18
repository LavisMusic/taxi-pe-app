import { forwardRef } from "react";
import { UserRound } from "lucide-react";

// Fila de un chat en Mensajes — MISMO archivo en Taxi-PE y Caja
// (src/components/mensajes/FilaChat.jsx). La usan todos los roles: foto (o
// sticker), nombre con estrellas, etiqueta de estado, último mensaje, hora,
// contador rojo de no leídos (+9) y el pulso verde.
//   `activo`: chat en curso (viaje, pedido o reparto) — borde verde en
//             movimiento.
//   `pulso`:  relleno que late en verde unos segundos (al ver la lista).
//   `estado`: { texto, enLinea } — etiqueta junto al nombre.
//   `children`: lo que va debajo de la fila (ej. el chat del repartidor de
//               un pedido).
const FilaChat = forwardRef(function FilaChat(
  {
    foto = null,
    icono: Icono = UserRound,
    nombre,
    extra = null,
    estrellas = null,
    estado = null,
    preview = null,
    hora = null,
    noLeidos = 0,
    activo = false,
    cerrado = false,
    pulso = false,
    className = "",
    onClick,
    children = null,
  },
  ref
) {
  return (
    <li
      ref={ref}
      className={`tz-history-row tz-chatfijo-row tz-fila-chat ${activo ? "is-activo" : ""} ${cerrado ? "is-cerrado" : ""} ${className}`}
    >
      {pulso && <span className="tz-chatped-pulso" aria-hidden="true" />}
      <button type="button" className="tz-chatfijo-btn" onClick={onClick}>
        {foto ? (
          <img src={foto} alt="" className="tz-chat-cara" />
        ) : (
          <span className="tz-chat-sticker">
            <Icono size={26} />
          </span>
        )}
        <span className="tz-chatfijo-texto">
          <span className="tz-chatfijo-nombre">
            <span className="tz-fila-chat-nombre">{nombre}</span>
            {extra}
            {estrellas && <span className="tz-fila-chat-estrellas">{estrellas}</span>}
            {estado?.texto && <span className={`tz-chatneg-estado ${estado.enLinea ? "is-en-linea" : ""}`}>{estado.texto}</span>}
          </span>
          {preview != null && <span className="tz-chatfijo-preview">{preview}</span>}
        </span>
        <span className="tz-chatfijo-meta">
          {hora && <span className="tz-chatfijo-hora">{hora}</span>}
          {noLeidos > 0 && <span className="tz-chatfijo-badge">{noLeidos > 9 ? "+9" : noLeidos}</span>}
        </span>
      </button>
      {children}
    </li>
  );
});

export default FilaChat;
