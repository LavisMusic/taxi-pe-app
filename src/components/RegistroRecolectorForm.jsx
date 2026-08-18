import { useState } from "react";
import { Save, Loader2, Camera, Check } from "lucide-react";
import GestionImagenModal from "./admin/GestionImagenModal";
import { esNombreCompletoValido, esTelefonoValido } from "../lib/taxiEnums";

// Los CAMPOS del auto-registro de Recolector, sin el "chrome" de modal
// — reusado tanto por RegistroRecolectorModal.jsx (standalone) como por
// el modal dual de acceso de la Home (AccesoRecolectorModal.jsx,
// pestaña "Registrarse"). Mucho más corto que el de Conductor: sin
// fotos vehiculares, solo la foto de perfil (obligatoria acá, es el
// único dato visual que el Admin tiene para reconocerlo antes de
// aprobarlo). Cae en el Centro de Peticiones
// (usuarios.estado_cuenta='pendiente', ver useCrearRecolectorPendiente).
export default function RegistroRecolectorForm({ crearRecolector, onClose, onCreated }) {
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [dni, setDni] = useState("");
  const [fotoUrl, setFotoUrl] = useState("");
  const [gestionandoFoto, setGestionandoFoto] = useState(false);
  const [fotoKey] = useState(() => `recolector-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!esNombreCompletoValido(nombre)) {
      setError("Escribe el nombre completo (nombre y apellido), ej. \"Daniela Rivas\".");
      return;
    }
    if (!esTelefonoValido(telefono)) {
      setError("Ingresa un celular válido: 9 dígitos, empieza con 9 (ej. 987654321).");
      return;
    }
    if (!/^\d{8}$/.test(dni.trim())) {
      setError("El DNI debe tener 8 dígitos.");
      return;
    }
    if (!fotoUrl) {
      setError("La foto de perfil es obligatoria.");
      return;
    }

    setSaving(true);
    const { error: createError, message, usuario } = await crearRecolector({
      nombre: nombre.trim(),
      telefono: telefono.trim(),
      dni: dni.trim(),
      fotoUrl,
    });
    setSaving(false);
    if (createError) {
      setError(message || "No se pudo enviar tu solicitud.");
      return;
    }
    onCreated?.(usuario);
    onClose();
  };

  return (
    <>
      <p className="tz-stock-editor-sub">
        Tu solicitud queda pendiente hasta que el Admin la revise en el Centro de Peticiones. El PIN de
        acceso se crea en tu primer login, no acá.
      </p>

      <form onSubmit={handleSubmit}>
        <label className="tz-field-label">Nombre Completo</label>
        <input
          type="text"
          autoFocus
          className="tz-text-input"
          placeholder="Nombre y apellido"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />

        <label className="tz-field-label">Teléfono</label>
        <input
          type="tel"
          inputMode="numeric"
          maxLength={9}
          className="tz-text-input"
          placeholder="987654321"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
        />
        <p className="tz-camera-note" style={{ margin: "2px 0 0" }}>
          Debe ser un número real con WhatsApp para la verificación.
        </p>

        <label className="tz-field-label">DNI</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={8}
          className="tz-text-input"
          placeholder="12345678"
          value={dni}
          onChange={(e) => setDni(e.target.value)}
        />

        <label className="tz-field-label">Foto de Perfil (obligatoria)</label>
        <button
          type="button"
          className="tz-camera-cancel"
          style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}
          onClick={() => setGestionandoFoto(true)}
        >
          {fotoUrl ? (
            <>
              <img
                src={fotoUrl}
                alt="Foto de perfil elegida"
                style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover" }}
              />
              Cambiar foto
              <Check size={15} color="var(--green)" />
            </>
          ) : (
            <>
              <Camera size={15} />
              Gestionar foto de perfil
            </>
          )}
        </button>

        {error && <p className="tz-error">{error}</p>}
        <button type="submit" className="tz-scan-btn tz-payment-save" disabled={saving} style={{ marginTop: 10 }}>
          {saving ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
          {saving ? "Enviando…" : "Enviar solicitud"}
        </button>
      </form>

      {gestionandoFoto && (
        <GestionImagenModal
          nombre={nombre.trim() || "Nuevo recolector"}
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
