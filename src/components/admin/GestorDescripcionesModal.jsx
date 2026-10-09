import { useState } from "react";
import { MessageSquareText, Plus, Save, Pencil, Trash2, X, Loader2, ArrowUp, ArrowDown, Eye, EyeOff } from "lucide-react";
import { PUBLICOS, PUBLICO_TODOS, etiquetaPublico, DESCRIPCION_MAX } from "../../lib/taxiEnums";

// "Gestor de Descripciones" (Admin): los mensajes que se escriben solos
// debajo del logo, después de la frase de siempre ("Tu taxi, al toque"
// en el pasajero, el nombre en el conductor). Cada una va a pasajeros, a
// conductores o a ambos; se pueden pausar y ordenar. Mismo diseño que el
// Gestor de Anuncios.
const FILTROS = [{ value: "todas", label: "Todas" }, ...PUBLICOS.filter((p) => p.value !== PUBLICO_TODOS)];

function DescripcionForm({ initial, onGuardar, onCancelar, saving }) {
  const [texto, setTexto] = useState(initial?.texto ?? "");
  const [publico, setPublico] = useState(initial?.publico ?? PUBLICO_TODOS);
  const [error, setError] = useState("");

  const guardar = () => {
    const t = texto.trim();
    if (!t) return setError("Escribe la descripción.");
    if (t.length > DESCRIPCION_MAX) return setError(`Máximo ${DESCRIPCION_MAX} caracteres.`);
    setError("");
    onGuardar({ texto: t, publico });
  };

  return (
    <div className="tz-add-entry">
      <label className="tz-field-label">Descripción</label>
      <input
        type="text"
        className="tz-text-input"
        value={texto}
        maxLength={DESCRIPCION_MAX}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Ej. ¡Viaja seguro, viaja con nosotros!"
      />
      <p className="tz-camera-note" style={{ margin: "-4px 0 0", textAlign: "right" }}>
        {texto.trim().length}/{DESCRIPCION_MAX}
      </p>

      <label className="tz-field-label">Mostrar a</label>
      <div className="tz-gasto-tipo-buttons">
        {PUBLICOS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={`tz-gasto-tipo-btn ${publico === p.value ? "tz-gasto-tipo-active" : ""}`}
            onClick={() => setPublico(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && <p className="tz-error">{error}</p>}
      <div className="tz-add-entry-actions">
        <button className="tz-camera-cancel" onClick={onCancelar} disabled={saving}>
          Cancelar
        </button>
        <button className="tz-pw-submit tz-payment-save" onClick={guardar} disabled={saving}>
          {saving ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </div>
  );
}

function DescripcionRow({ d, arriba, abajo, onActualizar, onEliminar, onIntercambiar }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  const guardar = async (patch) => {
    setSaving(true);
    const { error: e } = await onActualizar(d.id, patch);
    setSaving(false);
    if (e) return setError(e.message || "No se pudo guardar.");
    setError("");
    setEditing(false);
  };
  const accion = async (fn) => {
    setOcupado(true);
    const r = await fn();
    setOcupado(false);
    setError(r?.error ? r.error.message || "No se pudo completar." : "");
  };

  if (editing) {
    return (
      <li className="tz-history-row">
        <div className="tz-history-row-detail" style={{ padding: 12 }}>
          {error && <p className="tz-error">{error}</p>}
          <DescripcionForm initial={d} onGuardar={guardar} onCancelar={() => setEditing(false)} saving={saving} />
        </div>
      </li>
    );
  }

  return (
    <li className="tz-history-row" style={d.activo ? undefined : { opacity: 0.55 }}>
      <div className="tz-history-row-detail" style={{ padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ minWidth: 0 }}>
          <strong style={{ color: "var(--text)", overflowWrap: "anywhere" }}>{d.texto}</strong>
          <p style={{ margin: "2px 0", color: "var(--text-dim)", fontSize: 12 }}>
            {etiquetaPublico(d.publico)} · {d.activo ? "Activa" : "Pausada"}
          </p>
          {error && <p className="tz-error" style={{ margin: 0 }}>{error}</p>}
        </span>
        <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" className="tz-vis-edit-btn" disabled={!arriba || ocupado} onClick={() => accion(() => onIntercambiar(d.id, arriba))} aria-label="Subir" title="Subir">
            <ArrowUp size={14} />
          </button>
          <button type="button" className="tz-vis-edit-btn" disabled={!abajo || ocupado} onClick={() => accion(() => onIntercambiar(d.id, abajo))} aria-label="Bajar" title="Bajar">
            <ArrowDown size={14} />
          </button>
          <button
            type="button"
            className="tz-vis-edit-btn"
            disabled={ocupado}
            onClick={() => accion(() => onActualizar(d.id, { activo: !d.activo }))}
            aria-label={d.activo ? "Pausar" : "Activar"}
            title={d.activo ? "Pausar" : "Activar"}
          >
            {d.activo ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button type="button" className="tz-vis-edit-btn" onClick={() => setEditing(true)} aria-label="Editar" title="Editar">
            <Pencil size={14} />
          </button>
          <button type="button" className="tz-vis-reject-btn" disabled={ocupado} onClick={() => accion(() => onEliminar(d.id))} aria-label="Eliminar" title="Eliminar">
            {ocupado ? <Loader2 size={13} className="tz-spin" /> : <Trash2 size={14} />}
          </button>
        </span>
      </div>
    </li>
  );
}

export default function GestorDescripcionesModal({ descripciones, loading, error, crear, actualizar, eliminar, intercambiar, onClose }) {
  const [filtro, setFiltro] = useState("todas");
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // "Pasajeros" muestra las de pasajeros y las de ambos (lo que de
  // verdad ve un pasajero); igual "Conductores".
  const visibles = descripciones.filter((d) => filtro === "todas" || d.publico === filtro || d.publico === PUBLICO_TODOS);

  const nueva = async (patch) => {
    setSaving(true);
    const { error: e } = await crear(patch);
    setSaving(false);
    if (e) return setSaveError(e.message || "No se pudo crear la descripción.");
    setSaveError("");
    setAddOpen(false);
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <MessageSquareText size={17} /> Gestor de Descripciones
          </h2>
          <p className="tz-stock-editor-sub">
            Mensajes que se escriben solos debajo del logo, después de "Tu taxi, al toque" (pasajeros) o del nombre (conductores). Máximo{" "}
            {DESCRIPCION_MAX} caracteres.
          </p>

          {!addOpen ? (
            <button className="tz-scan-btn tz-add-entry-toggle" onClick={() => setAddOpen(true)}>
              <Plus size={16} /> Nueva descripción
            </button>
          ) : (
            <>
              {saveError && <p className="tz-error">{saveError}</p>}
              <DescripcionForm onGuardar={nueva} onCancelar={() => setAddOpen(false)} saving={saving} />
            </>
          )}

          <div className="tz-gasto-tipo-buttons" style={{ marginTop: 12 }}>
            {FILTROS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={`tz-gasto-tipo-btn ${filtro === f.value ? "tz-gasto-tipo-active" : ""}`}
                onClick={() => setFiltro(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="tz-loading" style={{ minHeight: 100 }}>
              <Loader2 className="tz-spin" size={22} />
              <p>Cargando…</p>
            </div>
          ) : error ? (
            <p className="tz-error">{error}</p>
          ) : visibles.length === 0 ? (
            <p className="tz-method-history-empty">No hay descripciones {filtro === "todas" ? "creadas todavía" : "para este público"}.</p>
          ) : (
            <ul className="tz-history-rows">
              {visibles.map((d, i) => (
                <DescripcionRow
                  key={d.id}
                  d={d}
                  arriba={visibles[i - 1]?.id}
                  abajo={visibles[i + 1]?.id}
                  onActualizar={actualizar}
                  onEliminar={eliminar}
                  onIntercambiar={intercambiar}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
