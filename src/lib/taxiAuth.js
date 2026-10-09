// Constantes y helpers del nuevo login multi-rol de TaxiP.
//
// A diferencia del login viejo (lib/auth.js, Supabase Auth con
// dummy-email), acá NO hay sesión de Supabase Auth: el "usuario
// logueado" es directamente la fila de la tabla `usuarios` que matcheó
// dni+telefono+pin, persistida a mano en storage. RLS para lecturas
// futuras deberá basarse en policies públicas/anon acotadas (o en una
// Edge Function, como ya existe el patrón en supabase/functions/) — no
// en auth.uid(), que acá no existe.

// El código del Admin ya NO vive acá (estaba en el JavaScript que
// descarga cualquiera): se comprueba en la base (taxi_admin_login), que
// devuelve un token de sesión. Lo que se guarda en el navegador es ese
// token, y las funciones de Admin de la base lo piden.

export const TAXI_SESSION_KEY = "taxipe_usuario";
export const TAXI_ADMIN_KEY = "taxipe_admin_master";

export const ROLE_HOME_ROUTES = {
  recolector: "/recolector",
  conductor: "/conductor",
  pasajero: "/",
};

export function routeForRole(rol) {
  return ROLE_HOME_ROUTES[rol] ?? "/";
}

// Token de la sesión de Admin guardado en este navegador (o null).
export function leerTokenAdmin() {
  try {
    return window.localStorage.getItem(TAXI_ADMIN_KEY) || window.sessionStorage.getItem(TAXI_ADMIN_KEY) || null;
  } catch {
    return null;
  }
}
