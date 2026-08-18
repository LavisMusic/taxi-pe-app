import { useState } from "react";
import {
  LayoutGrid,
  X,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Check,
  Loader2,
  ChevronUp,
  ChevronDown,
  GripVertical,
} from "lucide-react";

// Fila de un subgrupo (empresa/flota) dentro de una categoría expandida
// — arrastrable por el handle para reordenar entre sus hermanos.
function SubgrupoRow({
  subgrupo,
  onActualizar,
  onEliminar,
  onDuplicar,
  onDragHandleStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  isDragOver,
}) {
  const [editing, setEditing] = useState(false);
  const [nombre, setNombre] = useState(subgrupo.nombre);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const guardar = async () => {
    if (!nombre.trim()) {
      setError("El nombre no puede quedar vacío.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: saveError } = await onActualizar(subgrupo.id, { nombre: nombre.trim() });
    setSaving(false);
    if (saveError) {
      setError("No se pudo guardar.");
      return;
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="tz-vis-inline-edit-row">
        <input
          type="text"
          className="tz-text-input"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          autoFocus
        />
        <button type="button" className="tz-vis-edit-btn" onClick={guardar} disabled={saving} aria-label="Guardar subgrupo">
          {saving ? <Loader2 size={13} className="tz-spin" /> : <Check size={13} />}
        </button>
        <button
          type="button"
          className="tz-vis-edit-btn"
          onClick={() => {
            setEditing(false);
            setError("");
          }}
          disabled={saving}
          aria-label="Cancelar"
        >
          <X size={13} />
        </button>
        {error && <p className="tz-error">{error}</p>}
      </div>
    );
  }

  return (
    <div
      className={`tz-stock-row ${isDragging ? "tz-vis-category-dragging" : ""} ${isDragOver ? "tz-vis-category-drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver?.();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop?.();
      }}
    >
      <div className="tz-stock-row-info" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          className="tz-vis-drag-handle"
          draggable
          onDragStart={onDragHandleStart}
          onDragEnd={onDragEnd}
          aria-label={`Arrastrar para reordenar ${subgrupo.nombre}`}
          title="Arrastrar para reordenar"
        >
          <GripVertical size={14} />
        </span>
        <span className="tz-stock-row-name">{subgrupo.nombre}</span>
      </div>
      <div className="tz-vis-row-actions">
        <button type="button" className="tz-vis-edit-btn" onClick={() => setEditing(true)} aria-label="Editar subgrupo" title="Editar">
          <Pencil size={14} />
        </button>
        <button type="button" className="tz-vis-edit-btn" onClick={() => onDuplicar(subgrupo)} aria-label="Duplicar subgrupo" title="Duplicar">
          <Copy size={14} />
        </button>
        <button
          type="button"
          className="tz-vis-delete-btn"
          onClick={() => {
            if (window.confirm(`¿Eliminar el subgrupo "${subgrupo.nombre}"?`)) onEliminar(subgrupo.id);
          }}
          aria-label="Eliminar subgrupo"
          title="Eliminar"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// Acordeón de una categoría: encabezado con drag handle/editar/eliminar,
// y al expandir, la lista (también arrastrable) de sus subgrupos + alta
// de uno nuevo.
function CategoriaAccordionRow({
  categoria,
  subgrupos,
  onActualizar,
  onEliminar,
  onCrearSubgrupo,
  onActualizarSubgrupo,
  onEliminarSubgrupo,
  onDuplicarSubgrupo,
  onReordenarSubgrupos,
  onDragHandleStart,
  onDragOverCategoria,
  onDropCategoria,
  onDragEndCategoria,
  isDragging,
  isDragOver,
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nombre, setNombre] = useState(categoria.nombre);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [addingSubgrupo, setAddingSubgrupo] = useState(false);
  const [nuevoSubgrupo, setNuevoSubgrupo] = useState("");
  const [subgrupoSaving, setSubgrupoSaving] = useState(false);
  const [subgrupoError, setSubgrupoError] = useState("");

  const [subDragIndex, setSubDragIndex] = useState(null);
  const [subDragOverIndex, setSubDragOverIndex] = useState(null);

  const misSubgrupos = subgrupos.filter((s) => s.categoria_id === categoria.id);

  const guardar = async () => {
    if (!nombre.trim()) {
      setError("El nombre no puede quedar vacío.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: saveError } = await onActualizar(categoria.id, { nombre: nombre.trim() });
    setSaving(false);
    if (saveError) {
      setError("No se pudo guardar.");
      return;
    }
    setEditing(false);
  };

  const eliminar = () => {
    if (
      window.confirm(
        `¿Eliminar la categoría "${categoria.nombre}"? Solo se puede si ya no tiene conductores ni subgrupos asociados.`
      )
    ) {
      onEliminar(categoria.id);
    }
  };

  const crearSubgrupo = async () => {
    if (!nuevoSubgrupo.trim()) {
      setSubgrupoError("Escribe un nombre para el subgrupo.");
      return;
    }
    setSubgrupoSaving(true);
    setSubgrupoError("");
    const { error: createError } = await onCrearSubgrupo({ categoriaId: categoria.id, nombre: nuevoSubgrupo.trim() });
    setSubgrupoSaving(false);
    if (createError) {
      setSubgrupoError("No se pudo crear el subgrupo.");
      return;
    }
    setNuevoSubgrupo("");
    setAddingSubgrupo(false);
  };

  const handleDropSubgrupo = (targetIndex) => {
    if (subDragIndex === null || subDragIndex === targetIndex) {
      setSubDragIndex(null);
      setSubDragOverIndex(null);
      return;
    }
    const reordered = [...misSubgrupos];
    const [moved] = reordered.splice(subDragIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setSubDragIndex(null);
    setSubDragOverIndex(null);
    onReordenarSubgrupos(reordered.map((s) => s.id));
  };

  return (
    <div
      className={`tz-vis-category ${isDragging ? "tz-vis-category-dragging" : ""} ${isDragOver ? "tz-vis-category-drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverCategoria?.();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropCategoria?.();
      }}
    >
      {editing ? (
        <div className="tz-vis-inline-edit-row">
          <input type="text" className="tz-text-input" value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus />
          <button type="button" className="tz-vis-edit-btn" onClick={guardar} disabled={saving} aria-label="Guardar categoría">
            {saving ? <Loader2 size={13} className="tz-spin" /> : <Check size={13} />}
          </button>
          <button
            type="button"
            className="tz-vis-edit-btn"
            onClick={() => {
              setEditing(false);
              setError("");
            }}
            disabled={saving}
            aria-label="Cancelar"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="tz-vis-header-row">
          <span
            className="tz-vis-drag-handle"
            draggable
            onDragStart={onDragHandleStart}
            onDragEnd={onDragEndCategoria}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Arrastrar para reordenar ${categoria.nombre}`}
            title="Arrastrar para reordenar"
          >
            <GripVertical size={15} />
          </span>
          <button type="button" className="tz-vis-category-header" onClick={() => setOpen((prev) => !prev)}>
            <span>{categoria.nombre}</span>
            <span className="tz-vis-category-meta">
              {misSubgrupos.length} subgrupo{misSubgrupos.length === 1 ? "" : "s"}{" "}
              {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </span>
          </button>
          <button
            type="button"
            className="tz-vis-edit-btn"
            onClick={(e) => {
              e.stopPropagation();
              setNombre(categoria.nombre);
              setError("");
              setEditing(true);
            }}
            aria-label="Editar categoría"
            title="Editar categoría"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className="tz-vis-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              eliminar();
            }}
            aria-label="Eliminar categoría"
            title="Eliminar categoría"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
      {error && <p className="tz-error">{error}</p>}

      {open && (
        <div className="tz-vis-accordion-inner">
          {misSubgrupos.length === 0 ? (
            <p className="tz-method-history-empty">Sin subgrupos todavía — se usa "Independiente" por defecto.</p>
          ) : (
            <div className="tz-stock-list">
              {misSubgrupos.map((s, index) => (
                <SubgrupoRow
                  key={s.id}
                  subgrupo={s}
                  onActualizar={onActualizarSubgrupo}
                  onEliminar={onEliminarSubgrupo}
                  onDuplicar={onDuplicarSubgrupo}
                  onDragHandleStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(index));
                    setSubDragIndex(index);
                  }}
                  onDragOver={() => setSubDragOverIndex(index)}
                  onDrop={() => handleDropSubgrupo(index)}
                  onDragEnd={() => {
                    setSubDragIndex(null);
                    setSubDragOverIndex(null);
                  }}
                  isDragging={subDragIndex === index}
                  isDragOver={subDragOverIndex === index && subDragIndex !== null && subDragIndex !== index}
                />
              ))}
            </div>
          )}

          {addingSubgrupo ? (
            <div className="tz-vis-inline-edit-row" style={{ marginTop: 8 }}>
              <input
                type="text"
                className="tz-text-input"
                placeholder="Nombre del subgrupo (empresa/flota)"
                value={nuevoSubgrupo}
                onChange={(e) => setNuevoSubgrupo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") crearSubgrupo();
                }}
                autoFocus
              />
              <button type="button" className="tz-vis-edit-btn" onClick={crearSubgrupo} disabled={subgrupoSaving} aria-label="Guardar subgrupo">
                {subgrupoSaving ? <Loader2 size={13} className="tz-spin" /> : <Check size={13} />}
              </button>
              <button
                type="button"
                className="tz-vis-edit-btn"
                onClick={() => {
                  setAddingSubgrupo(false);
                  setSubgrupoError("");
                }}
                disabled={subgrupoSaving}
                aria-label="Cancelar"
              >
                <X size={13} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="tz-camera-cancel tz-scanner-upload-btn"
              style={{ marginTop: 8 }}
              onClick={() => {
                setAddingSubgrupo(true);
                setSubgrupoError("");
              }}
            >
              <Plus size={15} /> Nuevo Subgrupo
            </button>
          )}
          {subgrupoError && <p className="tz-error">{subgrupoError}</p>}
        </div>
      )}
    </div>
  );
}

// "Gestor de Categorías" — recicla el estilo del acordeón de "Editar
// Stock" (CatalogVisibilityAccordion) pero para las categorías/
// subgrupos de conductores en vez de productos, con el mismo
// drag-and-drop nativo (HTML5, sin librería) para reordenar. CRUD
// completo vía useCategorias.js; al cerrar, AdminDashboardPage refresca
// useConductores para que Directorio/formularios no queden con datos
// viejos.
export default function CategoriasModal({
  categorias,
  subgrupos,
  crearCategoria,
  actualizarCategoria,
  eliminarCategoria,
  reordenarCategorias,
  crearSubgrupo,
  actualizarSubgrupo,
  eliminarSubgrupo,
  duplicarSubgrupo,
  reordenarSubgrupos,
  onClose,
}) {
  const [creando, setCreando] = useState(false);
  const [nuevaCategoria, setNuevaCategoria] = useState("");
  const [creandoSaving, setCreandoSaving] = useState(false);
  const [creandoError, setCreandoError] = useState("");

  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const crear = async () => {
    if (!nuevaCategoria.trim()) {
      setCreandoError("Escribe un nombre para la categoría.");
      return;
    }
    setCreandoSaving(true);
    setCreandoError("");
    const { error } = await crearCategoria(nuevaCategoria.trim());
    setCreandoSaving(false);
    if (error) {
      setCreandoError("No se pudo crear la categoría.");
      return;
    }
    setNuevaCategoria("");
    setCreando(false);
  };

  const handleDrop = (targetIndex) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const reordered = [...categorias];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setDragIndex(null);
    setDragOverIndex(null);
    reordenarCategorias(reordered.map((c) => c.id));
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <LayoutGrid size={17} /> Gestor de Categorías
          </h2>
          <p className="tz-stock-editor-sub">
            Categorías (Autos, Mototaxis…) y, dentro de cada una, sus subgrupos (empresas/flotas). Arrastra desde
            el ícono de la izquierda para reordenar.
          </p>

          <div className="tz-vis-accordion">
            <div className="tz-vis-create-categoria">
              {creando ? (
                <div className="tz-vis-inline-edit-row">
                  <input
                    type="text"
                    className="tz-text-input"
                    placeholder="Nombre de la nueva categoría"
                    value={nuevaCategoria}
                    onChange={(e) => setNuevaCategoria(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") crear();
                    }}
                    autoFocus
                  />
                  <button type="button" className="tz-vis-edit-btn" onClick={crear} disabled={creandoSaving} aria-label="Guardar categoría">
                    {creandoSaving ? <Loader2 size={13} className="tz-spin" /> : <Check size={13} />}
                  </button>
                  <button
                    type="button"
                    className="tz-vis-edit-btn"
                    onClick={() => {
                      setCreando(false);
                      setNuevaCategoria("");
                      setCreandoError("");
                    }}
                    disabled={creandoSaving}
                    aria-label="Cancelar"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <button type="button" className="tz-camera-cancel tz-scanner-upload-btn" onClick={() => setCreando(true)}>
                  <Plus size={15} /> Nueva Categoría
                </button>
              )}
              {creandoError && <p className="tz-error">{creandoError}</p>}
            </div>

            {categorias.length === 0 ? (
              <p className="tz-method-history-empty">No hay categorías creadas todavía.</p>
            ) : (
              categorias.map((cat, index) => (
                <CategoriaAccordionRow
                  key={cat.id}
                  categoria={cat}
                  subgrupos={subgrupos}
                  onActualizar={actualizarCategoria}
                  onEliminar={eliminarCategoria}
                  onCrearSubgrupo={crearSubgrupo}
                  onActualizarSubgrupo={actualizarSubgrupo}
                  onEliminarSubgrupo={eliminarSubgrupo}
                  onDuplicarSubgrupo={duplicarSubgrupo}
                  onReordenarSubgrupos={reordenarSubgrupos}
                  onDragHandleStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(index));
                    setDragIndex(index);
                  }}
                  onDragOverCategoria={() => setDragOverIndex(index)}
                  onDropCategoria={() => handleDrop(index)}
                  onDragEndCategoria={() => {
                    setDragIndex(null);
                    setDragOverIndex(null);
                  }}
                  isDragging={dragIndex === index}
                  isDragOver={dragOverIndex === index && dragIndex !== null && dragIndex !== index}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
