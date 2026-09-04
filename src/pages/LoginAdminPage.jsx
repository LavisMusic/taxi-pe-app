import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { useAvisoTop } from "../hooks/useAvisoTop";
import AvisoTop from "../components/AvisoTop";
import { ADMIN_MASTER_CODE } from "../lib/taxiAuth";
import Styles from "../components/Styles";
import logo from "../assets/logo.png";

// Bug reportado: mismo aviso chico arriba de la pantalla que
// PasajeroAuthForm.jsx/StaffLoginForm.jsx — ver ese comentario.
const ENTRAR_DELAY_MS = 700;

// Ruta /login-admin: un único campo de código maestro, sin usuario ni
// DNI. Reusa exactamente las clases tz-modal/tz-login-field/tz-text-input
// del login viejo (AdminLoginGate) para no romper la estética — la
// diferencia es que esto ya no crea una sesión de Supabase Auth, solo
// marca `isAdminMaster` en TaxiAuthContext (ver RequireAdminMaster).
export default function LoginAdminPage() {
  const { loginAdminMaster } = useTaxiAuth();
  const navigate = useNavigate();
  const { aviso, mostrar } = useAvisoTop();
  const [codigo, setCodigo] = useState("");
  // Bug reportado: la sesión de Admin se cerraba sola al reiniciar o
  // salir un momento de la pestaña (ver TaxiAuthContext.jsx). Default
  // false a propósito — más restrictivo que el checkbox del login
  // normal, sigue siendo una puerta administrativa.
  const [rememberMe, setRememberMe] = useState(false);
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
      mostrar("Código incorrecto.", "error");
      return;
    }

    mostrar("✓ Sesión iniciada correctamente", "exito");
    setTimeout(() => {
      loginAdminMaster(rememberMe);
      navigate("/admin", { replace: true });
    }, ENTRAR_DELAY_MS);
  };

  return (
    <div
      className="tz-root"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <Styles />
      <AvisoTop aviso={aviso} />
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

          <label className="tz-checkbox-row">
            <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
            Mantener sesión iniciada
          </label>

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
