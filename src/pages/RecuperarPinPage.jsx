import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Send, CheckCircle2, ShieldCheck } from "lucide-react";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { useCrearPeticionPin } from "../hooks/useCrearPeticionPin";
import { useAvisoTop } from "../hooks/useAvisoTop";
import AvisoTop from "../components/AvisoTop";
import { TIPOS_USUARIO, TIPO_USUARIO_CONDUCTOR } from "../lib/taxiEnums";
import { routeForRole } from "../lib/taxiAuth";
import Styles from "../components/Styles";
import logo from "../assets/logo.png";

// Bug reportado: mismo aviso chico arriba de la pantalla que los demás
// logins — ver PasajeroAuthForm.jsx.
const ENTRAR_DELAY_MS = 700;

// Ruta pública /recuperar-pin — sin sesión, porque el punto es
// justamente no poder loguearse. El 2FA manual por WhatsApp sigue
// siendo el Admin (ver PeticionesModal.jsx, "Verificar Identidad"),
// pero el PIN nuevo lo elige el DUEÑO de la cuenta, no el Admin — bug
// reportado: antes el Admin lo generaba y lo mandaba él mismo, como si
// fuera su contraseña para repartir. Por eso esta pantalla tiene 3
// estados posibles según lo que devuelva `crear()` al reenviar el
// mismo DNI:
//   1) sin petición todavía → formulario de solicitud (de siempre).
//   2) petición 'pendiente' → mensaje de espera (de siempre).
//   3) petición 'verificado' → paso nuevo: elegir el PIN acá mismo.
export default function RecuperarPinPage() {
  const navigate = useNavigate();
  const { loginUsuario } = useTaxiAuth();
  const { crear, fijarNuevoPin, loading } = useCrearPeticionPin();
  const { aviso, mostrar } = useAvisoTop();

  const [nombre, setNombre] = useState("");
  const [dni, setDni] = useState("");
  const [placa, setPlaca] = useState("");
  const [tipoUsuario, setTipoUsuario] = useState(TIPO_USUARIO_CONDUCTOR);
  const [error, setError] = useState("");
  const [enviado, setEnviado] = useState(false);

  // Presente solo en el paso 3 (ya verificado) — trae {id, dni} de la
  // petición, para poder cerrarla al guardar el PIN nuevo.
  const [peticionVerificada, setPeticionVerificada] = useState(null);
  const [nuevoPin, setNuevoPin] = useState("");
  const [confirmarNuevoPin, setConfirmarNuevoPin] = useState("");
  const [pinError, setPinError] = useState("");

  const esConductor = tipoUsuario === TIPO_USUARIO_CONDUCTOR;

  const handleSubmit = async (e) => {
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
    if (esConductor && !placa.trim()) {
      setError("Ingresa tu placa.");
      return;
    }

    const dniTrim = dni.trim();
    const { message, peticionVerificada: verificada } = await crear({
      nombre: nombre.trim(),
      dni: dniTrim,
      placa: esConductor ? placa.trim().toUpperCase() : "",
      tipoUsuario,
    });
    if (verificada) {
      setPeticionVerificada(verificada);
      return;
    }
    if (message) {
      setError(message);
      return;
    }
    setEnviado(true);
  };

  const handleFijarPin = async (e) => {
    e.preventDefault();
    setPinError("");
    if (!/^\d{6}$/.test(nuevoPin)) {
      setPinError("El PIN debe tener 6 dígitos.");
      return;
    }
    if (nuevoPin !== confirmarNuevoPin) {
      setPinError("Los PIN no coinciden.");
      return;
    }

    const { usuario, message } = await fijarNuevoPin({
      peticionId: peticionVerificada.id,
      dni: peticionVerificada.dni,
      nuevoPin,
    });
    if (!usuario) {
      setPinError(message);
      mostrar(message || "No se pudo guardar tu PIN.", "error");
      return;
    }

    mostrar("✓ Sesión iniciada correctamente", "exito");
    setTimeout(() => {
      loginUsuario(usuario, true);
      navigate(routeForRole(usuario.rol), { replace: true });
    }, ENTRAR_DELAY_MS);
  };

  return (
    <div
      className="tz-root"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <Styles />
      <AvisoTop aviso={aviso} />
      <div className="tz-modal" style={{ position: "static" }}>
        <img src={logo} alt="TaxiP" className="tz-modal-logo" />
        <p className="tz-brand-sub">
          {peticionVerificada ? "Elegí tu PIN nuevo" : "Olvidé mi PIN"}
        </p>

        {peticionVerificada ? (
          <form onSubmit={handleFijarPin}>
            <p className="tz-stock-editor-sub">
              Ya verificamos tu identidad — elegí el PIN que vas a usar de ahora en adelante.
            </p>
            <div className="tz-login-field">
              <label className="tz-field-label" htmlFor="rec-nuevo-pin">
                Nuevo PIN (6 dígitos)
              </label>
              <input
                id="rec-nuevo-pin"
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
              <label className="tz-field-label" htmlFor="rec-confirmar-nuevo-pin">
                Confirma el PIN
              </label>
              <input
                id="rec-confirmar-nuevo-pin"
                type="password"
                inputMode="numeric"
                maxLength={6}
                className="tz-text-input"
                value={confirmarNuevoPin}
                onChange={(e) => setConfirmarNuevoPin(e.target.value)}
                placeholder="••••••"
              />
            </div>
            {pinError && <p className="tz-error">{pinError}</p>}
            <button type="submit" className="tz-scan-btn tz-payment-save" disabled={loading}>
              <ShieldCheck size={16} />
              {loading ? "Guardando…" : "Guardar PIN e ingresar"}
            </button>
          </form>
        ) : enviado ? (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <CheckCircle2 size={40} color="var(--green)" style={{ marginBottom: 10 }} />
            <p>
              Solicitud enviada. Un Admin va a contactarte por WhatsApp para verificar tu identidad — una
              vez verificado, volvé a esta misma pantalla con tu DNI para elegir tu PIN nuevo.
            </p>
            <button
              type="button"
              className="tz-scan-btn tz-payment-save"
              style={{ marginTop: 14 }}
              onClick={() => navigate("/login")}
            >
              Volver al login
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="tz-stock-editor-sub">
              Un Admin va a verificar tu identidad por WhatsApp — después de eso, vos mismo elegís tu PIN
              nuevo acá mismo.
            </p>

            <label className="tz-field-label">Soy</label>
            <div className="tz-gasto-tipo-buttons" style={{ marginBottom: 14 }}>
              {TIPOS_USUARIO.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`tz-gasto-tipo-btn ${tipoUsuario === t.value ? "tz-gasto-tipo-active" : ""}`}
                  onClick={() => setTipoUsuario(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="tz-login-field">
              <label className="tz-field-label" htmlFor="rec-nombre">
                Nombre
              </label>
              <input
                id="rec-nombre"
                type="text"
                autoFocus
                className="tz-text-input"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre completo"
              />
            </div>

            <div className="tz-login-field">
              <label className="tz-field-label" htmlFor="rec-dni">
                DNI
              </label>
              <input
                id="rec-dni"
                type="text"
                inputMode="numeric"
                maxLength={8}
                className="tz-text-input"
                value={dni}
                onChange={(e) => setDni(e.target.value)}
                placeholder="12345678"
              />
              <p className="tz-camera-note" style={{ margin: "4px 0 0" }}>
                ¿Ya te habían verificado antes? Ingresa el mismo DNI y pasás directo a elegir tu PIN nuevo.
              </p>
            </div>

            {esConductor && (
              <div className="tz-login-field">
                <label className="tz-field-label" htmlFor="rec-placa">
                  Placa
                </label>
                <input
                  id="rec-placa"
                  type="text"
                  className="tz-text-input"
                  value={placa}
                  onChange={(e) => setPlaca(e.target.value)}
                  placeholder="ABC-123"
                />
              </div>
            )}

            {error && <p className="tz-error">{error}</p>}
            <button type="submit" className="tz-scan-btn tz-payment-save" disabled={loading}>
              <Send size={16} />
              {loading ? "Enviando…" : "Enviar solicitud"}
            </button>
            <button
              type="button"
              className="tz-metodo-pago-change"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", margin: "12px 0 0" }}
              onClick={() => navigate("/login")}
            >
              <KeyRound size={13} /> Volver al login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
