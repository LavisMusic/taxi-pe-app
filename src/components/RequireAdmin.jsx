import { Loader2 } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import AdminLoginGate from "./AdminLoginGate";
import Styles from "./Styles";

// Guarda de ruta para /admin: exige una sesión real de Supabase Auth
// con profiles.role === 'admin' o 'cajero' (no solo "hay sesión" — un
// cliente logueado con su Celular+PIN NO debe poder entrar aquí).
// App.jsx recibe ambos roles y decide internamente qué mostrar/ocultar
// — no hay dos componentes separados, para no duplicar toda la lógica
// de ventas/stock/fiados/gastos entre un panel de admin y uno de cajero.
export default function RequireAdmin({ children }) {
  const { session, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="tz-root tz-loading">
        <Styles />
        <Loader2 className="tz-spin" size={28} />
        <p>Cargando...</p>
      </div>
    );
  }

  if (!session || (role !== "admin" && role !== "cajero")) {
    return <AdminLoginGate />;
  }

  return children;
}
