import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, UserPlus, ShieldCheck, KeyRound } from "lucide-react";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { usePasajeroAuth } from "../hooks/usePasajeroAuth";
import { useAvisoTop } from "../hooks/useAvisoTop";
import AvisoTop from "./AvisoTop";
import Dropdown from "./Dropdown";
import {
  esTelefonoValido,
  esNombreUsuarioValido,
  esEdadValida,
  ESTADO_VERIFICACION_TEMPORAL,
  SEXOS,
} from "../lib/taxiEnums";

// Bug reportado: aviso chico y no-intrusivo arriba de la pantalla al
// iniciar sesión (éxito o fallido), que se apaga solo — ver
// useAvisoTop.js. En el caso de éxito, la navegación se retrasa un
// toque (ENTRAR_DELAY_MS) para que de verdad se alcance a VER el aviso
// antes de saltar a la pantalla siguiente; en el de error no hace falta
// (no hay navegación, el aviso simplemente convive con el formulario).
const ENTRAR_DELAY_MS = 700;

// Pasajero: registro exprés (nombre de usuario + teléfono nomás, entra
// de una con una cuenta 'temporal') y login liviano (Teléfono+PIN, con
// PIN vacío la primera vez — ver `handleLogin`/`login` en
// usePasajeroAuth.js, que detecta `pin: null` y devuelve
// `usuarioSinPin` para pasar al formulario de verificación de acá
// arriba). Extraído de LoginPage.jsx para poder reusarlo tal cual
// dentro de un modal desde la Home pública (botón "Login" del header)
// — no le importa dónde lo monten, solo necesita
// `useTaxiAuth`/`usePasajeroAuth` y navega a "/" al terminar;
// `onSuccess` (opcional) además cierra el modal que lo esté conteniendo.
export default function PasajeroAuthForm({ onSuccess }) {
  const { loginUsuario } = useTaxiAuth();
  const { registrarTemporal, verificarCuenta, login, crearPin, loading } = usePasajeroAuth();
  const navigate = useNavigate();
  const { aviso, mostrar } = useAvisoTop();
  const [modo, setModo] = useState("ingresar");

  const [nombreUsuario, setNombreUsuario] = useState("");
  const [telefono, setTelefono] = useState("");
  const [pin, setPin] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");

  // Primer ingreso sin PIN todavía: `login` devuelve `usuarioSinPin` en
  // vez de `usuario`. Puede ser 1) una cuenta temporal del registro
  // exprés (estado_verificacion='temporal': acá pedimos recién nombre,
  // apellido, edad, sexo y PIN — ver handleVerificarCuenta) o 2) una
  // cuenta de alta manual del Admin, ya 'permanente' (solo falta el
  // PIN, sin datos de más — ver handleCrearPin).
  const [usuarioSinPin, setUsuarioSinPin] = useState(null);
  const [apellido, setApellido] = useState("");
  const [edad, setEdad] = useState("");
  const [sexo, setSexo] = useState("");
  const [nuevoPin, setNuevoPin] = useState("");
  const [confirmarNuevoPin, setConfirmarNuevoPin] = useState("");
  const [creandoPin, setCreandoPin] = useState(false);
  const [nombreVerif, setNombreVerif] = useState("");

  // `remember` explícito (no siempre el checkbox del login): el
  // registro nunca mostró ese checkbox y siempre recordaba la sesión
  // de una — se mantiene ese comportamiento pasando `true` a mano desde
  // handleRegistro, en vez de depender del estado compartido `rememberMe`.
  const entrar = (usuario, remember = rememberMe) => {
    mostrar("✓ Sesión iniciada correctamente", "exito");
    setTimeout(() => {
      loginUsuario(usuario, remember);
      onSuccess?.();
      navigate("/", { replace: true });
    }, ENTRAR_DELAY_MS);
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
      mostrar(message || "No se pudo iniciar sesión.", "error");
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
      mostrar(message || "No se pudo crear el PIN.", "error");
      return;
    }
    entrar(usuario);
  };

  // Segundo paso del registro exprés: la cuenta nació con solo
  // nombre_usuario+teléfono (estado_verificacion='temporal') — acá se
  // completan los datos reales y el PIN, y pasa directo a 'permanente'.
  const handleVerificarCuenta = async (e) => {
    e.preventDefault();
    setError("");
    if (!nombreVerif.trim() || !apellido.trim()) {
      setError("Ingresa tu nombre y apellido.");
      return;
    }
    if (!esEdadValida(edad)) {
      setError("Ingresa una edad válida (18 a 90 años).");
      return;
    }
    if (!sexo) {
      setError("Selecciona tu sexo.");
      return;
    }
    if (!/^\d{6}$/.test(nuevoPin)) {
      setError("El PIN debe tener 6 dígitos.");
      return;
    }
    if (nuevoPin !== confirmarNuevoPin) {
      setError("Los PIN no coinciden.");
      return;
    }
    setCreandoPin(true);
    const { usuario, message } = await verificarCuenta({
      usuarioId: usuarioSinPin.id,
      nombre: nombreVerif.trim(),
      apellido: apellido.trim(),
      edad: Number(edad),
      sexo,
      pin: nuevoPin,
    });
    setCreandoPin(false);
    if (!usuario) {
      setError(message);
      mostrar(message || "No se pudo guardar tu verificación.", "error");
      return;
    }
    mostrar("✓ Cuenta verificada", "exito");
    entrar(usuario);
  };

  if (usuarioSinPin?.estado_verificacion === ESTADO_VERIFICACION_TEMPORAL) {
    return (
      <form onSubmit={handleVerificarCuenta}>
        <AvisoTop aviso={aviso} />
        <p className="tz-stock-editor-sub">
          Hola, {usuarioSinPin.nombre_usuario} — completa tus datos para que tu cuenta deje de ser temporal.
        </p>
        <div className="tz-login-field">
          <label className="tz-field-label" htmlFor="pax-verif-nombre">
            Nombre
          </label>
          <input
            id="pax-verif-nombre"
            type="text"
            autoFocus
            className="tz-text-input"
            value={nombreVerif}
            onChange={(e) => setNombreVerif(e.target.value)}
            placeholder="Nombre"
          />
        </div>
        <div className="tz-login-field">
          <label className="tz-field-label" htmlFor="pax-verif-apellido">
            Apellido
          </label>
          <input
            id="pax-verif-apellido"
            type="text"
            className="tz-text-input"
            value={apellido}
            onChange={(e) => setApellido(e.target.value)}
            placeholder="Apellido"
          />
        </div>
        <div className="tz-login-field">
          <label className="tz-field-label" htmlFor="pax-verif-edad">
            Edad
          </label>
          <input
            id="pax-verif-edad"
            type="number"
            inputMode="numeric"
            min={18}
            max={90}
            className="tz-text-input"
            value={edad}
            onChange={(e) => setEdad(e.target.value)}
            placeholder="25"
          />
        </div>
        <div className="tz-login-field">
          <label className="tz-field-label">Sexo</label>
          <Dropdown
            value={sexo}
            onChange={setSexo}
            options={SEXOS}
            placeholder="Selecciona"
            ariaLabel="Sexo"
          />
        </div>
        <div className="tz-login-field">
          <label className="tz-field-label" htmlFor="pax-verif-pin">
            Crea tu PIN (6 dígitos)
          </label>
          <input
            id="pax-verif-pin"
            type="password"
            inputMode="numeric"
            maxLength={6}
            className="tz-text-input"
            value={nuevoPin}
            onChange={(e) => setNuevoPin(e.target.value)}
            placeholder="••••••"
          />
        </div>
        <div className="tz-login-field">
          <label className="tz-field-label" htmlFor="pax-verif-pin-confirm">
            Confirma tu PIN
          </label>
          <input
            id="pax-verif-pin-confirm"
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
          {creandoPin ? "Guardando…" : "Verificar cuenta e ingresar"}
        </button>
      </form>
    );
  }

  if (usuarioSinPin) {
    return (
      <form onSubmit={handleCrearPin}>
        <AvisoTop aviso={aviso} />
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

  const handleRegistroTemporal = async (e) => {
    e.preventDefault();
    setError("");
    if (!esNombreUsuarioValido(nombreUsuario)) {
      setError("El usuario debe tener 3 a 20 caracteres: letras, números y guion bajo, sin espacios.");
      return;
    }
    const telefonoTrim = telefono.trim();
    if (!esTelefonoValido(telefonoTrim)) {
      setError("Ingresa un celular válido: 9 dígitos, empieza con 9 (ej. 987654321).");
      return;
    }
    const { usuario, message } = await registrarTemporal({
      nombreUsuario: nombreUsuario.trim(),
      telefono: telefonoTrim,
    });
    if (!usuario) {
      setError(message);
      mostrar(message || "No se pudo crear la cuenta.", "error");
      return;
    }
    entrar(usuario, true);
  };

  return (
    <>
      <AvisoTop aviso={aviso} />
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
        <form onSubmit={handleRegistroTemporal}>
          <p className="tz-stock-editor-sub">
            Ingresa ya mismo — más adelante te pedimos completar tus datos.
          </p>
          <div className="tz-login-field">
            <label className="tz-field-label" htmlFor="pax-nombre-usuario">
              Nombre de usuario
            </label>
            <input
              id="pax-nombre-usuario"
              type="text"
              autoFocus
              className="tz-text-input"
              value={nombreUsuario}
              onChange={(e) => setNombreUsuario(e.target.value)}
              placeholder="ej. zaph_sr"
            />
            <p className="tz-camera-note" style={{ margin: "2px 0 0" }}>
              3 a 20 caracteres: letras, números y guion bajo, sin espacios.
            </p>
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
