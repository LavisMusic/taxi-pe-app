import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { ADMIN_MASTER_CODE } from "../lib/taxiAuth";
import Styles from "../components/Styles";
import logo from "../assets/logo.png";

// Ruta /login-admin: un único campo de código maestro, sin usuario ni
// DNI. Reusa exactamente las clases tz-modal/tz-login-field/tz-text-input
// del login viejo (AdminLoginGate) para no romper la estética — la
// diferencia es que esto ya no crea una sesión de Supabase Auth, solo
// marca `isAdminMaster` en TaxiAuthContext (ver RequireAdminMaster).
export default function LoginAdminPage() {
  const { loginAdminMaster } = useTaxiAuth();
  const navigate = useNavigate();
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError("");

    if (!codigo.trim()) {
      setError("Ingresa el código maestro.");
      return;
    }

    setSubmitting(true);
    if (codigo.trim() !== ADMIN_MASTER_CODE) {
      setSubmitting(false);
      setError("Código incorrecto.");
      return;
    }

    loginAdminMaster();
    navigate("/admin", { replace: true });
  };

  return (
    <div
      className="tz-root"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <Styles />
      <div className="tz-modal" style={{ position: "static" }}>
        <img src={logo} alt="TaxiP" className="tz-modal-logo" />
        <p className="tz-brand-sub">Panel de Administración</p>

        <form onSubmit={handleSubmit}>
          <div className="tz-login-field">
            <label className="tz-field-label" htmlFor="admin-master-code">
              Código maestro
            </label>
            <input
              id="admin-master-code"
              type="password"
              inputMode="numeric"
              autoFocus
              className="tz-text-input"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="••••••"
            />
          </div>

          {error && <p className="tz-error">{error}</p>}
          <button type="submit" className="tz-scan-btn tz-payment-save" disabled={submitting}>
            <ShieldCheck size={16} />
            {submitting ? "Verificando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}
