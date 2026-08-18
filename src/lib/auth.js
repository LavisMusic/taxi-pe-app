// Dummy-email helpers para el login por Celular+PIN (clientes) y por
// clave secreta (admin), sin exponer nunca un campo de correo en la UI.

export const ADMIN_DUMMY_EMAIL = "admin@tonazo.com";

export function celularToDummyEmail(celular) {
  const digits = String(celular || "").replace(/\D/g, "");
  return `${digits}@tonazo.app`;
}

export function usuarioToDummyEmail(usuario) {
  const clean = String(usuario || "")
    .trim()
    .toLowerCase();
  return `${clean}@tonazo.staff`;
}
