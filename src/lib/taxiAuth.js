// Constantes y helpers del nuevo login multi-rol de TaxiP.
//
// A diferencia del login viejo (lib/auth.js, Supabase Auth con
// dummy-email), acá NO hay sesión de Supabase Auth: el "usuario
// logueado" es directamente la fila de la tabla `usuarios` que matcheó
// dni+telefono+pin, persistida a mano en storage. RLS para lecturas
// futuras deberá basarse en policies públicas/anon acotadas (o en una
// Edge Function, como ya existe el patrón en supabase/functions/) — no
// en auth.uid(), que acá no existe.

export const ADMIN_MASTER_CODE = "745745";

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
