import { useState } from "react";
import { Pencil, Save, Loader2, Zap, CreditCard, CalendarClock } from "lucide-react";
import ProductImage from "../ProductImage";
import GestionImagenModal from "./GestionImagenModal";
import { formatDate, formatTelefono } from "../../utils/format";
import { esTelefonoValido } from "../../lib/taxiEnums";

// Tarjeta de un Recolector en el Directorio (categoría fija
// "Recolectores", ver ConductoresDirectorio.jsx) — mismo esqueleto
// visual que ConductorCard, pero sin placa/estado/nivel (no aplican a
// un recolector): foto, Nombre, DNI, Teléfono, y su saldo actual
// (créditos / vencimiento de membresía) en vez de la fila de
// estado/precio. Editar (lápiz) toca solo los datos de `usuarios`
// (nombre/dni/teléfono/foto) — el saldo NUNCA se edita a mano acá, solo
// vía Recarga Rápida (⚡) o aprobando una petición en el Centro de
// Peticiones.
export default function RecolectorCard({ recolector, onUpdate, onRecargar }) {
  const [editing, setEditing] = useState(false);
  const [nombre, setNombre] = useState(recolector.nombre);
  const [dni, setDni] = useState(recolector.dni || "");
  const [telefono, setTelefono] = useState(recolector.telefono || "");
  const [gestionandoFoto, setGestionandoFoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const startEdit = () => {
    setNombre(recolector.nombre);
    setDni(recolector.dni || "");
    setTelefono(recolector.telefono || "");
    setError("");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!nombre.trim() || !/^\d{8}$/.test(dni) || !esTelefonoValido(telefono)) {
      setError("Nombre, DNI (8 dígitos) y celular válido (9 dígitos, empieza con 9) son obligatorios.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: saveError } = await onUpdate(recolector.id, {
      nombre: nombre.trim(),
      dni: dni.trim(),
      telefono: telefono.trim(),
    });
    setSaving(false);
    if (saveError) {
      setError(saveError.message || "No se pudo guardar.");
      return;
    }
    setEditing(false);
  };

  return (
    <div className="tz-card">
      <div className="tz-card-row">
        <ProductImage
          item={{ imagenUrl: recolector.foto_url, name: recolector.nombre }}
          editable
          onManage={() => setGestionandoFoto(true)}
        />
        <div className="tz-card-main">
          <div className="tz-card-top">
            <div className="tz-card-info" style={{ width: "100%" }}>
              {editing ? (
                <div className="tz-vis-inline-edit-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                  <input
                    type="text"
                    className="tz-text-input"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    placeholder="Nombre"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={8}
                    className="tz-text-input"
                    value={dni}
                    onChange={(e) => setDni(e.target.value)}
                    placeholder="DNI"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={9}
                    className="tz-text-input"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    placeholder="987654321"
                  />
                  {error && <p className="tz-error">{error}</p>}
                  <div className="tz-add-entry-actions">
                    <button className="tz-camera-cancel" onClick={() => setEditing(false)} disabled={saving}>
                      Cancelar
                    </button>
                    <button className="tz-pw-submit tz-payment-save" onClick={saveEdit} disabled={saving}>
                      {saving ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
                      Guardar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <h3 className="tz-card-name">{recolector.nombre}</h3>
                    <button
                      type="button"
                      className="tz-vis-edit-btn"
                      onClick={startEdit}
                      aria-label="Editar recolector"
                      title="Editar datos"
                    >
                      <Pencil size={14} />
                    </button>
                    {onRecargar && (
                      <button
                        type="button"
                        className="tz-vis-edit-btn"
                        onClick={() => onRecargar(recolector)}
                        aria-label="Recarga rápida"
                        title="Recarga rápida para este recolector"
                      >
                        <Zap size={14} />
                      </button>
                    )}
                  </div>
                  <p style={{ margin: "2px 0", color: "var(--text-dim)", fontSize: 13 }}>
                    DNI <strong style={{ color: "var(--text)" }}>{recolector.dni || "—"}</strong>
                    {recolector.telefono ? ` · ${formatTelefono(recolector.telefono)}` : ""}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="tz-card-bottom">
            <div className="tz-card-stockrow">
              <span className="tz-tag tz-tag-ok">
                <CreditCard size={12} style={{ verticalAlign: "-2px" }} /> {recolector.creditos_disponibles ?? 0} créditos
              </span>
              {recolector.membresia_vencimiento && (
                <span className="tz-tag tz-tag-warn">
                  <CalendarClock size={12} style={{ verticalAlign: "-2px" }} /> Vence{" "}
                  {formatDate(recolector.membresia_vencimiento)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {gestionandoFoto && (
        <GestionImagenModal
          nombre={recolector.nombre}
          fotoUrl={recolector.foto_url}
          storageKey={recolector.id}
          isProfilePic
          onFotoUrlChange={(url) => onUpdate(recolector.id, { foto_url: url })}
          onClose={() => setGestionandoFoto(false)}
        />
      )}
    </div>
  );
}
