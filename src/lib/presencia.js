// Nombres de los canales de Presencia (Supabase Realtime Presence,
// distinto de `subscribeTable` — ese escucha cambios de FILAS en una
// tabla, esto escucha quién tiene una CONEXIÓN abierta ahora mismo, sin
// tocar la base para nada). Uno por rol: cada Pasajero/Conductor
// "trackea" su propia sesión acá (ver usePasajeroPresenciaTrack.js /
// useConductorPresenciaTrack.js) y quien esté mirando el visor de
// conectados (Admin, y ahora también el propio Conductor para ver
// pasajeros) solo escucha (ver usePasajerosConectados.js /
// useConductoresConectados.js) — nadie más necesita tocar estos
// strings, por eso viven centralizados acá.
export const CANAL_PRESENCIA_PASAJEROS = "presencia-pasajeros";
export const CANAL_PRESENCIA_CONDUCTORES = "presencia-conductores";
