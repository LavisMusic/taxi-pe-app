import { useState } from "react";
import { Lock } from "lucide-react";
import { supabase, setAuthPersistence } from "../supabaseClient";
import { ADMIN_DUMMY_EMAIL, usuarioToDummyEmail } from "../lib/auth";
import Styles from "./Styles";
import logo from "../assets/logo.png";

// Puerta de entrada del personal (/admin): dos modos sobre la MISMA
// pantalla, sin exponer nunca un campo de correo.
//   - Admin: un solo campo "Clave secreta" (cuenta única, email fijo
//     ADMIN_DUMMY_EMAIL) — tal como se pidió desde el inicio.
//   - Cajero: "Usuario" + "Clave" (puede haber varios cajeros, cada uno
//     con su propia cuenta creada por el admin desde el panel; email
//     dummy = usuario@tonazo.staff).
// Ambos casos crean una sesión real de Supabase Auth vía
// signInWithPassword para que RLS reconozca auth.uid() (is_admin() /
// is_cajero() en la base de datos). App.jsx decide qué mostrar según
// el rol una vez adentro — esta pantalla no sabe ni le importa cuál es.
export default function AdminLoginGate() {
  const [modo, setModo] = useState("admin"); // 'admin' | 'cajero'
  const [claveSecreta, setClaveSecreta] = useState("");
  const [usuario, setUsuario] = useState("");
  const [claveCajero, setClaveCajero] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    let email;
    let password;
    if (modo === "admin") {
      if (!claveSecreta) {
        setError("Ingresa la clave secreta.");
        return;
      }
      email = ADMIN_DUMMY_EMAIL;
      password = claveSecreta;
    } else {
      if (!usuario.trim() || !claveCajero) {
        setError("Ingresa tu usuario y clave.");
        return;
      }
      email = usuarioToDummyEmail(usuario);
      password = claveCajero;
    }

    setSubmitting(true);
    setAuthPersistence(rememberMe);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);

    if (signInError) {
      setError(modo === "admin" ? "Clave incorrecta. Intenta de nuevo." : "Usuario o clave incorrectos.");
      return;
    }
    // AuthContext recoge la sesión vía onAuthStateChange; RequireAdmin
    // vuelve a evaluar el rol automáticamente.
  };

  return (
    <div
      className="tz-root"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <Styles />
      <div className="tz-modal" style={{ position: "static" }}>
        <img src={logo} alt="TONAZO" className="tz-modal-logo" />
        <p className="tz-brand-sub">
          {modo === "admin" ? "Panel de Administración" : "Acceso Cajero"}
        </p>

        <div className="tz-gasto-tipo-buttons" style={{ marginBottom: 16 }}>
          <button
            type="button"
            className={`tz-gasto-tipo-btn ${modo === "admin" ? "tz-gasto-tipo-active" : ""}`}
            onClick={() => {
              setModo("admin");
              setError("");
            }}
          >
            Admin
          </button>
          <button
            type="button"
            className={`tz-gasto-tipo-btn ${modo === "cajero" ? "tz-gasto-tipo-active" : ""}`}
            onClick={() => {
              setModo("cajero");
              setError("");
            }}
          >
            Cajero
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {modo === "admin" ? (
            <div className="tz-login-field">
              <label className="tz-field-label" htmlFor="admin-clave">
                Clave secreta
              </label>
              <input
                id="admin-clave"
                type="password"
                autoFocus
                className="tz-text-input"
                value={claveSecreta}
                onChange={(e) => setClaveSecreta(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          ) : (
            <>
              <div className="tz-login-field">
                <label className="tz-field-label" htmlFor="cajero-usuario">
                  Usuario
                </label>
                <input
                  id="cajero-usuario"
                  type="text"
                  autoFocus
                  className="tz-text-input"
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                  placeholder="caja1"
                  autoCapitalize="off"
                  autoCorrect="off"
                />
              </div>
              <div className="tz-login-field">
                <label className="tz-field-label" htmlFor="cajero-clave">
                  Clave
                </label>
                <input
                  id="cajero-clave"
                  type="password"
                  className="tz-text-input"
                  value={claveCajero}
                  onChange={(e) => setClaveCajero(e.target.value)}
                  placeholder="••••••••"
                />
              </div>
            </>
          )}

          <label className="tz-checkbox-row">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            Mantener sesión iniciada
          </label>

          {error && <p className="tz-error">{error}</p>}
          <button
            type="submit"
            className="tz-scan-btn tz-payment-save"
            disabled={submitting}
          >
            <Lock size={16} />
            {submitting ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}
