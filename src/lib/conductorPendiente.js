import { ESTADO_CONDUCTOR_RECHAZADO, ESTADO_VERIFICACION_EN_REVISION } from "./taxiEnums";

// "Pendiente de revisión" para el Centro de Peticiones — dos casos que
// no se excluyen entre sí:
//   1) Alta directa en `conductores` sin cuenta de login revisada
//      todavía (Recolector Registro Rápido, alta inline del Admin con
//      aprobado=false) — se detecta por `aprobado`, como siempre.
//   2) Conductor del registro exprés que YA mandó su verificación
//      completa (usuarios.estado_verificacion === 'en_revision') pero
//      sigue con `conductores.aprobado:true` A PROPÓSITO — bug
//      reportado: "el conductor pierde acceso a la app al enviar su
//      solicitud de verificación", ver useConductorTemporal.js
//      `verificarCuenta` (ya no pisa `aprobado` para no cortarle la
//      visibilidad/operación mientras el Admin revisa). Por eso este
//      caso se detecta por el estado de VERIFICACIÓN, no por
//      `aprobado` — usado tanto por PeticionesModal.jsx (para listar)
//      como por AdminDashboardPage.jsx (para el badge numérico), así
//      no se duplica el criterio en dos lugares que podrían desalinearse.
export function esConductorPendienteDeRevision(conductor, usuarioPorTelefono) {
  const usuario = usuarioPorTelefono?.get(conductor.telefono);
  const enRevision = usuario?.estado_verificacion === ESTADO_VERIFICACION_EN_REVISION;
  return enRevision || (!conductor.aprobado && conductor.estado !== ESTADO_CONDUCTOR_RECHAZADO);
}

export function buildUsuarioPorTelefono(usuarios) {
  const map = new Map();
  for (const u of usuarios) {
    if (u.telefono) map.set(u.telefono, u);
  }
  return map;
}
