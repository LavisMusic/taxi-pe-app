import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { useTaxiAuth } from "../../contexts/TaxiAuthContext";
import { useConductorTemporal } from "../../hooks/useConductorTemporal";
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
export default function RegistroConductorTemporalForm({ onSuccess }) {
  const { loginUsuario } = useTaxiAuth();
  const { registrarTemporal, loading } = useConductorTemporal();
  const navigate = useNavigate();
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!esNombreCompletoValido(nombre)) {
      setError('Escribe el nombre completo (nombre y apellido), ej. "Daniela Rivas".');
      return;
    }
    const telefonoTrim = telefono.trim();
    if (!esTelefonoValido(telefonoTrim)) {
      setError("Ingresa un celular válido: 9 dígitos, empieza con 9 (ej. 987654321).");
      return;
    }

    const { usuario, message } = await registrarTemporal({ nombre: nombre.trim(), telefono: telefonoTrim });
    if (!usuario) {
      setError(message);
      return;
    }

    setTimeout(() => {
      loginUsuario(usuario, true);
      onSuccess?.();
      navigate("/conductor", { replace: true });
    }, ENTRAR_DELAY_MS);
  };

  return (
    <form onSubmit={handleSubmit}>
      <p className="tz-stock-editor-sub">
        Ingresa ya mismo — dentro de la app puedes completar tus datos (DNI, placa, fotos y PIN) cuando quieras,
        tienes 7 días antes de que la cuenta se elimine si no lo haces.
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

      {error && <p className="tz-error">{error}</p>}
      <button type="submit" className="tz-scan-btn tz-payment-save" disabled={loading} style={{ marginTop: 10 }}>
        <UserPlus size={16} />
        {loading ? "Creando cuenta…" : "Crear mi cuenta"}
      </button>
    </form>
  );
}
