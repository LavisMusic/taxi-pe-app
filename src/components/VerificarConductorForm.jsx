import { useState } from "react";
import { ShieldCheck, Camera, Check } from "lucide-react";
import Dropdown from "./Dropdown";
import GestionImagenModal from "./admin/GestionImagenModal";
import { useConductorTemporal } from "../hooks/useConductorTemporal";
import { esEdadValida, SEXOS } from "../lib/taxiEnums";

// Las mismas 3 fotos obligatorias que RegistroConductorForm.jsx (mismo
// criterio: sin "Mejorar con IA", son evidencia que revisa el Admin).
const FOTOS_REQUERIDAS = [
  {
    key: "fotoGeneralUrl",
    label: "Toma General",
    ayuda: "Debe verse claramente la placa o el número pintado a los costados del vehículo.",
    slug: "general",
  },
  { key: "fotoInteriorUrl", label: "Toma del Interior", ayuda: "", slug: "interior" },
  { key: "fotoConductorDniUrl", label: "Foto tuya", ayuda: "", slug: "conductor" },
];

// Paso 2 del registro exprés de Conductor: completa apellido/edad/sexo/
// DNI/placa/fotos/PIN de la cuenta 'temporal' (nombre+teléfono nomás)
// creada por RegistroConductorTemporalForm.jsx. Reusado en dos
// lugares: StaffLoginForm.jsx (lo ve quien todavía no inició sesión,
// al loguearse por teléfono) y ConductorPage.jsx (lo ve quien ya está
// adentro con la cuenta temporal y quiere completar sus datos sin
// tener que cerrar sesión primero) — por eso no asume login propio,
// solo llama a `onVerificado(usuario)` cuando termina.
export default function VerificarConductorForm({ usuario, onVerificado, submitLabel = "Enviar verificación" }) {
  const { verificarCuenta, loading } = useConductorTemporal();
  const [apellido, setApellido] = useState("");
  const [edad, setEdad] = useState("");
  const [sexo, setSexo] = useState("");
  const [dni, setDni] = useState("");
  const [placa, setPlaca] = useState("");
  const [fotos, setFotos] = useState({ fotoGeneralUrl: "", fotoInteriorUrl: "", fotoConductorDniUrl: "" });
  const [gestionandoFoto, setGestionandoFoto] = useState(null);
  const [fotoKey] = useState(() => `conductor-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  const [nuevoPin, setNuevoPin] = useState("");
  const [confirmarNuevoPin, setConfirmarNuevoPin] = useState("");
  const [error, setError] = useState("");

  const faltanFotos = FOTOS_REQUERIDAS.some((f) => !fotos[f.key]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!apellido.trim()) {
      setError("Ingresa tu apellido.");
      return;
    }
    if (!esEdadValida(edad)) {
      setError("Ingresa una edad válida (18 a 90 años).");
      return;
    }
    if (!sexo) {
      setError("Selecciona tu sexo.");
      return;
    }
    if (!/^\d{8}$/.test(dni.trim())) {
      setError("El DNI debe tener 8 dígitos.");
      return;
    }
    if (!placa.trim()) {
      setError("La placa es obligatoria.");
      return;
    }
    if (faltanFotos) {
      setError("Las 3 fotos (vehículo por fuera, por dentro y una tuya) son obligatorias.");
      return;
    }
    if (!/^\d{6}$/.test(nuevoPin)) {
      setError("El PIN debe tener 6 dígitos.");
      return;
    }
    if (nuevoPin !== confirmarNuevoPin) {
      setError("Los PIN no coinciden.");
      return;
    }

    const { usuario: actualizado, message } = await verificarCuenta({
      usuarioId: usuario.id,
      telefono: usuario.telefono,
      nombre: usuario.nombre,
      apellido: apellido.trim(),
      edad: Number(edad),
      sexo,
      dni: dni.trim(),
      placa: placa.trim().toUpperCase(),
      ...fotos,
      pin: nuevoPin,
    });
    if (!actualizado) {
      setError(message);
      return;
    }
    onVerificado(actualizado);
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        <p className="tz-stock-editor-sub">
          Hola, {usuario.nombre} — completa esto para que tu cuenta deje de ser temporal (queda pendiente de
          revisión del Admin).
        </p>
        <label className="tz-field-label" htmlFor="verif-apellido">
          Apellido
        </label>
        <input
          id="verif-apellido"
          type="text"
          autoFocus
          className="tz-text-input"
          value={apellido}
          onChange={(e) => setApellido(e.target.value)}
          placeholder="Apellido"
        />

        <label className="tz-field-label" htmlFor="verif-edad">
          Edad
        </label>
        <input
          id="verif-edad"
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

        <label className="tz-field-label" htmlFor="verif-dni">
          DNI
        </label>
        <input
          id="verif-dni"
          type="text"
          inputMode="numeric"
          maxLength={8}
          className="tz-text-input"
          value={dni}
          onChange={(e) => setDni(e.target.value)}
          placeholder="12345678"
        />

        <label className="tz-field-label" htmlFor="verif-placa">
          Placa
        </label>
        <input
          id="verif-placa"
          type="text"
          className="tz-text-input"
          value={placa}
          onChange={(e) => setPlaca(e.target.value)}
          placeholder="ABC-123"
        />

        <label className="tz-field-label">Fotos (obligatorias, sin editar)</label>
        <div className="tz-vis-accordion" style={{ gap: 6 }}>
          {FOTOS_REQUERIDAS.map((f) => (
            <div key={f.key}>
              <button
                type="button"
                className="tz-camera-cancel"
                style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", width: "100%" }}
                onClick={() => setGestionandoFoto(f)}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {fotos[f.key] ? (
                    <img
                      src={fotos[f.key]}
                      alt={f.label}
                      style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover" }}
                    />
                  ) : (
                    <Camera size={15} />
                  )}
                  {f.label}
                </span>
                {fotos[f.key] ? <Check size={15} color="var(--green)" /> : null}
              </button>
              {f.ayuda && (
                <p className="tz-camera-note" style={{ margin: "2px 0 0" }}>
                  {f.ayuda}
                </p>
              )}
            </div>
          ))}
        </div>

        <label className="tz-field-label" htmlFor="verif-pin">
          Crea tu PIN (6 dígitos)
        </label>
        <input
          id="verif-pin"
          type="password"
          inputMode="numeric"
          maxLength={6}
          className="tz-text-input"
          value={nuevoPin}
          onChange={(e) => setNuevoPin(e.target.value)}
          placeholder="••••••"
        />

        <label className="tz-field-label" htmlFor="verif-pin-confirm">
          Confirma tu PIN
        </label>
        <input
          id="verif-pin-confirm"
          type="password"
          inputMode="numeric"
          maxLength={6}
          className="tz-text-input"
          value={confirmarNuevoPin}
          onChange={(e) => setConfirmarNuevoPin(e.target.value)}
          placeholder="••••••"
        />

        {error && <p className="tz-error">{error}</p>}
        <button type="submit" className="tz-scan-btn tz-payment-save" disabled={loading} style={{ marginTop: 10 }}>
          <ShieldCheck size={16} />
          {loading ? "Guardando…" : submitLabel}
        </button>
      </form>

      {gestionandoFoto && (
        <GestionImagenModal
          nombre={`${usuario.nombre} — ${gestionandoFoto.label}`}
          fotoUrl={fotos[gestionandoFoto.key]}
          storageKey={`${fotoKey}-${gestionandoFoto.slug}`}
          isProfilePic={false}
          onFotoUrlChange={(url) => setFotos((prev) => ({ ...prev, [gestionandoFoto.key]: url }))}
          onClose={() => setGestionandoFoto(null)}
        />
      )}
    </>
  );
}
