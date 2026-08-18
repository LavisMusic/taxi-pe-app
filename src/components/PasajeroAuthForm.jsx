import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, UserPlus, ShieldCheck, KeyRound } from "lucide-react";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { usePasajeroAuth } from "../hooks/usePasajeroAuth";
import { esTelefonoValido } from "../lib/taxiEnums";

// Pasajero: registro propio (DNI+Teléfono+PIN, el DNI se guarda pero ya
// no hace falta para el día a día) y login liviano (solo Teléfono+PIN).
// Extraído de LoginPage.jsx para poder reusarlo tal cual dentro de un
// modal desde la Home pública (botón "Login" del header) — no le
// importa dónde lo monten, solo necesita `useTaxiAuth`/`usePasajeroAuth`
// y navega a "/" al terminar; `onSuccess` (opcional) además cierra
// el modal que lo esté conteniendo.
export default function PasajeroAuthForm({ onSuccess }) {
  const { loginUsuario } = useTaxiAuth();
  const { registrar, login, crearPin, loading } = usePasajeroAuth();
  const navigate = useNavigate();
  const [modo, setModo] = useState("ingresar");

  const [nombre, setNombre] = useState("");
  const [dni, setDni] = useState("");
  const [telefono, setTelefono] = useState("");
  const [pin, setPin] = useState("");
  const [confirmarPin, setConfirmarPin] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");

  // Primer ingreso sin PIN (cuenta de alta manual del Admin, sin
  // contraseña inventada): `login` devuelve `usuarioSinPin` en vez de
  // `usuario` — acá se guarda para pasar al paso de "Crea tu PIN".
  const [usuarioSinPin, setUsuarioSinPin] = useState(null);
  const [nuevoPin, setNuevoPin] = useState("");
  const [confirmarNuevoPin, setConfirmarNuevoPin] = useState("");
  const [creandoPin, setCreandoPin] = useState(false);

  const entrar = (usuario) => {
    loginUsuario(usuario, rememberMe);
    onSuccess?.();
    navigate("/", { replace: true });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    const telefonoTrim = telefono.trim();
    if (!esTelefonoValido(telefonoTrim)) {
      setError("Ingresa un celular válido: 9 dígitos, empieza con 9 (ej. 987654321).");
      return;
    }
    // El formato del PIN se valida DENTRO del hook, recién después de
    // saber si esta cuenta tiene uno — así una cuenta sin PIN (alta
    // manual del Admin) puede entrar dejando el campo vacío.
    const { usuario, usuarioSinPin: sinPin, message } = await login({ telefono: telefonoTrim, pin });
    if (sinPin) {
      setUsuarioSinPin(sinPin);
      return;
    }
    if (!usuario) {
      setError(message);
      return;
    }
    entrar(usuario);
  };

  const handleCrearPin = async (e) => {
    e.preventDefault();
    setError("");
    if (!/^\d{6}$/.test(nuevoPin)) {
      setError("El PIN debe tener 6 dígitos.");
      return;
    }
    if (nuevoPin !== confirmarNuevoPin) {
      setError("Los PIN no coinciden.");
      return;
    }
    setCreandoPin(true);
    const { usuario, message } = await crearPin({ usuarioId: usuarioSinPin.id, nuevoPin });
    setCreandoPin(false);
    if (!usuario) {
      setError(message);
      return;
    }
    entrar(usuario);
  };

  if (usuarioSinPin) {
    return (
      <form onSubmit={handleCrearPin}>
        <p className="tz-stock-editor-sub">
          Es tu primer ingreso, {usuarioSinPin.nombre} — crea tu PIN de acceso para las próximas veces.
        </p>
        <div className="tz-login-field">
          <label className="tz-field-label" htmlFor="pax-nuevo-pin">
            Nuevo PIN (6 dígitos)
          </label>
          <input
            id="pax-nuevo-pin"
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            className="tz-text-input"
            value={nuevoPin}
            onChange={(e) => setNuevoPin(e.target.value)}
            placeholder="••••••"
          />
        </div>
        <div className="tz-login-field">
          <label className="tz-field-label" htmlFor="pax-confirmar-nuevo-pin">
            Confirma el PIN
          </label>
          <input
            id="pax-confirmar-nuevo-pin"
            type="password"
            inputMode="numeric"
            maxLength={6}
            className="tz-text-input"
            value={confirmarNuevoPin}
            onChange={(e) => setConfirmarNuevoPin(e.target.value)}
            placeholder="••••••"
          />
        </div>
        {error && <p className="tz-error">{error}</p>}
        <button type="submit" className="tz-scan-btn tz-payment-save" disabled={creandoPin}>
          <ShieldCheck size={16} />
          {creandoPin ? "Guardando…" : "Crear PIN e ingresar"}
        </button>
      </form>
    );
  }

  const handleRegistro = async (e) => {
    e.preventDefault();
    setError("");
    if (!nombre.trim()) {
      setError("Ingresa tu nombre.");
      return;
    }
    if (!/^\d{8}$/.test(dni.trim())) {
      setError("El DNI debe tener 8 dígitos.");
      return;
    }
    const telefonoTrim = telefono.trim();
    if (!esTelefonoValido(telefonoTrim)) {
      setError("Ingresa un celular válido: 9 dígitos, empieza con 9 (ej. 987654321).");
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setError("El PIN debe tener 6 dígitos.");
      return;
    }
    if (pin !== confirmarPin) {
      setError("Los PIN no coinciden.");
      return;
    }
    const { usuario, message } = await registrar({
      nombre: nombre.trim(),
      dni: dni.trim(),
      telefono: telefonoTrim,
      pin,
    });
    if (!usuario) {
      setError(message);
      return;
    }
    loginUsuario(usuario, true);
    onSuccess?.();
    navigate("/", { replace: true });
  };

  return (
    <>
      <div className="tz-gasto-tipo-buttons" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`tz-gasto-tipo-btn ${modo === "ingresar" ? "tz-gasto-tipo-active" : ""}`}
          onClick={() => {
            setModo("ingresar");
            setError("");
          }}
        >
          Ingresar
        </button>
        <button
          type="button"
          className={`tz-gasto-tipo-btn ${modo === "registrar" ? "tz-gasto-tipo-active" : ""}`}
          onClick={() => {
            setModo("registrar");
            setError("");
          }}
        >
          Registrarme
        </button>
      </div>

      {modo === "ingresar" ? (
        <form onSubmit={handleLogin}>
          <div className="tz-login-field">
            <label className="tz-field-label" htmlFor="pax-telefono">
              Teléfono
            </label>
            <input
              id="pax-telefono"
              type="tel"
              inputMode="numeric"
              maxLength={9}
              autoFocus
              className="tz-text-input"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="987654321"
            />
          </div>
          <div className="tz-login-field">
            <label className="tz-field-label" htmlFor="pax-pin">
              PIN
            </label>
            <input
              id="pax-pin"
              type="password"
              inputMode="numeric"
              maxLength={6}
              className="tz-text-input"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••••"
            />
            <p className="tz-camera-note" style={{ margin: "4px 0 0" }}>
              ¿Primera vez? Deja el PIN vacío — lo creamos después de verificar tu teléfono.
            </p>
          </div>
          <label className="tz-checkbox-row">
            <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
            Mantener sesión iniciada
          </label>
          {error && <p className="tz-error">{error}</p>}
          <button type="submit" className="tz-scan-btn tz-payment-save" disabled={loading}>
            <LogIn size={16} />
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
          <button
            type="button"
            className="tz-metodo-pago-change"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", margin: "10px 0 0" }}
            onClick={() => navigate("/recuperar-pin")}
          >
            <KeyRound size={13} /> Olvidé mi PIN
          </button>
        </form>
      ) : (
        <form onSubmit={handleRegistro}>
          <div className="tz-login-field">
            <label className="tz-field-label" htmlFor="pax-nombre">
              Nombre
            </label>
            <input
              id="pax-nombre"
              type="text"
              autoFocus
              className="tz-text-input"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Nombre completo"
            />
          </div>
          <div className="tz-login-field">
            <label className="tz-field-label" htmlFor="pax-dni">
              DNI
            </label>
            <input
              id="pax-dni"
              type="text"
              inputMode="numeric"
              maxLength={8}
              className="tz-text-input"
              value={dni}
              onChange={(e) => setDni(e.target.value)}
              placeholder="12345678"
            />
          </div>
          <div className="tz-login-field">
            <label className="tz-field-label" htmlFor="pax-reg-telefono">
              Teléfono
            </label>
            <input
              id="pax-reg-telefono"
              type="tel"
              inputMode="numeric"
              maxLength={9}
              className="tz-text-input"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="987654321"
            />
            <p className="tz-camera-note" style={{ margin: "2px 0 0" }}>
              Debe ser un número real con WhatsApp para la verificación.
            </p>
          </div>
          <div className="tz-login-field">
            <label className="tz-field-label" htmlFor="pax-reg-pin">
              Crea tu PIN (6 dígitos)
            </label>
            <input
              id="pax-reg-pin"
              type="password"
              inputMode="numeric"
              maxLength={6}
              className="tz-text-input"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="••••••"
            />
          </div>
          <div className="tz-login-field">
            <label className="tz-field-label" htmlFor="pax-reg-pin-confirm">
              Confirma tu PIN
            </label>
            <input
              id="pax-reg-pin-confirm"
              type="password"
              inputMode="numeric"
              maxLength={6}
              className="tz-text-input"
              value={confirmarPin}
              onChange={(e) => setConfirmarPin(e.target.value)}
              placeholder="••••••"
            />
          </div>
          {error && <p className="tz-error">{error}</p>}
          <button type="submit" className="tz-scan-btn tz-payment-save" disabled={loading}>
            <UserPlus size={16} />
            {loading ? "Creando cuenta…" : "Crear mi cuenta"}
          </button>
        </form>
      )}
    </>
  );
}
