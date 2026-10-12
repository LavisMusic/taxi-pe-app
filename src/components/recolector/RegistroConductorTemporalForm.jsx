import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { UserPlus } from "lucide-react";
import { useTaxiAuth } from "../../contexts/TaxiAuthContext";
import { useConductorTemporal } from "../../hooks/useConductorTemporal";
import VerificarRecolectorForm from "../VerificarRecolectorForm";
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
// `rol="recolector"`: mismo registro (nombre y teléfono), pero el
// recolector NO entra a la app: verifica su cuenta ahí mismo
// (VerificarRecolectorForm) y queda pendiente de que el Admin la apruebe
// (`onVerificado` avisa cuando terminó).
export default function RegistroConductorTemporalForm({ onSuccess, rol = "conductor", onVerificado }) {
  const { loginUsuario } = useTaxiAuth();
  const { registrarTemporal, loading } = useConductorTemporal();
  const navigate = useNavigate();
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [error, setError] = useState("");
  const [recolectorCreado, setRecolectorCreado] = useState(null);
  const [verificado, setVerificado] = useState(false);
  const esRecolector = rol === "recolector";

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

    const { usuario, message } = await registrarTemporal({ nombre: nombre.trim(), telefono: telefonoTrim, rol });
    if (!usuario) {
      setError(message);
      return;
    }
    if (esRecolector) {
      setRecolectorCreado(usuario);
      return;
    }

    setTimeout(() => {
      loginUsuario(usuario, true);
      onSuccess?.();
      navigate("/conductor", { replace: true });
    }, ENTRAR_DELAY_MS);
  };

  if (verificado) {
    return (
      <p className="tz-success">
        ✓ Tu verificación fue enviada. Podrás entrar con tu teléfono y PIN cuando el Admin apruebe tu cuenta.
      </p>
    );
  }
  if (recolectorCreado) {
    return (
      <VerificarRecolectorForm
        usuario={recolectorCreado}
        onVerificado={(u) => {
          setVerificado(true);
          onVerificado?.(u);
        }}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <p className="tz-stock-editor-sub">
        {esRecolector
          ? "Crea tu cuenta con tu nombre y teléfono; en el siguiente paso verificas tus datos para que el Admin la apruebe."
          : "Ingresa ya mismo — dentro de la app puedes completar tus datos (DNI, placa, fotos y PIN) cuando quieras, tienes 7 días antes de que la cuenta se elimine si no lo haces."}
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
