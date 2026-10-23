import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, ShieldCheck, CheckCircle2, Loader2, LogIn } from "lucide-react";
import { supabase } from "../supabaseClient";
import { mirrorCuentaACaja } from "../lib/mirrorCaja";
import Styles from "../components/Styles";
import logo from "../assets/logo.webp";

// Ruta pública /restablecer-pin (migración 20261014220000). El usuario
// escribe el código que le mandó el Admin por WhatsApp (8 caracteres, un
// solo uso, vence en 30 min): si es correcto, la base reconoce de qué
// cuenta es, resuelve la petición sola y le da 15 minutos para elegir su
// PIN nuevo. 5 códigos incorrectos desde el mismo dispositivo → 15 min de
// bloqueo. Al guardar, botón para volver a iniciar sesión.
const formatear = (valor) => {
  const limpio = valor.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return limpio.length > 4 ? `${limpio.slice(0, 4)}-${limpio.slice(4)}` : limpio;
};

export default function RestablecerPinPage() {
  const navigate = useNavigate();
  const [paso, setPaso] = useState("codigo"); // codigo | pin | listo
  const [codigo, setCodigo] = useState("");
  const [token, setToken] = useState(null);
  const [nombre, setNombre] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  const validar = async (e) => {
    e.preventDefault();
    setError("");
    if (codigo.replace("-", "").length !== 8) {
      setError("El código tiene 8 caracteres (ej. K7M2-QX9P).");
      return;
    }
    setCargando(true);
    const { data, error: err } = await supabase.rpc("taxi_restablecer_pin_validar", { p_codigo: codigo });
    setCargando(false);
    if (err) return setError("No se pudo verificar el código. Intenta de nuevo.");
    if (data?.estado === "bloqueado") {
      return setError("Demasiados intentos. Espera 15 minutos antes de volver a probar.");
    }
    if (data?.estado !== "ok") {
      return setError("Código incorrecto o vencido. Revisa el mensaje de WhatsApp o pide uno nuevo al Admin.");
    }
    setToken(data.token);
    setNombre(data.nombre || "");
    setPaso("pin");
  };

  const guardar = async (e) => {
    e.preventDefault();
    setError("");
    if (!/^\d{6}$/.test(pin)) return setError("El PIN debe tener 6 dígitos.");
    if (pin !== pin2) return setError("Los PIN no coinciden.");
    setCargando(true);
    const { data, error: err } = await supabase.rpc("taxi_restablecer_pin_guardar", { p_token: token, p_pin: pin });
    setCargando(false);
    if (err) return setError("No se pudo guardar tu PIN. Intenta de nuevo.");
    if (data?.estado === "vencido") {
      return setError("Pasaron más de 15 minutos. Pide un código nuevo al Admin para cambiar tu PIN.");
    }
    if (data?.estado === "bloqueada") {
      return setError('Esta cuenta está bloqueada por seguridad. Para reactivarla, entra a Soporte → "Recuperar cuenta".');
    }
    if (data?.estado !== "ok") return setError("No encontramos tu cuenta. Contacta a un Admin.");
    // El pasajero entra a Caja Tonazo con el mismo PIN: se copia el nuevo
    // (best-effort, mirrorCaja.js; si falla, el cambio acá ya quedó).
    if (data.rol === "pasajero" && data.telefono) {
      mirrorCuentaACaja({ telefono: data.telefono, pin, nombre: data.nombre, motivo: "cambio_pin" });
    }
    setPaso("listo");
  };

  return (
    <div className="tz-root" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <Styles />
      <div className="tz-modal" style={{ position: "static" }}>
        <img src={logo} alt="TaxiP" className="tz-modal-logo" />
        <p className="tz-brand-sub">{paso === "pin" ? "Elige tu PIN nuevo" : "Restablecer PIN"}</p>

        {paso === "codigo" && (
          <form onSubmit={validar}>
            <p className="tz-stock-editor-sub">
              Escribe el código que te enviamos por WhatsApp. Sirve una sola vez y vence a los 30 minutos.
            </p>
            <div className="tz-login-field">
              <label className="tz-field-label" htmlFor="rp-codigo">
                Código
              </label>
              <input
                id="rp-codigo"
                type="text"
                autoFocus
                autoComplete="one-time-code"
                autoCapitalize="characters"
                className="tz-text-input tz-codigo-input"
                value={codigo}
                onChange={(e) => setCodigo(formatear(e.target.value))}
                placeholder="XXXX-XXXX"
              />
            </div>
            {error && <p className="tz-error">{error}</p>}
            <button type="submit" className="tz-scan-btn tz-payment-save" disabled={cargando}>
              {cargando ? <Loader2 size={16} className="tz-spin" /> : <ShieldCheck size={16} />}
              {cargando ? "Verificando…" : "Verificar código"}
            </button>
            <button
              type="button"
              className="tz-metodo-pago-change"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", margin: "12px 0 0" }}
              onClick={() => navigate("/recuperar-pin")}
            >
              <KeyRound size={13} /> No tengo un código: pedir el cambio de PIN
            </button>
          </form>
        )}

        {paso === "pin" && (
          <form onSubmit={guardar}>
            <p className="tz-stock-editor-sub">
              {nombre ? `Hola, ${nombre}. ` : ""}Elige el PIN que vas a usar de ahora en adelante (tienes 15 minutos).
            </p>
            <div className="tz-login-field">
              <label className="tz-field-label" htmlFor="rp-pin">
                Nuevo PIN (6 dígitos)
              </label>
              <input
                id="rp-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                className="tz-text-input"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
              />
            </div>
            <div className="tz-login-field">
              <label className="tz-field-label" htmlFor="rp-pin2">
                Confirma el PIN
              </label>
              <input
                id="rp-pin2"
                type="password"
                inputMode="numeric"
                maxLength={6}
                className="tz-text-input"
                value={pin2}
                onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••"
              />
            </div>
            {error && <p className="tz-error">{error}</p>}
            <button type="submit" className="tz-scan-btn tz-payment-save" disabled={cargando}>
              {cargando ? <Loader2 size={16} className="tz-spin" /> : <ShieldCheck size={16} />}
              {cargando ? "Guardando…" : "Guardar PIN"}
            </button>
          </form>
        )}

        {paso === "listo" && (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <CheckCircle2 size={40} color="var(--green)" style={{ marginBottom: 10 }} />
            <p>Listo: tu PIN nuevo ya está guardado.</p>
            <button
              type="button"
              className="tz-scan-btn tz-payment-save"
              style={{ marginTop: 14 }}
              onClick={() => navigate("/login", { replace: true })}
            >
              <LogIn size={16} /> Volver a iniciar sesión
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
