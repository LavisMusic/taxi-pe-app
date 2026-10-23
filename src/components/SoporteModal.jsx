import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Headset,
  ShieldAlert,
  LifeBuoy,
  Lock,
  Send,
  Loader2,
  CheckCircle2,
  Camera,
  ArrowLeft,
} from "lucide-react";
import { supabase } from "../supabaseClient";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { subirFotoRecuperacion } from "../lib/comprobantes";
import { esTelefonoValido } from "../lib/taxiEnums";

// Modal del botón "Soporte" (sistema antirrobo, migración 20261021100000):
//   1. Conversar con soporte: WhatsApp al número de soporte (lo de antes).
//   2. Bloqueo de emergencia: con el celular y el PIN actual (o el
//      anterior, hasta 72 h después de un cambio) la cuenta deja de
//      poder usarse en Taxi-PE y en Caja Tonazo. Antes de bloquear se
//      confirma con un aviso. Solo se reactiva con "Recuperar cuenta".
//   3. Recuperar cuenta: número de la cuenta, nombre completo, DNI, foto
//      sosteniendo el DNI, comentario y número de recuperación. Llega al
//      Admin de Taxi-PE (Centro de Peticiones); si la acepta, le manda un
//      código por WhatsApp al número de recuperación para elegir un PIN
//      nuevo. Enviarla no bloquea ni desbloquea nada.
const MENSAJES_BLOQUEO = {
  incorrecto: "Celular o PIN incorrectos.",
  bloqueado: "Demasiados intentos. Espera 15 minutos e intenta de nuevo.",
};

const MENSAJES_RECUPERACION = {
  pendiente: "Ya hay una solicitud de recuperación en curso para esta cuenta. El Admin te contactará.",
  no_existe: "No encontramos una cuenta con ese número.",
  invalido: "Revisa los datos: celulares de 9 dígitos, DNI de 8 dígitos, foto y comentario.",
  limite: "Enviaste varias solicitudes seguidas. Espera una hora e intenta de nuevo.",
  bloqueado: "Demasiados intentos. Espera 15 minutos e intenta de nuevo.",
};

// Razones rápidas de "¿Qué pasó con tu cuenta?"; "Otros" abre el campo
// para que lo cuente con sus palabras.
const RAZONES = [
  "Me robaron el celular",
  "Perdí mi celular",
  "Alguien entró a mi cuenta",
  "Alguien cambió mi PIN",
  "Cambié de número y no tengo el anterior",
  "Olvidé mi PIN y no tengo mi WhatsApp",
];
const OTROS = "Otros";

const botonFila = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  width: "100%",
  margin: "10px 0 0",
};

export default function SoporteModal({ linkSoporte, onClose: cerrarModal }) {
  const { usuario, logout } = useTaxiAuth();
  const [pantalla, setPantalla] = useState("menu");
  // Bloqueó la cuenta que está abierta en este dispositivo: se cierra la
  // sesión al salir del modal (antes no, para que alcance a ver el aviso
  // y pueda ir a "Recuperar cuenta" sin que la página lo saque).
  const [salirAlCerrar, setSalirAlCerrar] = useState(false);
  const onClose = () => {
    cerrarModal();
    if (salirAlCerrar) logout();
  };
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);

  // Bloqueo
  const [telBloqueo, setTelBloqueo] = useState(usuario?.telefono ?? "");
  const [pinBloqueo, setPinBloqueo] = useState("");

  // Recuperación
  const [telCuenta, setTelCuenta] = useState(usuario?.telefono ?? "");
  const [nombre, setNombre] = useState("");
  const [dni, setDni] = useState("");
  const [telRecuperacion, setTelRecuperacion] = useState("");
  const [razon, setRazon] = useState("");
  const [comentario, setComentario] = useState("");
  const [foto, setFoto] = useState(null);
  const [fotoPreview, setFotoPreview] = useState("");

  useEffect(() => () => fotoPreview && URL.revokeObjectURL(fotoPreview), [fotoPreview]);

  const ir = (destino) => {
    setError("");
    setPantalla(destino);
  };

  const continuarBloqueo = (e) => {
    e.preventDefault();
    setError("");
    if (!esTelefonoValido(telBloqueo.trim())) return setError("Ingresa un celular válido: 9 dígitos, empieza con 9.");
    if (!/^\d{6}$/.test(pinBloqueo)) return setError("El PIN tiene 6 dígitos.");
    setPantalla("bloqueo-confirmar");
  };

  const confirmarBloqueo = async () => {
    setError("");
    setCargando(true);
    const { data, error: rpcError } = await supabase.rpc("taxi_bloquear_cuenta", {
      p_telefono: telBloqueo.trim(),
      p_pin: pinBloqueo,
    });
    setCargando(false);
    setPinBloqueo("");
    if (rpcError) {
      setPantalla("bloqueo");
      return setError("No se pudo bloquear la cuenta. Intenta de nuevo.");
    }
    if (data?.estado !== "ok" && data?.estado !== "ya_bloqueada") {
      setPantalla("bloqueo");
      return setError(MENSAJES_BLOQUEO[data?.estado] || "No se pudo bloquear la cuenta.");
    }
    if (usuario?.telefono === telBloqueo.trim()) setSalirAlCerrar(true);
    setPantalla("bloqueo-listo");
  };

  const elegirFoto = (e) => {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    if (fotoPreview) URL.revokeObjectURL(fotoPreview);
    setFoto(archivo);
    setFotoPreview(URL.createObjectURL(archivo));
  };

  const enviarRecuperacion = async (e) => {
    e.preventDefault();
    setError("");
    if (!esTelefonoValido(telCuenta.trim())) return setError("El número de la cuenta debe tener 9 dígitos y empezar con 9.");
    if (!nombre.trim()) return setError("Ingresa tu nombre completo.");
    if (!/^\d{8}$/.test(dni.trim())) return setError("El DNI debe tener 8 dígitos.");
    if (!foto) return setError("La foto sosteniendo tu DNI es obligatoria.");
    if (!razon) return setError("Elige qué pasó con tu cuenta.");
    if (razon === OTROS && !comentario.trim()) return setError("Cuéntanos qué pasó con tu cuenta.");
    if (!esTelefonoValido(telRecuperacion.trim())) {
      return setError("El número de recuperación debe tener 9 dígitos y empezar con 9.");
    }

    setCargando(true);
    const subida = await subirFotoRecuperacion(foto);
    if (subida.error) {
      setCargando(false);
      return setError("No se pudo subir la foto. Intenta de nuevo.");
    }
    const { data, error: rpcError } = await supabase.rpc("taxi_pedir_recuperacion", {
      p_telefono: telCuenta.trim(),
      p_nombre: nombre.trim(),
      p_dni: dni.trim(),
      p_telefono_recuperacion: telRecuperacion.trim(),
      p_comentario: razon === OTROS ? `Otros: ${comentario.trim()}` : razon,
      p_foto: subida.valor,
    });
    setCargando(false);
    if (rpcError) return setError("No se pudo enviar tu solicitud. Intenta de nuevo.");
    if (data?.estado !== "enviada") {
      return setError(MENSAJES_RECUPERACION[data?.estado] || "No se pudo enviar tu solicitud.");
    }
    setPantalla("recuperar-listo");
  };

  const volver = (
    <button type="button" className="tz-metodo-pago-change" style={botonFila} onClick={() => ir("menu")}>
      <ArrowLeft size={13} /> Volver
    </button>
  );

  return createPortal(
      <div className="tz-modal-backdrop">
        <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
          <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>

          {pantalla === "menu" && (
            <>
              <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Headset size={18} /> Soporte
              </h2>
              <div className="tz-soporte-opciones">
                {linkSoporte && (
                  <button
                    type="button"
                    className="tz-soporte-opcion"
                    onClick={() => window.open(linkSoporte, "_blank", "noopener")}
                  >
                    <Headset size={22} color="var(--cyan)" />
                    <span>
                      <strong>Conversar con soporte</strong>
                      <small>Escríbenos por WhatsApp.</small>
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className="tz-soporte-opcion tz-soporte-opcion-peligro"
                  onClick={() => ir("bloqueo")}
                >
                  <ShieldAlert size={22} />
                  <span>
                    <strong>Bloqueo de emergencia</strong>
                    <small>¿Te robaron el celular o alguien entró a tu cuenta? Bloquéala ya.</small>
                  </span>
                </button>
                <button type="button" className="tz-soporte-opcion" onClick={() => ir("recuperar")}>
                  <LifeBuoy size={22} color="var(--green)" />
                  <span>
                    <strong>Recuperar cuenta</strong>
                    <small>Pide al Admin que reactive tu cuenta o te deje elegir un PIN nuevo.</small>
                  </span>
                </button>
              </div>
            </>
          )}

          {pantalla === "bloqueo" && (
            <form onSubmit={continuarBloqueo}>
              <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ShieldAlert size={18} color="var(--danger)" /> Bloqueo de emergencia
              </h2>
              <p className="tz-stock-editor-sub">
                Escribe el celular de tu cuenta y tu PIN. Si te cambiaron el PIN hace menos de 72 horas, también
                sirve el anterior.
              </p>
              <div className="tz-login-field">
                <label className="tz-field-label" htmlFor="sop-bloq-tel">
                  Celular
                </label>
                <input
                  id="sop-bloq-tel"
                  type="tel"
                  inputMode="numeric"
                  maxLength={9}
                  className="tz-text-input"
                  value={telBloqueo}
                  onChange={(e) => setTelBloqueo(e.target.value.replace(/\D/g, ""))}
                  placeholder="987654321"
                />
              </div>
              <div className="tz-login-field">
                <label className="tz-field-label" htmlFor="sop-bloq-pin">
                  PIN
                </label>
                <input
                  id="sop-bloq-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="current-password"
                  className="tz-text-input"
                  value={pinBloqueo}
                  onChange={(e) => setPinBloqueo(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••••"
                />
              </div>
              {error && <p className="tz-error">{error}</p>}
              <button type="submit" className="tz-scan-btn tz-payment-save tz-soporte-boton-peligro">
                <Lock size={16} /> Bloquear mi cuenta
              </button>
              {volver}
            </form>
          )}

          {pantalla === "bloqueo-confirmar" && (
            <>
              <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <ShieldAlert size={18} color="var(--danger)" /> ¿Bloquear tu cuenta?
              </h2>
              <div className="tz-soporte-aviso">
                <p style={{ margin: 0 }}>
                  <strong>Confirma solo si eres el dueño de esta cuenta.</strong>
                </p>
                <p style={{ margin: "8px 0 0" }}>
                  Al bloquearla, nadie podrá entrar a tu cuenta de Taxi-PE ni de Caja Tonazo, se cerrarán las
                  sesiones abiertas y no se podrá cambiar el PIN.
                </p>
                <p style={{ margin: "8px 0 0" }}>
                  Para volver a activarla tendrás que llenar el formulario de <b>Recuperar cuenta</b> y esperar
                  a que el Admin lo apruebe.
                </p>
              </div>
              {error && <p className="tz-error">{error}</p>}
              <button
                type="button"
                className="tz-scan-btn tz-payment-save tz-soporte-boton-peligro"
                disabled={cargando}
                onClick={confirmarBloqueo}
              >
                {cargando ? <Loader2 size={16} className="tz-spin" /> : <Lock size={16} />}
                {cargando ? "Bloqueando…" : "Confirmar bloqueo"}
              </button>
              <button
                type="button"
                className="tz-camera-cancel"
                style={{ width: "100%", marginTop: 10 }}
                disabled={cargando}
                onClick={() => ir("bloqueo")}
              >
                Cancelar
              </button>
            </>
          )}

          {pantalla === "bloqueo-listo" && (
            <div style={{ textAlign: "center", padding: "6px 0" }}>
              <CheckCircle2 size={40} color="var(--green)" style={{ marginBottom: 10 }} />
              <p>Tu cuenta quedó bloqueada. Nadie puede usarla hasta que la recuperes.</p>
              <p className="tz-stock-editor-sub">
                Para reactivarla, llena el formulario de Recuperar cuenta. El Admin revisará tus datos y te
                enviará un código por WhatsApp para que elijas un PIN nuevo.
              </p>
              <button type="button" className="tz-scan-btn tz-payment-save" onClick={() => ir("recuperar")}>
                <LifeBuoy size={16} /> Recuperar cuenta
              </button>
              <button type="button" className="tz-camera-cancel" style={{ width: "100%", marginTop: 10 }} onClick={onClose}>
                Cerrar
              </button>
            </div>
          )}

          {pantalla === "recuperar" && (
            <form onSubmit={enviarRecuperacion}>
              <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <LifeBuoy size={18} color="var(--green)" /> Recuperar cuenta
              </h2>
              <p className="tz-stock-editor-sub">
                El Admin revisará tus datos. Si los aprueba, te enviará un código por WhatsApp al número de
                recuperación para que elijas un PIN nuevo.
              </p>
              <div className="tz-login-field">
                <label className="tz-field-label" htmlFor="sop-rec-tel">
                  Número de tu cuenta
                </label>
                <input
                  id="sop-rec-tel"
                  type="tel"
                  inputMode="numeric"
                  maxLength={9}
                  className="tz-text-input"
                  value={telCuenta}
                  onChange={(e) => setTelCuenta(e.target.value.replace(/\D/g, ""))}
                  placeholder="987654321"
                />
              </div>
              <div className="tz-login-field">
                <label className="tz-field-label" htmlFor="sop-rec-nombre">
                  Nombre completo
                </label>
                <input
                  id="sop-rec-nombre"
                  type="text"
                  className="tz-text-input"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Nombres y apellidos"
                />
              </div>
              <div className="tz-login-field">
                <label className="tz-field-label" htmlFor="sop-rec-dni">
                  DNI
                </label>
                <input
                  id="sop-rec-dni"
                  type="text"
                  inputMode="numeric"
                  maxLength={8}
                  className="tz-text-input"
                  value={dni}
                  onChange={(e) => setDni(e.target.value.replace(/\D/g, ""))}
                  placeholder="12345678"
                />
              </div>
              <div className="tz-login-field">
                <label className="tz-field-label">Foto tuya sosteniendo tu DNI</label>
                <label
                  className="tz-camera-cancel"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    justifyContent: "center",
                    width: "100%",
                    boxSizing: "border-box",
                    margin: 0,
                    cursor: "pointer",
                  }}
                >
                  <Camera size={15} /> {foto ? "Cambiar foto" : "Tomar o subir foto"}
                  <input type="file" accept="image/*" capture="user" onChange={elegirFoto} style={{ display: "none" }} />
                </label>
                {fotoPreview && <img src={fotoPreview} alt="Tu foto con tu DNI" className="tz-soporte-foto" />}
                <p className="tz-camera-note" style={{ margin: "4px 0 0" }}>
                  Solo la ve el Admin y se borra al resolver tu solicitud.
                </p>
              </div>
              <div className="tz-login-field">
                <label className="tz-field-label">¿Qué pasó con tu cuenta?</label>
                <div className="tz-soporte-razones">
                  {[...RAZONES, OTROS].map((r) => (
                    <button
                      key={r}
                      type="button"
                      className={`tz-gasto-tipo-btn ${razon === r ? "tz-gasto-tipo-active" : ""}`}
                      onClick={() => setRazon(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                {razon === OTROS && (
                  <textarea
                    id="sop-rec-comentario"
                    className="tz-text-input"
                    rows={3}
                    maxLength={1000}
                    autoFocus
                    value={comentario}
                    onChange={(e) => setComentario(e.target.value)}
                    placeholder="Cuéntanos qué pasó con tu cuenta."
                    style={{ resize: "vertical", marginTop: 8, boxSizing: "border-box" }}
                  />
                )}
              </div>
              <div className="tz-login-field">
                <label className="tz-field-label" htmlFor="sop-rec-tel2">
                  Número de recuperación
                </label>
                <input
                  id="sop-rec-tel2"
                  type="tel"
                  inputMode="numeric"
                  maxLength={9}
                  className="tz-text-input"
                  value={telRecuperacion}
                  onChange={(e) => setTelRecuperacion(e.target.value.replace(/\D/g, ""))}
                  placeholder="987654321"
                />
                <p className="tz-camera-note" style={{ margin: "4px 0 0" }}>
                  Un WhatsApp al que tengas acceso ahora: ahí te llegará el código. Puede ser el mismo de tu cuenta.
                </p>
              </div>
              {error && <p className="tz-error">{error}</p>}
              <button type="submit" className="tz-scan-btn tz-payment-save" disabled={cargando}>
                {cargando ? <Loader2 size={16} className="tz-spin" /> : <Send size={16} />}
                {cargando ? "Enviando…" : "Enviar solicitud"}
              </button>
              {volver}
            </form>
          )}

          {pantalla === "recuperar-listo" && (
            <div style={{ textAlign: "center", padding: "6px 0" }}>
              <CheckCircle2 size={40} color="var(--green)" style={{ marginBottom: 10 }} />
              <p>Solicitud enviada.</p>
              <p className="tz-stock-editor-sub">
                Si el Admin la aprueba, te llegará un código por WhatsApp al número de recuperación con el enlace
                para elegir tu PIN nuevo. El código vence a los 30 minutos.
              </p>
              <button type="button" className="tz-scan-btn tz-payment-save" onClick={onClose}>
                Cerrar
              </button>
            </div>
          )}
        </div>
      </div>,
    document.body
  );
}
