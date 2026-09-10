import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import Dropdown from "./Dropdown";
import { usePasajeroAuth } from "../hooks/usePasajeroAuth";
import { esEdadValida, SEXOS } from "../lib/taxiEnums";

// Paso 2 del registro exprés de Pasajero: completa nombre/apellido/
// edad/sexo/PIN de la cuenta 'temporal' (nombre_usuario+teléfono nomás)
// creada por PasajeroAuthForm.jsx (pestaña "Registrarme"). Extraído a
// su propio componente (mismo criterio que VerificarConductorForm.jsx)
// para poder reusarlo en DOS lugares: PasajeroAuthForm.jsx (lo ve quien
// recién se registró o vuelve a loguearse sin PIN todavía) y
// HomePage.jsx (lo ve quien YA está adentro con la cuenta temporal y
// quiere verificarse sin cerrar sesión, desde el aviso fijo — ver
// AvisoVerificacionCuenta.jsx) — por eso no asume login propio, solo
// llama a `onVerificado(usuario)` cuando termina.
export default function VerificarPasajeroForm({ usuario, onVerificado, submitLabel = "Verificar cuenta e ingresar" }) {
  const { verificarCuenta, loading } = usePasajeroAuth();
  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [edad, setEdad] = useState("");
  const [sexo, setSexo] = useState("");
  const [nuevoPin, setNuevoPin] = useState("");
  const [confirmarNuevoPin, setConfirmarNuevoPin] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!nombre.trim() || !apellido.trim()) {
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
    const { usuario: actualizado, message } = await verificarCuenta({
      usuarioId: usuario.id,
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      edad: Number(edad),
      sexo,
      pin: nuevoPin,
    });
    if (!actualizado) {
      setError(message);
      return;
    }
    onVerificado(actualizado);
  };

  return (
    <form onSubmit={handleSubmit}>
      <p className="tz-stock-editor-sub">
        Hola, {usuario.nombre_usuario} — completa tus datos para que tu cuenta deje de ser temporal.
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
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
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
        <Dropdown value={sexo} onChange={setSexo} options={SEXOS} placeholder="Selecciona" ariaLabel="Sexo" />
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
      <button type="submit" className="tz-scan-btn tz-payment-save" disabled={loading}>
        <ShieldCheck size={16} />
        {loading ? "Guardando…" : submitLabel}
      </button>
    </form>
  );
}
