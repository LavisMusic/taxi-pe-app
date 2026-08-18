import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogIn, ShieldCheck, KeyRound } from "lucide-react";
import { supabase } from "../supabaseClient";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { hashPin, verifyPin } from "../lib/pinAuth";
import { esTelefonoValido } from "../lib/taxiEnums";
import { routeForRole } from "../lib/taxiAuth";

// Login de Conductor/Recolector — Teléfono+PIN nomás, sin DNI: se busca
// la cuenta SOLO por teléfono (acotado a rol conductor/recolector, para
// que un pasajero no pueda "loguearse" por acá con su mismo número) y
// el propio `usuarios.rol` que devuelve la fila decide a dónde
// redirigir (`routeForRole`) — no importa si este form se abrió desde
// el botón "Conductores" o "Recolectores" de la Home, el resultado es
// el mismo: entra a donde le corresponde de verdad. Reusado en
// AccesoConductorModal.jsx, AccesoRecolectorModal.jsx y en /login.
//
// Primer login sin PIN: `usuarios.pin` puede nacer NULL (el Admin/el
// propio conductor ya no inventan una contraseña al registrarse, ver
// useCrearConductorConUsuario.js). Achá se detecta apenas se encuentra
// la fila por teléfono — si `pin` es null, ese hallazgo YA es la prueba
// de identidad (nadie más tiene ese teléfono registrado) y se pasa
// directo al paso de "Crea tu PIN".
export default function StaffLoginForm({ onSuccess }) {
  const { loginUsuario } = useTaxiAuth();
  const navigate = useNavigate();
  const [telefono, setTelefono] = useState("");
  const [pin, setPin] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [usuarioSinPin, setUsuarioSinPin] = useState(null);
  const [nuevoPin, setNuevoPin] = useState("");
  const [confirmarNuevoPin, setConfirmarNuevoPin] = useState("");
  const [creandoPin, setCreandoPin] = useState(false);

  const entrar = (usuario) => {
    loginUsuario(usuario, rememberMe);
    onSuccess?.();
    navigate(routeForRole(usuario.rol), { replace: true });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const telefonoTrim = telefono.trim();
    if (!esTelefonoValido(telefonoTrim)) {
      setError("Ingresa un celular válido: 9 dígitos, empieza con 9 (ej. 987654321).");
      return;
    }

    setSubmitting(true);
    const { data, error: queryError } = await supabase
      .from("usuarios")
      .select("*")
      .eq("telefono", telefonoTrim)
      .in("rol", ["conductor", "recolector"])
      .maybeSingle();

    if (queryError) {
      setSubmitting(false);
      setError("No se pudo verificar tus datos. Intenta de nuevo.");
      return;
    }
    if (!data) {
      setSubmitting(false);
      setError("Teléfono o PIN incorrectos.");
      return;
    }

    if (!data.pin) {
      setSubmitting(false);
      setUsuarioSinPin(data);
      return;
    }

    if (!/^\d{6}$/.test(pin)) {
      setSubmitting(false);
      setError("El PIN debe tener 6 dígitos.");
      return;
    }

    let valido = false;
    try {
      valido = await verifyPin(pin, data.pin);
    } catch {
      setSubmitting(false);
      setError("No se pudo verificar tu PIN. Intenta de nuevo.");
      return;
    }
    setSubmitting(false);
    if (!valido) {
      setError("Teléfono o PIN incorrectos.");
      return;
    }

    entrar(data);
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
    let hash;
    try {
      hash = await hashPin(nuevoPin);
    } catch {
      setCreandoPin(false);
      setError("No se pudo proteger el PIN. Intenta de nuevo.");
      return;
    }

    const { data, error: updateError } = await supabase
      .from("usuarios")
      .update({ pin: hash })
      .eq("id", usuarioSinPin.id)
      .select()
      .single();
    setCreandoPin(false);
    if (updateError || !data) {
      setError("No se pudo guardar el PIN. Intenta de nuevo.");
      return;
    }

    entrar(data);
  };

  if (usuarioSinPin) {
    return (
      <form onSubmit={handleCrearPin}>
        <p className="tz-stock-editor-sub">
          Es tu primer ingreso, {usuarioSinPin.nombre} — crea tu PIN de acceso para las próximas veces.
        </p>
        <div className="tz-login-field">
          <label className="tz-field-label" htmlFor="staff-nuevo-pin">
            Nuevo PIN (6 dígitos)
          </label>
          <input
            id="staff-nuevo-pin"
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
          <label className="tz-field-label" htmlFor="staff-confirmar-pin">
            Confirma el PIN
          </label>
          <input
            id="staff-confirmar-pin"
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

  return (
    <form onSubmit={handleSubmit}>
      <div className="tz-login-field">
        <label className="tz-field-label" htmlFor="staff-telefono">
          Teléfono
        </label>
        <input
          id="staff-telefono"
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
        <label className="tz-field-label" htmlFor="staff-pin">
          PIN
        </label>
        <input
          id="staff-pin"
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
      <button type="submit" className="tz-scan-btn tz-payment-save" disabled={submitting}>
        <LogIn size={16} />
        {submitting ? "Ingresando..." : "Ingresar"}
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
  );
}
