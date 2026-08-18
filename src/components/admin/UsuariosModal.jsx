import { useState } from "react";
import { Users, Plus, Save, Pencil, Trash2, X, Loader2, Image as ImageIcon } from "lucide-react";
import { formatTelefono } from "../../utils/format";
import { esTelefonoValido } from "../../lib/taxiEnums";
import RegistroConductorModal from "../recolector/RegistroConductorModal";
import GestionImagenModal from "./GestionImagenModal";

const TABS = [
  { rol: "conductor", label: "Conductores", singular: "Conductor" },
  { rol: "pasajero", label: "Pasajeros", singular: "Pasajero" },
  { rol: "recolector", label: "Recolectores", singular: "Recolector" },
];

// Fila de un usuario con edición inline (lápiz → inputs → guardar),
// mismo patrón que ConductorCard en el Directorio. Solo edita
// `usuarios` (nombre/dni/teléfono de login) — los datos operativos de
// un conductor (placa/categoría/estado) se editan en el Directorio.
function UsuarioRow({ usuario, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [nombre, setNombre] = useState(usuario.nombre);
  const [telefono, setTelefono] = useState(usuario.telefono);
  const [dni, setDni] = useState(usuario.dni);
  const [nuevoPin, setNuevoPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [borrando, setBorrando] = useState(false);
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false);

  const startEdit = () => {
    setNombre(usuario.nombre);
    setTelefono(usuario.telefono);
    setDni(usuario.dni);
    setNuevoPin("");
    setError("");
    setEditing(true);
  };

  const guardar = async () => {
    if (!nombre.trim() || !/^\d{8}$/.test(dni) || !esTelefonoValido(telefono)) {
      setError("Nombre, DNI (8 dígitos) y celular válido (9 dígitos, empieza con 9) son obligatorios.");
      return;
    }
    if (nuevoPin && !/^\d{6}$/.test(nuevoPin)) {
      setError("El nuevo PIN debe tener 6 dígitos.");
      return;
    }
    setSaving(true);
    setError("");
    const patch = {
      nombre: nombre.trim(),
      telefono: telefono.trim(),
      dni: dni.trim(),
    };
    if (nuevoPin) patch.pin = nuevoPin;
    const { error: saveError } = await onUpdate(usuario.id, patch);
    setSaving(false);
    if (saveError) {
      // Mensaje real del hook (duplicado excluyendo esta misma fila, 0
      // filas por RLS, etc.) en vez de una adivinanza genérica — así se
      // ve la causa real en vez de siempre culpar a un "duplicado".
      setError(saveError.message || "No se pudo guardar.");
      return;
    }
    setEditing(false);
  };

  const eliminar = async () => {
    setBorrando(true);
    await onDelete(usuario.id);
    setBorrando(false);
  };

  if (editing) {
    return (
      <li className="tz-history-row">
        <div className="tz-history-row-detail" style={{ padding: 12 }}>
          <div className="tz-add-entry" style={{ padding: 0 }}>
            <input type="text" className="tz-text-input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" />
            <input type="text" inputMode="numeric" maxLength={8} className="tz-text-input" value={dni} onChange={(e) => setDni(e.target.value)} placeholder="DNI" />
            <input type="text" inputMode="numeric" maxLength={9} className="tz-text-input" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="987654321" />
            <label className="tz-field-label">Nuevo PIN (opcional — deja vacío para no cambiarlo)</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              className="tz-text-input"
              value={nuevoPin}
              onChange={(e) => setNuevoPin(e.target.value)}
              placeholder="••••••"
            />
            {error && <p className="tz-error">{error}</p>}
            <div className="tz-add-entry-actions">
              <button className="tz-camera-cancel" onClick={() => setEditing(false)} disabled={saving}>
                Cancelar
              </button>
              <button className="tz-pw-submit tz-payment-save" onClick={guardar} disabled={saving}>
                {saving ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      </li>
    );
  }

  if (confirmandoBorrado) {
    return (
      <li className="tz-history-row">
        <div className="tz-vis-confirm-delete">
          <p>
            ¿Eliminar la cuenta de <strong>{usuario.nombre}</strong> definitivamente?
          </p>
          <div className="tz-vis-confirm-actions">
            <button
              type="button"
              className="tz-cliente-action-btn tz-cliente-action-deuda"
              onClick={eliminar}
              disabled={borrando}
            >
              {borrando ? <Loader2 size={13} className="tz-spin" /> : <Trash2 size={13} />}
              Sí, eliminar
            </button>
            <button
              type="button"
              className="tz-cliente-action-btn"
              onClick={() => setConfirmandoBorrado(false)}
              disabled={borrando}
            >
              <X size={13} /> Cancelar
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="tz-history-row">
      <div className="tz-history-row-detail" style={{ padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <span>
          <strong style={{ color: "var(--text)" }}>{usuario.nombre}</strong>
          <span style={{ marginLeft: 8 }}>DNI {usuario.dni} · {formatTelefono(usuario.telefono)}</span>
        </span>
        <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" className="tz-vis-edit-btn" onClick={startEdit} aria-label="Editar usuario" title="Editar">
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className="tz-vis-delete-btn"
            onClick={() => setConfirmandoBorrado(true)}
            aria-label="Eliminar usuario"
            title="Eliminar"
          >
            <Trash2 size={14} />
          </button>
        </span>
      </div>
    </li>
  );
}

// Tab "Conductores" ya NO tiene su propio mini-form (placa/categoría
// sueltos, sin fotos) — abre el mismo RegistroConductorModal que usan
// Recolector y el auto-registro, con requiereLogin+aprobado=true: crea
// login + perfil juntos, con las 3 fotos de verificación, y entra
// operativo de una (no pasa por el Centro de Peticiones).
export default function UsuariosModal({
  usuarios,
  categorias,
  subgrupos,
  crearUsuario,
  actualizarUsuario,
  eliminarUsuario,
  crearConductorConUsuario,
  onClose,
}) {
  const [tab, setTab] = useState("conductor");
  const [addOpen, setAddOpen] = useState(false);
  const [registroConductorOpen, setRegistroConductorOpen] = useState(false);
  const [dni, setDni] = useState("");
  const [telefono, setTelefono] = useState("");
  const [nombre, setNombre] = useState("");
  const [fotoUrl, setFotoUrl] = useState("");
  const [gestionandoFoto, setGestionandoFoto] = useState(false);
  const [tempStorageKey] = useState(() => `nuevo-usuario-${Date.now()}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [creadoMsg, setCreadoMsg] = useState("");

  const usuariosDelTab = usuarios.filter((u) => u.rol === tab);
  const esConductor = tab === "conductor";

  const resetForm = () => {
    setAddOpen(false);
    setDni("");
    setTelefono("");
    setNombre("");
    setFotoUrl("");
    setError("");
  };

  // Sin PIN acá — nace en NULL a propósito (ver useUsuarios.js): la
  // persona lo crea sola en su primer login, el Admin ya no
  // inventa/tipea una contraseña por ella.
  const handleCrear = async () => {
    if (!nombre.trim()) {
      setError("Ingresa el nombre.");
      return;
    }
    if (!/^\d{8}$/.test(dni)) {
      setError("El DNI debe tener 8 dígitos.");
      return;
    }
    if (!esTelefonoValido(telefono)) {
      setError("Ingresa un celular válido: 9 dígitos, empieza con 9 (ej. 987654321).");
      return;
    }

    setSaving(true);
    setError("");
    const { error: createError, message } = await crearUsuario({
      dni: dni.trim(),
      telefono: telefono.trim(),
      nombre: nombre.trim(),
      rol: tab,
      fotoUrl,
    });
    setSaving(false);
    if (createError) {
      setError(message || createError.message || "No se pudo crear la cuenta.");
      return;
    }
    resetForm();
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Users size={17} /> Usuarios
          </h2>

          <div className="tz-gasto-tipo-buttons" style={{ marginBottom: 14 }}>
            {TABS.map((t) => (
              <button
                key={t.rol}
                type="button"
                className={`tz-gasto-tipo-btn ${tab === t.rol ? "tz-gasto-tipo-active" : ""}`}
                onClick={() => {
                  setTab(t.rol);
                  resetForm();
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {creadoMsg && <p className="tz-success">{creadoMsg}</p>}

          {esConductor ? (
            <>
              <p className="tz-stock-editor-sub">
                Crea su acceso (login) y su perfil operativo (placa/categoría/fotos) a la vez. Queda
                aprobado y operativo de una — no pasa por el Centro de Peticiones.
              </p>
              <button className="tz-scan-btn tz-add-entry-toggle" onClick={() => setRegistroConductorOpen(true)}>
                <Plus size={16} /> Añadir nuevo Conductor
              </button>
            </>
          ) : !addOpen ? (
            <button className="tz-scan-btn tz-add-entry-toggle" onClick={() => setAddOpen(true)}>
              <Plus size={16} /> Añadir nuevo {TABS.find((t) => t.rol === tab)?.singular}
            </button>
          ) : (
            <div className="tz-add-entry">
              <label className="tz-field-label">Nombre</label>
              <input type="text" className="tz-text-input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre completo" />
              <label className="tz-field-label">DNI</label>
              <input type="text" inputMode="numeric" maxLength={8} className="tz-text-input" value={dni} onChange={(e) => setDni(e.target.value)} placeholder="12345678" />
              <label className="tz-field-label">Teléfono</label>
              <input type="tel" inputMode="numeric" maxLength={9} className="tz-text-input" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="987654321" />
              <p className="tz-camera-note" style={{ margin: "-6px 0 0" }}>
                Debe ser un número real con WhatsApp para la verificación.
              </p>
              <label className="tz-field-label">Foto (opcional)</label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {fotoUrl ? (
                  <img src={fotoUrl} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover" }} />
                ) : (
                  <div className="tz-peticion-foto-placeholder" style={{ width: 44, height: 44, flexShrink: 0 }}>
                    <ImageIcon size={16} />
                  </div>
                )}
                <button
                  type="button"
                  className="tz-camera-cancel tz-image-manager-btn"
                  style={{ flex: "0 0 auto" }}
                  onClick={() => setGestionandoFoto(true)}
                >
                  {fotoUrl ? "Cambiar foto" : "Agregar foto"}
                </button>
              </div>
              <p className="tz-camera-note" style={{ margin: "-4px 0 0" }}>
                Sin PIN — la persona crea el suyo en su primer ingreso.
              </p>

              {error && <p className="tz-error">{error}</p>}
              <div className="tz-add-entry-actions">
                <button className="tz-camera-cancel" onClick={resetForm}>
                  Cancelar
                </button>
                <button className="tz-pw-submit tz-payment-save" onClick={handleCrear} disabled={saving}>
                  {saving ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
                  Crear cuenta
                </button>
              </div>
            </div>
          )}

          {usuariosDelTab.length === 0 ? (
            <p className="tz-method-history-empty">No hay cuentas con este rol todavía.</p>
          ) : (
            <ul className="tz-history-rows">
              {usuariosDelTab.map((u) => (
                <UsuarioRow key={u.id} usuario={u} onUpdate={actualizarUsuario} onDelete={eliminarUsuario} />
              ))}
            </ul>
          )}
        </div>
      </div>

      {gestionandoFoto && (
        <GestionImagenModal
          nombre={nombre || "Nuevo usuario"}
          fotoUrl={fotoUrl}
          storageKey={tempStorageKey}
          isProfilePic
          onFotoUrlChange={(url) => setFotoUrl(url)}
          onClose={() => setGestionandoFoto(false)}
        />
      )}

      {registroConductorOpen && (
        <RegistroConductorModal
          categorias={categorias}
          subgrupos={subgrupos}
          crearConductorConUsuario={crearConductorConUsuario}
          requiereLogin
          aprobado
          onClose={() => setRegistroConductorOpen(false)}
          onCreated={(nombreCreado) => {
            setCreadoMsg(`${nombreCreado} fue registrado y ya está operativo.`);
            setTimeout(() => setCreadoMsg(""), 4000);
          }}
        />
      )}
    </div>
  );
}
