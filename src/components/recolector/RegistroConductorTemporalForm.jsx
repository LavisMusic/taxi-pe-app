import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { useTaxiAuth } from "../../contexts/TaxiAuthContext";
import { useConductorTemporal } from "../../hooks/useConductorTemporal";
import { useLocalidades } from "../../hooks/useLocalidades";
import Dropdown from "../Dropdown";
import { esNombreCompletoValido, esTelefonoValido } from "../../lib/taxiEnums";

// Bug reportado: mismo aviso chico que el resto de logins — este
// componente no lo muestra directo (se cierra el modal/navega antes),
// así que no hace falta AvisoTop acá.
const ENTRAR_DELAY_MS = 700;

// Registro exprés de Conductor: reemplaza el viejo "Registrarse" (todo
// el formulario de RegistroConductorForm.jsx de una) en los puntos de
// entrada públicos (AccesoConductorModal, /login) — ahora solo pide
// nombre completo + teléfono, entra de una a la app
// (estado_verificacion='temporal') y deja el resto (DNI, placa, fotos,
// PIN) para cuando el propio conductor quiera, hasta 7 días — ver
// StaffLoginForm.jsx (detecta la cuenta temporal por `pin: null` +
// `estado_verificacion` y muestra ahí el formulario de verificación).
//
// `rol="recolector"`: mismo registro (nombre y teléfono); entra de una a
// /recolector con sus créditos de bienvenida y verifica su cuenta desde
// ahí (VerificarRecolectorForm) dentro de los 7 días.
export default function RegistroConductorTemporalForm({ onSuccess, rol = "conductor" }) {
  const { loginUsuario } = useTaxiAuth();
  const { registrarTemporal, loading } = useConductorTemporal();
  const navigate = useNavigate();
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [localidad, setLocalidad] = useState("");
  const [pin, setPin] = useState("");
  const [confirmarPin, setConfirmarPin] = useState("");
  const [error, setError] = useState("");
  const esRecolector = rol === "recolector";
  const { localidades } = useLocalidades();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!esNombreCompletoValido(nombre)) {
      setError('Escribe el nombre completo (nombre y apellido), ej. "Josue Ramos".');
      return;
    }
    const telefonoTrim = telefono.trim();
    if (!esTelefonoValido(telefonoTrim)) {
      setError("Ingresa un celular válido: 9 dígitos, empieza con 9 (ej. 987654321).");
      return;
    }
    if (!esRecolector && !localidad) {
      setError("Selecciona tu localidad.");
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

    const { usuario, message } = await registrarTemporal({
      nombre: nombre.trim(),
      telefono: telefonoTrim,
      rol,
      pin,
      localidad: esRecolector ? null : localidad,
    });
    if (!usuario) {
      setError(message);
      return;
    }
    setTimeout(() => {
      loginUsuario(usuario, true);
      onSuccess?.();
      navigate(esRecolector ? "/recolector" : "/conductor", { replace: true });
    }, ENTRAR_DELAY_MS);
  };

  return (
    <form onSubmit={handleSubmit}>
      <p className="tz-stock-editor-sub">
        {esRecolector
          ? "Ingresa ya mismo con tus créditos de bienvenida — dentro de la app verificas tu cuenta (DNI y foto); podrás recargar cuando el Admin la apruebe. Si no la verificas en 7 días, se eliminará."
          : "Ingresa ya mismo con tu mes de membresía de bienvenida — dentro de la app eliges tu vehículo y verificas tu cuenta (DNI, placa y fotos). Si no la verificas en 7 días, se eliminará."}
      </p>
      <label className="tz-field-label" htmlFor="cond-temp-nombre">
        Nombre completo
      </label>
      <input
        id="cond-temp-nombre"
        type="text"
        autoFocus
        className="tz-text-input"
        placeholder="Nombre y apellido"
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
      />

      <label className="tz-field-label" htmlFor="cond-temp-telefono">
        Teléfono
      </label>
      <input
        id="cond-temp-telefono"
        type="tel"
        inputMode="numeric"
        maxLength={9}
        className="tz-text-input"
        placeholder="987654321"
        value={telefono}
        onChange={(e) => setTelefono(e.target.value)}
      />

      {!esRecolector && (
        <>
          <label className="tz-field-label">Localidad</label>
          <Dropdown
            value={localidad}
            onChange={setLocalidad}
            options={localidades.map((loc) => ({ value: loc.nombre, label: loc.nombre }))}
            placeholder={localidades.length === 0 ? "Sin localidades creadas" : "¿Dónde trabajas?"}
            disabled={localidades.length === 0}
            ariaLabel="Localidad"
          />
        </>
      )}

      <label className="tz-field-label" htmlFor="cond-temp-pin">
        Crea tu PIN (6 dígitos)
      </label>
      <input
        id="cond-temp-pin"
        type="password"
        inputMode="numeric"
        maxLength={6}
        className="tz-text-input"
        placeholder="••••••"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
      />
      <label className="tz-field-label" htmlFor="cond-temp-pin-confirm">
        Confirma tu PIN
      </label>
      <input
        id="cond-temp-pin-confirm"
        type="password"
        inputMode="numeric"
        maxLength={6}
        className="tz-text-input"
        placeholder="••••••"
        value={confirmarPin}
        onChange={(e) => setConfirmarPin(e.target.value)}
      />
      <p className="tz-camera-note" style={{ margin: "2px 0 0" }}>
        Con tu teléfono y este PIN vuelves a entrar cuando quieras.
      </p>

      {error && <p className="tz-error">{error}</p>}
      <button type="submit" className="tz-scan-btn tz-payment-save" disabled={loading} style={{ marginTop: 10 }}>
        <UserPlus size={16} />
        {loading ? "Creando cuenta…" : "Crear mi cuenta"}
      </button>
    </form>
  );
}
