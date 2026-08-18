import { motion } from "framer-motion";
import ConductorImage from "./ConductorImage";
import { ESTADO_CONDUCTOR_ACTIVO, NIVEL_SERVICIO_ECONOMICO } from "../lib/taxiEnums";

// Tarjeta pública de un conductor — foto, nombre, estado, placa y
// descripción (recortada a 4 líneas, ver .tz-card-desc-clamp), con el
// glow de borde según su nivel_servicio (data-nivel, ver
// .tz-card[data-nivel] en Styles.jsx). ÚNICA fuente de verdad para
// este markup: HomePage (directorio público), la Vista Previa de
// ConductorPage (así el conductor ve EXACTAMENTE lo mismo que un
// pasajero, mismas proporciones/padding/glow, no una versión
// reinventada) y el header de ChatModal (que por eso NUNCA debe
// perder su color de categoría por el tema rosado del chat — ver
// ChatModal.jsx).
//
// `children` es un slot opcional para lo que cada caller quiera
// agregar debajo (ej. el botón "Contactar" en Home) — SOLO se muestra
// si `isLoggedIn` es true, la card lo decide acá adentro en vez de
// confiar en que cada caller se acuerde de envolverlo a mano.
//
// `isLoggedIn` (default FALSE — seguro por defecto): la tarjeta oculta
// ESTRICTAMENTE la Descripción y cualquier children (Contactar) salvo
// que el caller pase `isLoggedIn` explícito. Los 3 lugares que la usan
// tienen que decidir a propósito, nunca por default implícito:
//   - HomePage.jsx (público anónimo): isLoggedIn={esPasajero} — solo
//     true si hay sesión de Pasajero real.
//   - ConductorPage.jsx (Vista Previa): isLoggedIn (true fijo) — el
//     conductor viendo su PROPIA tarjeta siempre ve todo, aunque su
//     sesión sea de rol "conductor" y no "pasajero".
//   - ChatModal.jsx: isLoggedIn (true fijo) — a este modal solo se
//     llega habiendo una sesión de Pasajero ya validada más arriba.
//
// `motionProps` se reenvía tal cual al motion.div raíz — así HomePage
// puede pedir `layout` (animación de reordenamiento, ver
// nivelServicio.js) sin que ConductorPage/ChatModal (que no la
// necesitan) tengan que preocuparse por eso. `motion.div` sin ninguna
// prop de animación se comporta exactamente como un `div` normal, así
// que no hay costo por usarlo siempre acá.
export default function ConductorPublicCard({ conductor, isLoggedIn = false, children, ...motionProps }) {
  if (!conductor) return null;
  const activo = conductor.estado === ESTADO_CONDUCTOR_ACTIVO;

  return (
    <motion.div className="tz-card" data-nivel={conductor.nivel_servicio || NIVEL_SERVICIO_ECONOMICO} {...motionProps}>
      <div className="tz-card-row">
        <ConductorImage fotoUrl={conductor.foto_url} nombre={conductor.nombre} estado={conductor.estado} />
        <div className="tz-card-main">
          <div className="tz-card-top">
            <div className="tz-card-info">
              <h3 className="tz-card-name">{conductor.nombre}</h3>
            </div>
          </div>

          <div className="tz-card-bottom">
            <div className="tz-card-stockrow">
              <span className={`tz-tag ${activo ? "tz-tag-ok" : "tz-tag-warn"}`}>
                {activo ? "Libre" : "En carrera"}
              </span>
            </div>
            <div className="tz-card-priceqty">
              <div className="tz-price-block">
                <span className="tz-price-label">Placa</span>
                <span className="tz-price">{conductor.placa}</span>
              </div>
            </div>
          </div>

          {isLoggedIn && conductor.descripcion && <p className="tz-card-desc-clamp">{conductor.descripcion}</p>}

          {isLoggedIn && children}
        </div>
      </div>
    </motion.div>
  );
}
