import {
  ESTADO_CONDUCTOR_RECHAZADO,
  ESTADO_CUENTA_PENDIENTE,
  ESTADO_CUENTA_RECHAZADO,
  ESTADO_VERIFICACION_EN_REVISION,
  ESTADO_VERIFICACION_TEMPORAL,
} from "./taxiEnums";

// Qué cae en la pestaña "Registro" del Centro de Peticiones (y en el
// número del botón del Admin). Mismo criterio en los dos lugares.

// Conductores por aprobar: sin aprobar, no rechazados y que ya mandaron su
// verificación — una cuenta del registro exprés que todavía es 'temporal'
// ya tiene su fila de conductor (puede trabajar), pero no es una petición.
export function conductoresPorRevisar(conductores, usuarios) {
  const temporales = new Set(
    usuarios
      .filter((u) => u.rol === "conductor" && u.estado_verificacion === ESTADO_VERIFICACION_TEMPORAL)
      .map((u) => u.telefono)
  );
  return conductores.filter(
    (c) => !c.aprobado && c.estado !== ESTADO_CONDUCTOR_RECHAZADO && !temporales.has(c.telefono)
  );
}

// Recolectores por aprobar: los que mandaron su verificación (pueden
// seguir usando la app mientras tanto) y los antiguos 'pendiente'.
export function recolectoresPorRevisar(usuarios) {
  return usuarios.filter(
    (u) =>
      u.rol === "recolector" &&
      u.estado_cuenta !== ESTADO_CUENTA_RECHAZADO &&
      (u.estado_verificacion === ESTADO_VERIFICACION_EN_REVISION ||
        (u.estado_cuenta === ESTADO_CUENTA_PENDIENTE && u.estado_verificacion !== ESTADO_VERIFICACION_TEMPORAL))
  );
}
