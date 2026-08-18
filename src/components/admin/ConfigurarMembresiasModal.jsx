import { useState } from "react";
import { Settings, Plus, Save, Pencil, Trash2, X, Loader2 } from "lucide-react";
import { formatSoles } from "../../utils/format";
import { TIPO_ITEM_CREDITOS, TIPO_ITEM_MEMBRESIA } from "../../lib/taxiEnums";

const TIPOS = [
  { value: TIPO_ITEM_MEMBRESIA, label: "Membresía" },
  { value: TIPO_ITEM_CREDITOS, label: "Paquete de Créditos" },
];

function PaqueteForm({ initial, onGuardar, onCancelar, saving }) {
  const [tipoItem, setTipoItem] = useState(initial?.tipo_item ?? TIPO_ITEM_MEMBRESIA);
  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  const [precio, setPrecio] = useState(String(initial?.precio ?? ""));
  const [diasMembresia, setDiasMembresia] = useState(String(initial?.dias_membresia ?? "30"));
  const [creditos, setCreditos] = useState(String(initial?.creditos ?? ""));
  const [descripcion, setDescripcion] = useState(initial?.descripcion ?? "");
  const [error, setError] = useState("");

  const handleGuardar = () => {
    if (!nombre.trim()) {
      setError("Ingresa un nombre.");
      return;
    }
    const precioNum = Number(precio);
    if (!precioNum || precioNum <= 0) {
      setError("Ingresa un precio válido.");
      return;
    }
    if (tipoItem === TIPO_ITEM_MEMBRESIA && (!Number(diasMembresia) || Number(diasMembresia) <= 0)) {
      setError("Ingresa los días de vigencia.");
      return;
    }
    if (tipoItem === TIPO_ITEM_CREDITOS && (!Number(creditos) || Number(creditos) <= 0)) {
      setError("Ingresa la cantidad de créditos.");
      return;
    }
    setError("");
    onGuardar({
      tipo_item: tipoItem,
      nombre: nombre.trim(),
      precio: precioNum,
      dias_membresia: tipoItem === TIPO_ITEM_MEMBRESIA ? Number(diasMembresia) : null,
      creditos: tipoItem === TIPO_ITEM_CREDITOS ? Number(creditos) : null,
      descripcion: descripcion.trim(),
    });
  };

  return (
    <div className="tz-add-entry">
      <label className="tz-field-label">Tipo</label>
      <div className="tz-gasto-tipo-buttons">
        {TIPOS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`tz-gasto-tipo-btn ${tipoItem === t.value ? "tz-gasto-tipo-active" : ""}`}
            onClick={() => setTipoItem(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <label className="tz-field-label">Nombre</label>
      <input
        type="text"
        className="tz-text-input"
        placeholder={tipoItem === TIPO_ITEM_MEMBRESIA ? "Ej. Membresía Básica" : "Ej. Paquete 50 créditos"}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
      />

      <label className="tz-field-label">Precio (S/)</label>
      <input type="number" inputMode="decimal" className="tz-text-input" value={precio} onChange={(e) => setPrecio(e.target.value)} />

      {tipoItem === TIPO_ITEM_MEMBRESIA ? (
        <>
          <label className="tz-field-label">Días de vigencia que otorga</label>
          <input type="number" inputMode="numeric" className="tz-text-input" value={diasMembresia} onChange={(e) => setDiasMembresia(e.target.value)} />
        </>
      ) : (
        <>
          <label className="tz-field-label">Créditos que otorga</label>
          <input type="number" inputMode="numeric" className="tz-text-input" value={creditos} onChange={(e) => setCreditos(e.target.value)} />
        </>
      )}

      <label className="tz-field-label">Descripción (opcional)</label>
      <input type="text" className="tz-text-input" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />

      {error && <p className="tz-error">{error}</p>}
      <div className="tz-add-entry-actions">
        <button className="tz-camera-cancel" onClick={onCancelar} disabled={saving}>
          Cancelar
        </button>
        <button className="tz-pw-submit tz-payment-save" onClick={handleGuardar} disabled={saving}>
          {saving ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
          Guardar
        </button>
      </div>
    </div>
  );
}

function PaqueteRow({ paquete, onActualizar, onEliminar }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [borrando, setBorrando] = useState(false);

  const guardar = async (patch) => {
    setSaving(true);
    const { error } = await onActualizar(paquete.id, patch);
    setSaving(false);
    if (!error) setEditing(false);
  };

  const eliminar = async () => {
    setBorrando(true);
    await onEliminar(paquete.id);
    setBorrando(false);
  };

  if (editing) {
    return (
      <li className="tz-history-row">
        <div className="tz-history-row-detail" style={{ padding: 12 }}>
          <PaqueteForm initial={paquete} onGuardar={guardar} onCancelar={() => setEditing(false)} saving={saving} />
        </div>
      </li>
    );
  }

  return (
    <li className="tz-history-row">
      <div className="tz-history-row-detail" style={{ padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <span>
          <strong style={{ color: "var(--text)" }}>{paquete.nombre}</strong>
          <span style={{ marginLeft: 8 }}>
            {formatSoles(paquete.precio)} ·{" "}
            {paquete.tipo_item === TIPO_ITEM_CREDITOS ? `${paquete.creditos} créditos` : `${paquete.dias_membresia} días`}
          </span>
        </span>
        <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" className="tz-vis-edit-btn" onClick={() => setEditing(true)} aria-label="Editar paquete" title="Editar">
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className="tz-vis-reject-btn"
            onClick={eliminar}
            disabled={borrando}
            aria-label="Eliminar paquete"
            title="Eliminar"
          >
            <Trash2 size={14} />
          </button>
        </span>
      </div>
    </li>
  );
}

// "Configurar Membresías" — ya no edita una fila única: administra la
// LISTA de `paquetes` (Membresías y Paquetes de Créditos), cada uno
// seleccionable desde un desplegable en Recarga Rápida. Reemplaza al
// editor de precio único de la ronda anterior.
export default function ConfigurarMembresiasModal({ paquetes, crearPaquete, actualizarPaquete, eliminarPaquete, onClose }) {
  const [tab, setTab] = useState(TIPO_ITEM_MEMBRESIA);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const crear = async (patch) => {
    setSaving(true);
    const { error } = await crearPaquete(patch);
    setSaving(false);
    if (!error) setAddOpen(false);
  };

  const paquetesDelTab = paquetes.filter((p) => p.tipo_item === tab);

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Settings size={17} /> Configurar Membresías
          </h2>
          <p className="tz-stock-editor-sub">
            Cada paquete que armes acá aparece como opción en el desplegable de Recarga Rápida.
          </p>

          <div className="tz-gasto-tipo-buttons" style={{ marginBottom: 10 }}>
            {TIPOS.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`tz-gasto-tipo-btn ${tab === t.value ? "tz-gasto-tipo-active" : ""}`}
                onClick={() => {
                  setTab(t.value);
                  setAddOpen(false);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {!addOpen ? (
            <button className="tz-scan-btn tz-add-entry-toggle" onClick={() => setAddOpen(true)}>
              <Plus size={16} /> Añadir paquete
            </button>
          ) : (
            <PaqueteForm
              initial={{ tipo_item: tab }}
              onGuardar={crear}
              onCancelar={() => setAddOpen(false)}
              saving={saving}
            />
          )}

          {paquetesDelTab.length === 0 ? (
            <p className="tz-method-history-empty">No hay paquetes configurados todavía.</p>
          ) : (
            <ul className="tz-history-rows">
              {paquetesDelTab.map((p) => (
                <PaqueteRow key={p.id} paquete={p} onActualizar={actualizarPaquete} onEliminar={eliminarPaquete} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
