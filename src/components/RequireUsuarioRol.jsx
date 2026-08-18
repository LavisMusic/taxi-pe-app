import { Navigate } from "react-router-dom";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { ESTADO_CUENTA_PENDIENTE } from "../lib/taxiEnums";

// Guarda genérica para /recolector y /conductor: exige una fila de
// `usuarios` en sesión con el rol exacto que pide la ruta — un
// conductor logueado no debe poder abrir /recolector cambiando la URL
// a mano, ni viceversa.
//
// Un recolector auto-registrado (usuarios.estado_cuenta='pendiente',
// ver RegistroRecolectorModal.jsx) puede loguearse — el PIN diferido lo
// permite — pero no puede ENTRAR a cobrar hasta que el Admin lo apruebe
// desde el Centro de Peticiones. Los conductores no tienen este
// bloqueo acá: su gate real es `conductores.aprobado`, que ya filtra
// del lado público (useConductoresPublicos) sin necesidad de sacarlos
// de su propia pantalla /conductor.
export default function RequireUsuarioRol({ rol, children }) {
  const { usuario } = useTaxiAuth();

  if (!usuario || usuario.rol !== rol) return <Navigate to="/login" replace />;
  if (rol === "recolector" && usuario.estado_cuenta === ESTADO_CUENTA_PENDIENTE) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
