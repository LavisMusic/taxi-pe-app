import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ShieldCheck, UserCheck } from "lucide-react";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { useVincularConductor } from "../hooks/useVincularConductor";
import { esTelefonoValido } from "../lib/taxiEnums";
import Styles from "../components/Styles";
import logo from "../assets/logo.png";

// Ruta /registro-conductor — el puente final del Paso 3: acá "aterriza"
// un conductor que un Recolector ya pre-registró en la calle (tiene
// fila en `conductores`, sin cuenta de login todavía). Dos pasos en la
// misma pantalla: 1) confirmar que su teléfono coincide con un
// pre-registro real, 2) elegir DNI + PIN para crear su `usuarios`.
export default function RegistroConductorPage() {
  const { loginUsuario } = useTaxiAuth();
  const { buscarPreRegistro, crearCuenta, loading } = useVincularConductor();
  const navigate = useNavigate();

  const [paso, setPaso] = useState(1);
  const [telefono, setTelefono] = useState("");
  const [conductorEncontrado, setConductorEncontrado] = useState(null);
  const [buscando, setBuscando] = useState(false);
  const [buscarError, setBuscarError] = useState("");

  const [dni, setDni] = useState("");
  const [pin, setPin] = useState("");
  const [confirmarPin, setConfirmarPin] = useState("");
  const [formError, setFormError] = useState("");

  const handleBuscar = async (e) => {
    e.preventDefault();
    setBuscarError("");
    const telefonoTrim = telefono.trim();
    if (!esTelefonoValido(telefonoTrim)) {
      setBuscarError("Ingresa un celular válido: 9 dígitos, empieza con 9 (ej. 987654321).");
      return;
    }
    setBuscando(true);
    const { conductor, message } = await buscarPreRegistro(telefonoTrim);
    setBuscando(false);
    if (conductor) {
      setConductorEncontrado(conductor);
      setPaso(2);
    } else {
      setBuscarError(message);
    }
  };

  const handleCrearCuenta = async (e) => {
    e.preventDefault();
    setFormError("");

    if (!/^\d{8}$/.test(dni.trim())) {
      setFormError("El DNI debe tener 8 dígitos.");
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      setFormError("El PIN debe tener 6 dígitos.");
      return;
    }
    if (pin !== confirmarPin) {
      setFormError("Los PIN no coinciden.");
      return;
    }

    const { usuario, error: crearError, message } = await crearCuenta({
      dni: dni.trim(),
      telefono: telefono.trim(),
      pin,
      nombre: conductorEncontrado.nombre,
    });

    if (crearError) {
      setFormError(message);
      return;
    }

    loginUsuario(usuario, true);
    navigate("/conductor", { replace: true });
  };

  return (
    <div
      className="tz-root"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <Styles />
      <div className="tz-modal" style={{ position: "static" }}>
        <img src={logo} alt="TaxiP" className="tz-modal-logo" />
        <p className="tz-brand-sub">
          {paso === 1 ? "¿Ya te registró un recolector?" : "Crea tu PIN de acceso"}
        </p>

        {paso === 1 ? (
          <form onSubmit={handleBuscar}>
            <div className="tz-login-field">
              <label className="tz-field-label" htmlFor="reg-telefono">
                Teléfono con el que te registraron
              </label>
              <input
                id="reg-telefono"
                type="tel"
                inputMode="numeric"
                maxLength={9}
                autoFocus
                className="tz-text-input"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="987654321"
              />
              <p className="tz-camera-note" style={{ margin: "4px 0 0" }}>
                Debe ser un número real con WhatsApp para la verificación.
              </p>
            </div>

            {buscarError && <p className="tz-error">{buscarError}</p>}
            <button type="submit" className="tz-scan-btn tz-payment-save" disabled={buscando}>
              <Search size={16} />
              {buscando ? "Buscando…" : "Buscar mi registro"}
            </button>
          </form>
        ) : (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(57,255,176,0.4)",
                background: "var(--green-bg)",
                marginBottom: 16,
              }}
            >
              <UserCheck size={20} color="var(--green)" />
              <span>
                Encontramos a <strong>{conductorEncontrado.nombre}</strong> · placa{" "}
                <strong>{conductorEncontrado.placa}</strong>. ¿Eres tú?
              </span>
            </div>

            <form onSubmit={handleCrearCuenta}>
              <div className="tz-login-field">
                <label className="tz-field-label" htmlFor="reg-dni">
                  DNI
                </label>
                <input
                  id="reg-dni"
                  type="text"
                  inputMode="numeric"
                  maxLength={8}
                  autoFocus
                  className="tz-text-input"
                  value={dni}
                  onChange={(e) => setDni(e.target.value)}
                  placeholder="12345678"
                />
              </div>
              <div className="tz-login-field">
                <label className="tz-field-label" htmlFor="reg-pin">
                  Crea tu PIN (6 dígitos)
                </label>
                <input
                  id="reg-pin"
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
                <label className="tz-field-label" htmlFor="reg-pin-confirm">
                  Confirma tu PIN
                </label>
                <input
                  id="reg-pin-confirm"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  className="tz-text-input"
                  value={confirmarPin}
                  onChange={(e) => setConfirmarPin(e.target.value)}
                  placeholder="••••••"
                />
              </div>

              {formError && <p className="tz-error">{formError}</p>}
              <button type="submit" className="tz-scan-btn tz-payment-save" disabled={loading}>
                <ShieldCheck size={16} />
                {loading ? "Creando cuenta…" : "Crear mi cuenta"}
              </button>
              <button
                type="button"
                className="tz-metodo-pago-change"
                style={{ marginTop: 10 }}
                onClick={() => {
                  setPaso(1);
                  setConductorEncontrado(null);
                }}
              >
                No soy yo, buscar otro teléfono
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
