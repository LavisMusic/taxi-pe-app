import { Navigate } from "react-router-dom";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";

// Guarda de /admin: exige haber entrado por /login-admin con el código
// maestro. No usa `usuarios.rol` porque el admin no tiene fila en esa
// tabla — es una puerta aparte, ver AdminLoginGate viejo vs.
// LoginAdminPage nuevo.
export default function RequireAdminMaster({ children }) {
  const { isAdminMaster } = useTaxiAuth();

  if (!isAdminMaster) return <Navigate to="/login-admin" replace />;

  return children;
}
