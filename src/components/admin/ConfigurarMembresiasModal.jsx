import { useState } from "react";
import { Settings, Plus, Save, Pencil, Trash2, X, Loader2 } from "lucide-react";
import ListaArrastrable from "./ListaArrastrable";
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
  const [error, setError] = useState("");

  const guardar = async (patch) => {
    setSaving(true);
    const { error: saveError } = await onActualizar(paquete.id, patch);
    setSaving(false);
    if (saveError) {
      // Antes esto se descartaba en silencio — el modal se quedaba en
      // modo edición sin ninguna pista de qué había fallado.
      setError(saveError.message || "No se pudo guardar.");
      return;
    }
    setError("");
    setEditing(false);
  };

  const eliminar = async () => {
    setBorrando(true);
    await onEliminar(paquete.id);
    setBorrando(false);
  };

  if (editing) {
    return (
      <div className="tz-history-row-detail" style={{ padding: 12 }}>
        {error && <p className="tz-error">{error}</p>}
        <PaqueteForm initial={paquete} onGuardar={guardar} onCancelar={() => setEditing(false)} saving={saving} />
      </div>
    );
  }

  return (
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
  );
}

// "Configurar Membresías" — administra la LISTA de paquetes (Membresías
// y Paquetes de Créditos) de DOS catálogos independientes (Conductores
// y Recolectores, cada uno su propia tabla en Supabase — ver
// usePaquetes.js/usePaquetesRecolectores.js), seleccionables desde un
// desplegable en Recarga Rápida/Autorecarga en vez de tipear un monto a
// mano.
//
// `catalogos`: array de { key, label, paquetes, loading, error,
// crearPaquete, actualizarPaquete, eliminarPaquete, reordenarPaquetes }
// — así el modal no sabe nada de "Conductor vs Recolector" puntual,
// solo itera lo que le pasan (si mañana aparece un tercer público, es
// un elemento más en el array, cero cambios acá).
export default function ConfigurarMembresiasModal({ catalogos, onClose }) {
  const [audiencia, setAudiencia] = useState(catalogos[0]?.key);
  const [tab, setTab] = useState(TIPO_ITEM_MEMBRESIA);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const catalogo = catalogos.find((c) => c.key === audiencia) ?? catalogos[0];
  const { paquetes, loading, error, crearPaquete, actualizarPaquete, eliminarPaquete, reordenarPaquetes } = catalogo;

  const paquetesDelTab = paquetes.filter((p) => p.tipo_item === tab);

  const crear = async (patch) => {
    setSaving(true);
    setSuccessMsg("");
    // Orden (Drag & Drop): un paquete nuevo entra al FINAL de la lista
    // que se está viendo ahora mismo, no a ciegas con lo que sea que
    // la base ponga de default — así nunca "salta" al tope y desordena
    // lo que el Admin ya armó a mano arrastrando.
    const maxOrden = paquetesDelTab.reduce((max, p) => Math.max(max, Number(p.orden) || 0), -1);
    const { error: createError } = await crearPaquete({ ...patch, orden: maxOrden + 1 });
    setSaving(false);
    if (createError) {
      setSaveError(createError.message || "No se pudo crear el paquete.");
      return;
    }
    setSaveError("");
    setAddOpen(false);
    setSuccessMsg("Paquete guardado — ya está disponible para todos en Recarga Rápida.");
    setTimeout(() => setSuccessMsg(""), 4000);
  };

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
            Cada paquete que armes acá aparece como opción en el desplegable correspondiente. Arrastra del
            ícono ⠿ para cambiar el orden en que aparecen.
          </p>

          {successMsg && <p className="tz-success">{successMsg}</p>}

          {/* Tab de audiencia — a qué catálogo pertenece el paquete */}
          <div className="tz-gasto-tipo-buttons" style={{ marginBottom: 8 }}>
            {catalogos.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`tz-gasto-tipo-btn tz-audiencia-tab-btn ${audiencia === c.key ? "tz-gasto-tipo-active" : ""}`}
                onClick={() => {
                  setAudiencia(c.key);
                  setAddOpen(false);
                  setSaveError("");
                }}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Tab de tipo — Membresía vs Paquete de Créditos, dentro del catálogo elegido */}
          <div className="tz-gasto-tipo-buttons" style={{ marginBottom: 10 }}>
            {TIPOS.map((t) => (
              <button
                key={t.value}
                type="button"
                className={`tz-gasto-tipo-btn ${tab === t.value ? "tz-gasto-tipo-active" : ""}`}
                onClick={() => {
                  setTab(t.value);
                  setAddOpen(false);
                  setSaveError("");
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
            <>
              {saveError && <p className="tz-error">{saveError}</p>}
              <PaqueteForm
                key={audiencia}
                initial={{ tipo_item: tab }}
                onGuardar={crear}
                onCancelar={() => {
                  setAddOpen(false);
                  setSaveError("");
                }}
                saving={saving}
              />
            </>
          )}

          {loading ? (
            <div className="tz-loading" style={{ minHeight: 100 }}>
              <Loader2 className="tz-spin" size={22} />
              <p>Cargando…</p>
            </div>
          ) : error ? (
            <p className="tz-error">{error}</p>
          ) : (
            <ListaArrastrable
              // `key`: fuerza a dnd-kit a reconstruir sensores/estado
              // interno al cambiar de catálogo o de tab — sin esto, el
              // contexto de arrastre podía quedar mezclado un instante
              // entre dos listas completamente distintas.
              key={`${audiencia}-${tab}`}
              items={paquetesDelTab}
              onReordenar={reordenarPaquetes}
              vacio={<p className="tz-method-history-empty">No hay paquetes configurados todavía.</p>}
              renderItem={(p) => <PaqueteRow paquete={p} onActualizar={actualizarPaquete} onEliminar={eliminarPaquete} />}
            />
          )}
        </div>
      </div>
    </div>
  );
}
