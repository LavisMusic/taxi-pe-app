import { ArrowLeft, BarChart3 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Styles from "../components/Styles";
import CuentasVerificadas from "../components/admin/CuentasVerificadas";
import logo from "../assets/logo.webp";

/* /admin/dashboard (fase 5): el dashboard del admin en su propia página
   (protegida igual que /admin). Por ahora: cuentas verificadas por rol
   (5a); después, el resto del dashboard de Taxi-PE (5c). */
export default function AdminDashboardMetricasPage() {
  const navigate = useNavigate();
  return (
    <div className="tz-root tz-dashboard-pagina">
      <Styles />
      <header className="tz-dashboard-cabecera">
        <button type="button" className="tz-dashboard-volver" onClick={() => navigate("/admin")}>
          <ArrowLeft size={16} /> Volver al panel
        </button>
        <img src={logo} alt="Taxi PE" className="tz-dashboard-logo" />
        <h1 className="tz-dashboard-titulo">
          <BarChart3 size={20} /> Dashboard
        </h1>
      </header>
      <main className="tz-dashboard-contenido">
        <CuentasVerificadas />
      </main>
    </div>
  );
}
