import { useState } from "react";
import { X, Phone, Save, Loader2 } from "lucide-react";

// Modal chico para cambiar el número de teléfono del Conductor (pedido:
// nueva opción del menú "Editar Perfil", ver ConductorPage.jsx). El
// teléfono es el puente de login entre `usuarios` y `conductores` (ver
// useConductorSesion.js `cambiarTelefono`), así que este modal es
// genérico a propósito (no sabe nada de esas dos tablas) — solo pide el
// número nuevo y delega el guardado real a `onGuardar`.
export default function CambiarTelefonoModal({ telefonoActual, onGuardar, onClose }) {
  const [telefono, setTelefono] = useState(telefonoActual || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    const { error: saveError } = await onGuardar(telefono.trim());
    setSaving(false);
    if (saveError) {
      setError(saveError.message || "No se pudo actualizar tu teléfono.");
      return;
    }
    onClose();
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Phone size={17} /> Cambiar Teléfono
          </h2>
          <p className="tz-stock-editor-sub">
            Este es el número con el que inicias sesión y con el que te contactan por WhatsApp — asegúrate de
            que sea uno real, al que tengas acceso.
          </p>
          <form onSubmit={handleSubmit}>
            <label className="tz-field-label" htmlFor="cambiar-tel-input">
              Nuevo teléfono
            </label>
            <input
              id="cambiar-tel-input"
              type="tel"
              inputMode="numeric"
              maxLength={9}
              autoFocus
              className="tz-text-input"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="987654321"
            />
            {error && <p className="tz-error">{error}</p>}
            <button type="submit" className="tz-scan-btn tz-payment-save" disabled={saving} style={{ marginTop: 10 }}>
              {saving ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
