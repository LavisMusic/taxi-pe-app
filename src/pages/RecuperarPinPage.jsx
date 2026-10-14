import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Send, CheckCircle2, Ticket } from "lucide-react";
import { useCrearPeticionPin } from "../hooks/useCrearPeticionPin";
import { TIPOS_USUARIO, TIPO_USUARIO_CONDUCTOR } from "../lib/taxiEnums";
import Styles from "../components/Styles";
import logo from "../assets/logo.webp";

// Ruta pública /recuperar-pin — sin sesión, porque el punto es justamente
// no poder loguearse. Acá solo se PIDE el cambio de PIN: el Admin le manda
// por WhatsApp un código de un solo uso (vence en 30 min) y el enlace a
// /restablecer-pin, donde el propio dueño de la cuenta escribe ese código
// y elige su PIN nuevo (RestablecerPinPage.jsx, migración 20261014220000).
// Antes, ya verificada la petición, cualquiera que supiera el DNI podía
// elegir el PIN desde acá.
export default function RecuperarPinPage() {
  const navigate = useNavigate();
  const { crear, loading } = useCrearPeticionPin();

  const [nombre, setNombre] = useState("");
  const [dni, setDni] = useState("");
  const [placa, setPlaca] = useState("");
  const [tipoUsuario, setTipoUsuario] = useState(TIPO_USUARIO_CONDUCTOR);
  const [error, setError] = useState("");
  const [enviado, setEnviado] = useState(false);

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

    const { message } = await crear({
      nombre: nombre.trim(),
      dni: dni.trim(),
      placa: esConductor ? placa.trim().toUpperCase() : "",
      tipoUsuario,
    });
    if (message) {
      setError(message);
      return;
    }
    setEnviado(true);
  };

  const irACodigo = (
    <button
      type="button"
      className="tz-metodo-pago-change"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", margin: "12px 0 0" }}
      onClick={() => navigate("/restablecer-pin")}
    >
      <Ticket size={13} /> Ya tengo mi código
    </button>
  );

  return (
    <div
      className="tz-root"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <Styles />
      <div className="tz-modal" style={{ position: "static" }}>
        <img src={logo} alt="TaxiP" className="tz-modal-logo" />
        <p className="tz-brand-sub">Olvidé mi PIN</p>

        {enviado ? (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <CheckCircle2 size={40} color="var(--green)" style={{ marginBottom: 10 }} />
            <p>
              Solicitud enviada. Un Admin te enviará por WhatsApp un código y el enlace para elegir tu PIN
              nuevo. El código sirve una sola vez y vence en 30 minutos.
            </p>
            <button
              type="button"
              className="tz-scan-btn tz-payment-save"
              style={{ marginTop: 14 }}
              onClick={() => navigate("/login")}
            >
              Volver al login
            </button>
            {irACodigo}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p className="tz-stock-editor-sub">
              Un Admin te enviará un código por WhatsApp. Con ese código eliges tu PIN nuevo tú mismo.
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
            {irACodigo}
            <button
              type="button"
              className="tz-metodo-pago-change"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", margin: "8px 0 0" }}
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
