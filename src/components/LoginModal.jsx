import { useState } from "react";
import { X, Lock } from "lucide-react";
import { supabase, setAuthPersistence } from "../supabaseClient";
import { celularToDummyEmail } from "../lib/auth";
import Styles from "./Styles";
import logo from "../assets/logo.png";

// Login de clientes: solo Celular + PIN, sin correo, sin SMS. Por dentro
// arma un "dummy email" y usa signInWithPassword de Supabase Auth.
//
// Usa la estética "Tonazo" (tz-, Styles.jsx) igual que el resto del
// sistema — la puerta de entrada del cliente se ve como el catálogo y
// el panel de admin, no como un formulario genérico. Se renderiza como
// overlay (backdrop + modal) porque se abre
// encima del catálogo público, que sigue con su propio tema claro/oscuro.
export default function LoginModal({ onClose, onSuccess }) {
  const [celular, setCelular] = useState("");
  const [pin, setPin] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const celularTrim = celular.trim();
    if (!/^\d{6,15}$/.test(celularTrim)) {
      setError("Ingresa un celular válido (solo números).");
      return;
    }
    if (!pin) {
      setError("Ingresa tu PIN.");
      return;
    }

    setSubmitting(true);
    setAuthPersistence(rememberMe);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: celularToDummyEmail(celularTrim),
      password: pin,
    });
    setSubmitting(false);

    if (signInError) {
      setError("Celular o PIN incorrecto.");
      return;
    }

    onSuccess?.();
  };

  return (
    <div className="tz-root" style={{ minHeight: 0, width: "auto", background: "transparent" }}>
      <Styles />
      <div className="tz-modal-backdrop" onClick={onClose}>
        <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
          <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>

          <img src={logo} alt="TONAZO" className="tz-modal-logo" />
          <p className="tz-brand-sub">Ingresa con tu celular y PIN</p>

          <form onSubmit={handleSubmit}>
            <div className="tz-login-field">
              <label className="tz-field-label" htmlFor="login-celular">
                Celular
              </label>
              <input
                id="login-celular"
                type="tel"
                inputMode="numeric"
                autoFocus
                className="tz-text-input"
                value={celular}
                onChange={(e) => setCelular(e.target.value)}
                placeholder="999999999"
              />
            </div>
            <div className="tz-login-field">
              <label className="tz-field-label" htmlFor="login-pin">
                PIN
              </label>
              <input
                id="login-pin"
                type="password"
                inputMode="numeric"
                className="tz-text-input"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••••"
              />
            </div>

            <label className="tz-checkbox-row">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              Mantener sesión iniciada
            </label>

            {error && <p className="tz-error">{error}</p>}
            <button type="submit" className="tz-scan-btn tz-payment-save" disabled={submitting}>
              <Lock size={16} />
              {submitting ? "Ingresando..." : "Ingresar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
