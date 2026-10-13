import { useState } from "react";
import { ShieldCheck, Camera, Check, Loader2 } from "lucide-react";
import Dropdown from "./Dropdown";
import GestionImagenModal from "./admin/GestionImagenModal";
import ImagenGuardada from "./ImagenGuardada";
import { supabase } from "../supabaseClient";
import { guardarDatosVerificacion } from "../hooks/useConductorTemporal";
import { esEdadValida, SEXOS, ESTADO_VERIFICACION_EN_REVISION } from "../lib/taxiEnums";

// Verificación de cuenta del RECOLECTOR (desde su panel, después del
// registro exprés): como la del conductor (VerificarConductorForm.jsx)
// pero sin placa ni fotos del vehículo — edad, sexo, DNI, una foto suya
// sosteniendo su DNI y, opcional, su RUC. La cuenta queda 'en_revision':
// sigue usando la app, pero recarga recién cuando el Admin la aprueba en
// el Centro de Peticiones. Llama a `onVerificado(usuario)` al terminar.
export default function VerificarRecolectorForm({ usuario, onVerificado, submitLabel = "Enviar verificación" }) {
  const [edad, setEdad] = useState("");
  const [sexo, setSexo] = useState("");
  const [dni, setDni] = useState("");
  const [ruc, setRuc] = useState("");
  // Foto con el DNI: privada (solo la ve el Admin). Foto de perfil:
  // opcional y pública (la ven pasajeros y conductores).
  const [fotoDniUrl, setFotoDniUrl] = useState("");
  const [fotoPerfilUrl, setFotoPerfilUrl] = useState(usuario.foto_url ?? "");
  const [gestionandoFoto, setGestionandoFoto] = useState(null);
  const [fotoKey] = useState(() => `recolector-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  const [nuevoPin, setNuevoPin] = useState("");
  const [confirmarNuevoPin, setConfirmarNuevoPin] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  // El PIN solo si la cuenta todavía no tiene uno (cuentas exprés antiguas).
  const tienePin = !!usuario.pin;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!esEdadValida(edad)) return setError("Ingresa una edad válida (18 a 90 años).");
    if (!sexo) return setError("Selecciona tu sexo.");
    if (!/^\d{8}$/.test(dni.trim())) return setError("El DNI debe tener 8 dígitos.");
    if (ruc.trim() && !/^\d{11}$/.test(ruc.trim())) return setError("El RUC debe tener 11 dígitos (o déjalo vacío).");
    if (!fotoDniUrl) return setError("La foto sosteniendo tu DNI es obligatoria.");
    if (!tienePin) {
      if (!/^\d{6}$/.test(nuevoPin)) return setError("El PIN debe tener 6 dígitos.");
      if (nuevoPin !== confirmarNuevoPin) return setError("Los PIN no coinciden.");
    }

    setEnviando(true);
    const { data: dniExistente } = await supabase.rpc("taxi_existe_cuenta", { p_dni: dni.trim(), p_excluir: usuario.id });
    if (dniExistente) {
      setEnviando(false);
      return setError("Ya existe una cuenta con ese DNI.");
    }
    const { usuario: actualizado, error: guardarError } = await guardarDatosVerificacion(usuario.id, tienePin ? null : nuevoPin, {
      edad: Number(edad),
      sexo,
      dni: dni.trim(),
      ruc: ruc.trim() || null,
      foto_dni_url: fotoDniUrl,
      ...(fotoPerfilUrl ? { foto_url: fotoPerfilUrl } : {}),
      estado_verificacion: ESTADO_VERIFICACION_EN_REVISION,
    });
    setEnviando(false);
    if (guardarError || !actualizado) {
      return setError(
        guardarError?.message === "dni_duplicado"
          ? "Ya existe una cuenta con ese DNI."
          : guardarError?.message === "ruc_invalido"
            ? "El RUC debe tener 11 dígitos (o déjalo vacío)."
            : "No se pudo guardar tu verificación. Intenta de nuevo."
      );
    }
    onVerificado(actualizado);
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        <p className="tz-stock-editor-sub">
          Hola, {usuario.nombre} — completa esto para verificar tu cuenta. Puedes seguir usando la app mientras el
          Admin la revisa. Si no verificas tu cuenta en 7 días, se eliminará.
        </p>
        <label className="tz-field-label" htmlFor="verif-rec-edad">
          Edad
        </label>
        <input
          id="verif-rec-edad"
          type="number"
          inputMode="numeric"
          min={18}
          max={90}
          autoFocus
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

        <label className="tz-field-label">Foto tuya sosteniendo tu DNI (obligatoria)</label>
        <button
          type="button"
          className="tz-camera-cancel"
          style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", width: "100%" }}
          onClick={() => setGestionandoFoto("dni")}
        >
          {fotoDniUrl ? (
            <>
              <ImagenGuardada src={fotoDniUrl} alt="Tu foto con tu DNI" style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover" }} />
              Cambiar foto
              <Check size={15} color="var(--green)" />
            </>
          ) : (
            <>
              <Camera size={15} /> Tomar o subir tu foto con tu DNI
            </>
          )}
        </button>
        <p className="tz-camera-note" style={{ margin: "2px 0 0" }}>
          Solo la ve el Admin para verificar tu cuenta.
        </p>

        <label className="tz-field-label">Foto de perfil (opcional)</label>
        <button
          type="button"
          className="tz-camera-cancel"
          style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", width: "100%" }}
          onClick={() => setGestionandoFoto("perfil")}
        >
          {fotoPerfilUrl ? (
            <>
              <ImagenGuardada src={fotoPerfilUrl} alt="Tu foto de perfil" style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover" }} />
              Cambiar foto de perfil
              <Check size={15} color="var(--green)" />
            </>
          ) : (
            <>
              <Camera size={15} /> Tomar o subir tu foto de perfil
            </>
          )}
        </button>

        {!tienePin && (
          <>
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
          </>
        )}

        {error && <p className="tz-error">{error}</p>}
        <button type="submit" className="tz-scan-btn tz-payment-save" disabled={enviando} style={{ marginTop: 10 }}>
          {enviando ? <Loader2 size={16} className="tz-spin" /> : <ShieldCheck size={16} />}
          {enviando ? "Guardando…" : submitLabel}
        </button>
      </form>

      {gestionandoFoto && (
        <GestionImagenModal
          nombre={`${usuario.nombre} — ${gestionandoFoto === "dni" ? "Foto con su DNI" : "Foto de perfil"}`}
          fotoUrl={gestionandoFoto === "dni" ? fotoDniUrl : fotoPerfilUrl}
          storageKey={`${fotoKey}-${gestionandoFoto}`}
          isProfilePic={gestionandoFoto === "perfil"}
          privado={gestionandoFoto === "dni"}
          onFotoUrlChange={(url) => (gestionandoFoto === "dni" ? setFotoDniUrl(url) : setFotoPerfilUrl(url))}
          onClose={() => setGestionandoFoto(null)}
        />
      )}
    </>
  );
}
