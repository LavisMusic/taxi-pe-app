import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { KeyRound, Send, CheckCircle2, Ticket, Loader2 } from "lucide-react";
import { useCrearPeticionPin } from "../hooks/useCrearPeticionPin";
import { esTelefonoValido } from "../lib/taxiEnums";
import Styles from "../components/Styles";
import logo from "../assets/logo.webp";

// Ruta pública /recuperar-pin — sin sesión, porque el punto es justamente
// no poder loguearse. Acá solo se PIDE el cambio de PIN: el Admin le manda
// por WhatsApp un código de un solo uso (vence en 30 min) y el enlace a
// /restablecer-pin, donde el propio dueño de la cuenta escribe ese código
// y elige su PIN nuevo (RestablecerPinPage.jsx, migración 20261014220000).
//
// Se identifica solo por el celular: si ya lo escribió en el login, el
// botón "Olvidé mi PIN" lo trae en el state de la navegación (nunca en la
// URL) y la solicitud se envía sola, sin formulario. Si no, se le pide
// acá. La base arma la petición con los datos de la cuenta
// (useCrearPeticionPin.js, migración 20261015100000).
const LISTOS = ["enviada", "pendiente", "codigo_enviado"];

export default function RecuperarPinPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { crear, loading } = useCrearPeticionPin();
  const telefonoLogin = String(location.state?.telefono || "").trim();
  const automatico = esTelefonoValido(telefonoLogin);

  const [telefono, setTelefono] = useState(telefonoLogin);
  const [error, setError] = useState("");
  // { estado, message } cuando la solicitud ya quedó en manos del Admin.
  const [resultado, setResultado] = useState(null);
  const [enviandoAuto, setEnviandoAuto] = useState(automatico);
  const yaEnviado = useRef(false);

  const enviar = async (numero) => {
    setError("");
    const r = await crear(numero);
    if (LISTOS.includes(r.estado)) setResultado(r);
    else setError(r.message);
  };

  useEffect(() => {
    if (!automatico || yaEnviado.current) return;
    yaEnviado.current = true;
    enviar(telefonoLogin).finally(() => setEnviandoAuto(false));
    // Solo al entrar con el número del login.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const numero = telefono.trim();
    if (!esTelefonoValido(numero)) {
      setError("Ingresa un celular válido: 9 dígitos, empieza con 9 (ej. 987654321).");
      return;
    }
    await enviar(numero);
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

  const volverLogin = (
    <button
      type="button"
      className="tz-metodo-pago-change"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", margin: "8px 0 0" }}
      onClick={() => navigate("/login")}
    >
      <KeyRound size={13} /> Volver al login
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

        {enviandoAuto ? (
          <div style={{ textAlign: "center", padding: "18px 0" }}>
            <Loader2 size={32} className="tz-spin" style={{ marginBottom: 10 }} />
            <p>Enviando tu solicitud al Admin…</p>
          </div>
        ) : resultado ? (
          <div style={{ textAlign: "center", padding: "10px 0" }}>
            <CheckCircle2 size={40} color="var(--green)" style={{ marginBottom: 10 }} />
            <p>
              {resultado.estado === "enviada"
                ? "Solicitud enviada. Un Admin te enviará por WhatsApp un código y el enlace para elegir tu PIN nuevo. El código sirve una sola vez y vence en 30 minutos."
                : resultado.message}
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
              Escribe el celular con el que entras a TaxiPE. Un Admin te enviará un código por WhatsApp para que
              elijas tu PIN nuevo.
            </p>

            <div className="tz-login-field">
              <label className="tz-field-label" htmlFor="rec-telefono">
                Teléfono
              </label>
              <input
                id="rec-telefono"
                type="tel"
                inputMode="numeric"
                maxLength={9}
                autoFocus
                className="tz-text-input"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value.replace(/\D/g, ""))}
                placeholder="987654321"
              />
            </div>

            {error && <p className="tz-error">{error}</p>}
            <button type="submit" className="tz-scan-btn tz-payment-save" disabled={loading}>
              {loading ? <Loader2 size={16} className="tz-spin" /> : <Send size={16} />}
              {loading ? "Enviando…" : "Enviar solicitud"}
            </button>
            {irACodigo}
            {volverLogin}
          </form>
        )}
      </div>
    </div>
  );
}
