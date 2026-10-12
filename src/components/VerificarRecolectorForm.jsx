import { useState } from "react";
import { ShieldCheck, Camera, Check, Loader2 } from "lucide-react";
import Dropdown from "./Dropdown";
import GestionImagenModal from "./admin/GestionImagenModal";
import { crearPin } from "../lib/pinAuth";
import { esEdadValida, SEXOS, ESTADO_VERIFICACION_EN_REVISION } from "../lib/taxiEnums";

// Verificación de cuenta del RECOLECTOR (su primer ingreso, después del
// registro exprés de nombre + teléfono): como la del conductor
// (VerificarConductorForm.jsx) pero sin placa ni fotos del vehículo — solo
// su foto de perfil y, opcional, su RUC. Todo va en UNA operación de la
// base (taxi_crear_pin con los datos) y la cuenta queda 'en_revision':
// no puede usar la app hasta que el Admin la apruebe en el Centro de
// Peticiones. Llama a `onVerificado(usuario)` al terminar.
export default function VerificarRecolectorForm({ usuario, onVerificado, submitLabel = "Enviar verificación" }) {
  const [apellido, setApellido] = useState("");
  const [edad, setEdad] = useState("");
  const [sexo, setSexo] = useState("");
  const [dni, setDni] = useState("");
  const [ruc, setRuc] = useState("");
  const [fotoUrl, setFotoUrl] = useState("");
  const [gestionandoFoto, setGestionandoFoto] = useState(false);
  const [fotoKey] = useState(() => `recolector-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  const [nuevoPin, setNuevoPin] = useState("");
  const [confirmarNuevoPin, setConfirmarNuevoPin] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!apellido.trim()) return setError("Ingresa tu apellido.");
    if (!esEdadValida(edad)) return setError("Ingresa una edad válida (18 a 90 años).");
    if (!sexo) return setError("Selecciona tu sexo.");
    if (!/^\d{8}$/.test(dni.trim())) return setError("El DNI debe tener 8 dígitos.");
    if (ruc.trim() && !/^\d{11}$/.test(ruc.trim())) return setError("El RUC debe tener 11 dígitos (o déjalo vacío).");
    if (!fotoUrl) return setError("Tu foto de perfil es obligatoria.");
    if (!/^\d{6}$/.test(nuevoPin)) return setError("El PIN debe tener 6 dígitos.");
    if (nuevoPin !== confirmarNuevoPin) return setError("Los PIN no coinciden.");

    setEnviando(true);
    let resultado;
    try {
      resultado = await crearPin(usuario.id, nuevoPin, {
        apellido: apellido.trim(),
        edad: Number(edad),
        sexo,
        dni: dni.trim(),
        ruc: ruc.trim() || null,
        foto_url: fotoUrl,
        estado_verificacion: ESTADO_VERIFICACION_EN_REVISION,
      });
    } catch {
      resultado = null;
    }
    setEnviando(false);
    if (resultado?.estado !== "ok") {
      return setError(
        resultado?.estado === "dni_duplicado"
          ? "Ya existe una cuenta con ese DNI."
          : resultado?.estado === "ruc_invalido"
            ? "El RUC debe tener 11 dígitos (o déjalo vacío)."
            : "No se pudo guardar tu verificación. Intenta de nuevo."
      );
    }
    onVerificado(resultado.usuario);
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        <p className="tz-stock-editor-sub">
          Hola, {usuario.nombre} — completa esto para verificar tu cuenta. Podrás usar la app cuando el Admin la
          apruebe.
        </p>
        <label className="tz-field-label" htmlFor="verif-rec-apellido">
          Apellido
        </label>
        <input
          id="verif-rec-apellido"
          type="text"
          autoFocus
          className="tz-text-input"
          value={apellido}
          onChange={(e) => setApellido(e.target.value)}
          placeholder="Apellido"
        />

        <label className="tz-field-label" htmlFor="verif-rec-edad">
          Edad
        </label>
        <input
          id="verif-rec-edad"
          type="number"
          inputMode="numeric"
          min={18}
          max={90}
          className="tz-text-input"
          value={edad}
          onChange={(e) => setEdad(e.target.value)}
          placeholder="25"
        />

        <label className="tz-field-label">Sexo</label>
        <Dropdown value={sexo} onChange={setSexo} options={SEXOS} placeholder="Selecciona" ariaLabel="Sexo" />

        <label className="tz-field-label" htmlFor="verif-rec-dni">
          DNI
        </label>
        <input
          id="verif-rec-dni"
          type="text"
          inputMode="numeric"
          maxLength={8}
          className="tz-text-input"
          value={dni}
          onChange={(e) => setDni(e.target.value)}
          placeholder="12345678"
        />

        <label className="tz-field-label" htmlFor="verif-rec-ruc">
          RUC (opcional)
        </label>
        <input
          id="verif-rec-ruc"
          type="text"
          inputMode="numeric"
          maxLength={11}
          className="tz-text-input"
          value={ruc}
          onChange={(e) => setRuc(e.target.value)}
          placeholder="10123456789"
        />

        <label className="tz-field-label">Foto tuya (obligatoria)</label>
        <button
          type="button"
          className="tz-camera-cancel"
          style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", width: "100%" }}
          onClick={() => setGestionandoFoto(true)}
        >
          {fotoUrl ? (
            <>
              <img src={fotoUrl} alt="Tu foto" style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover" }} />
              Cambiar foto
              <Check size={15} color="var(--green)" />
            </>
          ) : (
            <>
              <Camera size={15} /> Tomar o subir tu foto
            </>
          )}
        </button>

        <label className="tz-field-label" htmlFor="verif-rec-pin">
          Crea tu PIN (6 dígitos)
        </label>
        <input
          id="verif-rec-pin"
          type="password"
          inputMode="numeric"
          maxLength={6}
          className="tz-text-input"
          value={nuevoPin}
          onChange={(e) => setNuevoPin(e.target.value)}
          placeholder="••••••"
        />

        <label className="tz-field-label" htmlFor="verif-rec-pin-confirm">
          Confirma tu PIN
        </label>
        <input
          id="verif-rec-pin-confirm"
          type="password"
          inputMode="numeric"
          maxLength={6}
          className="tz-text-input"
          value={confirmarNuevoPin}
          onChange={(e) => setConfirmarNuevoPin(e.target.value)}
          placeholder="••••••"
        />

        {error && <p className="tz-error">{error}</p>}
        <button type="submit" className="tz-scan-btn tz-payment-save" disabled={enviando} style={{ marginTop: 10 }}>
          {enviando ? <Loader2 size={16} className="tz-spin" /> : <ShieldCheck size={16} />}
          {enviando ? "Guardando…" : submitLabel}
        </button>
      </form>

      {gestionandoFoto && (
        <GestionImagenModal
          nombre={`${usuario.nombre} — Foto tuya`}
          fotoUrl={fotoUrl}
          storageKey={fotoKey}
          isProfilePic
          onFotoUrlChange={(url) => setFotoUrl(url)}
          onClose={() => setGestionandoFoto(false)}
        />
      )}
    </>
  );
}
