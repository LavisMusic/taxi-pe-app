import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ScanLine,
  Loader2,
  Trash2,
  Check,
  X,
  Pencil,
  Plus,
  Copy,
  GripVertical,
} from "lucide-react";
import { buscarProductoPorCodigo } from "../lib/productLookup";
import BarcodeScannerModal from "./BarcodeScannerModal";
import ColorPicker from "./ColorPicker";

/* Fila de un producto: toggle de visibilidad, editar (nombre/detalle)
   y eliminar (con confirmación inline en vez de un modal aparte, para
   no apilar overlays sobre el acordeón). Si el borrado choca con una
   FK (producto con ventas registradas), ofrece desactivar en su lugar
   (soft delete vía 'activo') en el mismo lugar, sin que el usuario
   tenga que repetir la acción desde cero.

   Orden de los controles a la derecha: Toggle, luego Lápiz (editar),
   luego Papelera (eliminar) — el lápiz ocupa el lugar donde antes
   estaba el toggle, y el toggle se corrió un paso a la izquierda. */
function ProductoRow({
  producto,
  onToggleVisibility,
  onDelete,
  onSoftDelete,
  onEditProducto,
  categoriaLabel,
  subgrupoRaw,
  onAddVariante,
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fkConflict, setFkConflict] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editNombreBase, setEditNombreBase] = useState(producto.baseName || producto.name);
  const [editVariante, setEditVariante] = useState(producto.variant || "");
  const [editPresentacion, setEditPresentacion] = useState(producto.presentation || "");
  const [editColor, setEditColor] = useState(producto.color || null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const [addingVariante, setAddingVariante] = useState(false);
  const [varianteSabor, setVarianteSabor] = useState("");
  const [variantePresentacion, setVariantePresentacion] = useState("");
  const [varianteColor, setVarianteColor] = useState(null);
  const [varianteSaving, setVarianteSaving] = useState(false);
  const [varianteError, setVarianteError] = useState("");

  const handleDeleteClick = async () => {
    setBusy(true);
    setError("");
    setFkConflict(false);
    const { error: delError, fkConflict: isFk } = await onDelete(producto);
    setBusy(false);
    if (delError) {
      if (isFk) {
        setFkConflict(true);
      } else {
        setError(
          delError.message
            ? `No se pudo eliminar: ${delError.message}`
            : "No se pudo eliminar el producto."
        );
      }
      return;
    }
    // Si funcionó, el padre ya refrescó el catálogo — esta fila
    // desaparece sola cuando 'productos' se vuelva a construir.
  };

  const handleSoftDeleteClick = async () => {
    setBusy(true);
    const { error: softError } = await onSoftDelete(producto);
    setBusy(false);
    if (softError) {
      setError("No se pudo desactivar el producto. Intenta de nuevo.");
    }
  };

  const startEdit = () => {
    setEditNombreBase(producto.baseName || producto.name);
    setEditVariante(producto.variant || "");
    setEditPresentacion(producto.presentation || "");
    setEditColor(producto.color || null);
    setEditError("");
    setEditing(true);
  };

  const saveEdit = async () => {
    const nombreBase = editNombreBase.trim();
    if (!nombreBase) {
      setEditError("El nombre base no puede quedar vacío.");
      return;
    }
    setEditSaving(true);
    setEditError("");
    const { error: saveError } = await onEditProducto(producto, {
      nombreBase,
      variante: editVariante.trim(),
      presentacion: editPresentacion.trim(),
      color: editColor,
    });
    setEditSaving(false);
    if (saveError) {
      setEditError(
        saveError.message ? `No se pudo guardar: ${saveError.message}` : "No se pudo guardar."
      );
      return;
    }
    setEditing(false);
  };

  /* ---- + Añadir Variante: crea un producto NUEVO (con su propia
     clave de stock — es mercadería físicamente distinta, no debe
     compartir inventario con "producto") duplicando nombre base,
     categoría, subgrupo y precio base — solo pide el sabor/variedad
     nuevo (+ presentación y color opcionales). Reusa crearProducto()
     vía onAddVariante, la MISMA función que ya usa el alta rápida al
     escanear un código no encontrado. ---- */
  const startAddVariante = () => {
    setVarianteSabor("");
    setVariantePresentacion("");
    setVarianteColor(null);
    setVarianteError("");
    setAddingVariante(true);
  };

  const saveVariante = async () => {
    const sabor = varianteSabor.trim();
    if (!sabor) {
      setVarianteError("Escribe el sabor o variedad nuevo.");
      return;
    }
    setVarianteSaving(true);
    setVarianteError("");
    const { error: varError } = await onAddVariante(producto, categoriaLabel, subgrupoRaw, {
      variante: sabor,
      presentacion: variantePresentacion.trim(),
      color: varianteColor,
    });
    setVarianteSaving(false);
    if (varError) {
      setVarianteError(
        varError.message ? `No se pudo crear: ${varError.message}` : "No se pudo crear la variante."
      );
      return;
    }
    setAddingVariante(false);
    setVarianteSabor("");
    setVariantePresentacion("");
    setVarianteColor(null);
  };

  if (addingVariante) {
    return (
      <div className="tz-vis-confirm-delete">
        <p>
          Nueva variante de <strong>{producto.baseName || producto.name}</strong> — mismo precio y
          categoría, clave de stock propia.
        </p>
        <input
          type="text"
          className="tz-text-input"
          placeholder='Sabor / variedad (ej. "Fresa")'
          value={varianteSabor}
          onChange={(e) => setVarianteSabor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveVariante();
          }}
          autoFocus
        />
        <input
          type="text"
          className="tz-text-input"
          placeholder="Presentación / medida (opcional)"
          value={variantePresentacion}
          onChange={(e) => setVariantePresentacion(e.target.value)}
        />
        <ColorPicker value={varianteColor} onChange={setVarianteColor} />
        {varianteError && <p className="tz-error">{varianteError}</p>}
        <div className="tz-vis-confirm-actions">
          <button
            type="button"
            className="tz-cliente-action-btn tz-cliente-action-pago"
            onClick={saveVariante}
            disabled={varianteSaving}
          >
            {varianteSaving ? <Loader2 size={13} className="tz-spin" /> : <Check size={13} />}
            Crear variante
          </button>
          <button
            type="button"
            className="tz-cliente-action-btn"
            onClick={() => setAddingVariante(false)}
            disabled={varianteSaving}
          >
            <X size={13} /> Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="tz-vis-confirm-delete">
        <p>
          ¿Eliminar <strong>{producto.name}</strong> definitivamente?
        </p>
        {error && <p className="tz-error">{error}</p>}
        {fkConflict && (
          <p className="tz-error">
            No se puede eliminar porque tiene ventas registradas — se recomienda solo
            desactivarlo.
          </p>
        )}
        <div className="tz-vis-confirm-actions">
          {fkConflict ? (
            <button
              type="button"
              className="tz-cliente-action-btn tz-cliente-action-pago"
              onClick={handleSoftDeleteClick}
              disabled={busy}
            >
              {busy ? <Loader2 size={13} className="tz-spin" /> : <Check size={13} />}
              Desactivar en su lugar
            </button>
          ) : (
            <button
              type="button"
              className="tz-cliente-action-btn tz-cliente-action-deuda"
              onClick={handleDeleteClick}
              disabled={busy}
            >
              {busy ? <Loader2 size={13} className="tz-spin" /> : <Trash2 size={13} />}
              Sí, eliminar
            </button>
          )}
          <button
            type="button"
            className="tz-cliente-action-btn"
            onClick={() => {
              setConfirming(false);
              setError("");
              setFkConflict(false);
            }}
            disabled={busy}
          >
            <X size={13} /> Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="tz-vis-confirm-delete">
        <input
          type="text"
          className="tz-text-input"
          placeholder="Nombre Base"
          value={editNombreBase}
          onChange={(e) => setEditNombreBase(e.target.value)}
          autoFocus
        />
        <div className="tz-nombre-detalle-row">
          <input
            type="text"
            className="tz-text-input"
            placeholder="Sabor / Variedad (opcional)"
            value={editVariante}
            onChange={(e) => setEditVariante(e.target.value)}
          />
          <input
            type="text"
            className="tz-text-input"
            placeholder="Presentación (opcional)"
            value={editPresentacion}
            onChange={(e) => setEditPresentacion(e.target.value)}
          />
        </div>
        <ColorPicker value={editColor} onChange={setEditColor} />
        {editError && <p className="tz-error">{editError}</p>}
        <div className="tz-vis-confirm-actions">
          <button
            type="button"
            className="tz-cliente-action-btn tz-cliente-action-pago"
            onClick={saveEdit}
            disabled={editSaving}
          >
            {editSaving ? <Loader2 size={13} className="tz-spin" /> : <Check size={13} />}
            Guardar
          </button>
          <button
            type="button"
            className="tz-cliente-action-btn"
            onClick={() => setEditing(false)}
            disabled={editSaving}
          >
            <X size={13} /> Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tz-stock-row">
      <div className="tz-stock-row-info">
        <span className="tz-stock-row-name">
          {producto.color && (
            <span className="tz-variant-dot tz-variant-dot-inline" style={{ background: producto.color }} />
          )}
          {producto.name}
        </span>
        {producto.detail && <span className="tz-vis-row-detail">{producto.detail}</span>}
      </div>
      <div className="tz-vis-row-actions">
        <label className="tz-toggle">
          <input
            type="checkbox"
            checked={producto.visiblePublico ?? true}
            onChange={(e) => onToggleVisibility(producto, e.target.checked)}
          />
          <span className="tz-toggle-slider" />
        </label>
        <button
          type="button"
          className="tz-vis-edit-btn"
          onClick={startEdit}
          aria-label={`Editar ${producto.name}`}
          title="Editar producto"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          className="tz-vis-edit-btn"
          onClick={startAddVariante}
          aria-label={`Añadir variante de ${producto.name}`}
          title="+ Añadir Variante"
        >
          <Copy size={14} />
        </button>
        <button
          type="button"
          className="tz-vis-delete-btn"
          onClick={() => setConfirming(true)}
          aria-label={`Eliminar ${producto.name}`}
          title="Eliminar producto"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

/* Búsqueda + escáner CONTEXTUAL: solo busca/filtra dentro de 'items'
   (los productos de la categoría o subgrupo donde vive esta sección),
   nunca en el catálogo completo. Si el código escaneado pertenece a
   otro producto fuera de esta sección, se avisa en vez de mostrarlo. */
function SearchableProductList({
  items,
  onToggleVisibility,
  onDelete,
  onSoftDelete,
  onEditProducto,
  categoriaLabel,
  subgrupoRaw,
  onAddVariante,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState("");

  const handleScan = async (codigo) => {
    setScannerOpen(false);
    setScanBusy(true);
    setScanError("");
    try {
      const producto = await buscarProductoPorCodigo(codigo);
      if (!producto) {
        setScanError(`No se encontró ningún producto con el código "${codigo}".`);
        return;
      }
      const local = items.find((it) => it.id === producto.id);
      if (!local) {
        setScanError(`"${producto.nombre}" no pertenece a esta sección.`);
        return;
      }
      setSearchTerm(local.name);
    } catch (err) {
      console.error("Error buscando producto escaneado (visibilidad):", err);
      setScanError("Error al buscar el producto. Intenta de nuevo.");
    } finally {
      setScanBusy(false);
    }
  };

  const filtered = items.filter(
    (p) => !searchTerm.trim() || p.name.toLowerCase().includes(searchTerm.trim().toLowerCase())
  );

  return (
    <div className="tz-vis-subsection-body">
      <div className="tz-vis-search-row">
        <input
          type="text"
          className="tz-text-input"
          placeholder="Buscar en esta sección…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <button
          type="button"
          className="tz-scan-btn tz-vis-scan-btn"
          onClick={() => {
            setScanError("");
            setScannerOpen(true);
          }}
          disabled={scanBusy}
          aria-label="Escanear producto"
          title="Escanear producto"
        >
          {scanBusy ? <Loader2 size={15} className="tz-spin" /> : <ScanLine size={15} />}
        </button>
      </div>
      {scanError && <p className="tz-error">{scanError}</p>}

      {filtered.length === 0 ? (
        <p className="tz-method-history-empty">Ningún producto coincide.</p>
      ) : (
        <div className="tz-stock-list">
          {filtered.map((p) => (
            <ProductoRow
              key={p.id}
              producto={p}
              onToggleVisibility={onToggleVisibility}
              onDelete={onDelete}
              onSoftDelete={onSoftDelete}
              onEditProducto={onEditProducto}
              categoriaLabel={categoriaLabel}
              subgrupoRaw={subgrupoRaw}
              onAddVariante={onAddVariante}
            />
          ))}
        </div>
      )}

      {scannerOpen && (
        <BarcodeScannerModal onScan={handleScan} onClose={() => setScannerOpen(false)} />
      )}
    </div>
  );
}

/* Acordeón de 2 niveles: Categoría -> (Subgrupo si existe -> productos
   | productos directo si no hay subgrupos). Cada nivel hoja tiene su
   propio buscador/escáner contextual (SearchableProductList). Los
   encabezados de Categoría y Subgrupo llevan un botón de lápiz que
   dispara un UPDATE masivo (todos los productos que comparten ese
   valor) — acá no hay una fila individual que editar, el "nombre de
   categoría/subgrupo" es un string repetido en varias filas. */
function CategoriaAccordion({
  section,
  onToggleVisibility,
  onDelete,
  onSoftDelete,
  onEditProducto,
  onRenameCategoria,
  onRenameSubgrupo,
  onDeleteCategoria,
  onDeleteSubgrupo,
  onForceHideCategoria,
  onForceHideSubgrupo,
  onAddVariante,
  onDragHandleStart,
  onDragOverCategoria,
  onDropCategoria,
  onDragEndCategoria,
  isDragging,
  isDragOver,
}) {
  const [open, setOpen] = useState(false);
  const [openSubgrupos, setOpenSubgrupos] = useState(() => new Set());

  const [editingCategoria, setEditingCategoria] = useState(false);
  const [categoriaValue, setCategoriaValue] = useState(section.label);
  const [categoriaSaving, setCategoriaSaving] = useState(false);
  const [categoriaError, setCategoriaError] = useState("");

  const [editingSubgrupoKey, setEditingSubgrupoKey] = useState(null);
  const [subgrupoValue, setSubgrupoValue] = useState("");
  const [subgrupoSaving, setSubgrupoSaving] = useState(false);
  const [subgrupoError, setSubgrupoError] = useState("");

  const toggleSubgrupo = (key) => {
    setOpenSubgrupos((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const saveCategoriaRename = async () => {
    setCategoriaSaving(true);
    setCategoriaError("");
    const { error, ghostCategoria } = await onRenameCategoria(section.label, categoriaValue);
    setCategoriaSaving(false);
    if (error) {
      setCategoriaError(error.message ? `No se pudo guardar: ${error.message}` : "No se pudo guardar.");
      return;
    }
    // El rename en sí funcionó (productos migrados) — si la categoría
    // vieja quedó como fantasma (RLS/0 filas), se oculta del lado del
    // cliente aunque el refetch la siga trayendo de vuelta.
    if (ghostCategoria) onForceHideCategoria?.(ghostCategoria);
    setEditingCategoria(false);
  };

  // El string real guardado en 'productos.subgrupo' incluye el número
  // ("01 Combos"), pero 'group.title' ya viene sin él (parseSubgrupo
  // lo separó para mostrarlo como encabezado) — hay que reconstruirlo
  // para editar/buscar el valor tal como vive en la base.
  const rawSubgrupo = (group) => (group.numero ? `${group.numero} ${group.title}` : group.title);

  const startEditSubgrupo = (key, group) => {
    setEditingSubgrupoKey(key);
    setSubgrupoValue(rawSubgrupo(group));
    setSubgrupoError("");
  };

  const saveSubgrupoRename = async (group) => {
    setSubgrupoSaving(true);
    setSubgrupoError("");
    const { error, ghostSubgrupo } = await onRenameSubgrupo(
      section.label,
      rawSubgrupo(group),
      subgrupoValue
    );
    setSubgrupoSaving(false);
    if (error) {
      setSubgrupoError(error.message ? `No se pudo guardar: ${error.message}` : "No se pudo guardar.");
      return;
    }
    if (ghostSubgrupo) onForceHideSubgrupo?.(section.label, group.title);
    setEditingSubgrupoKey(null);
  };

  const handleDeleteCategoria = async () => {
    if (
      !window.confirm(
        `¿Eliminar definitivamente la categoría "${section.label}"? Esta acción no se puede deshacer.`
      )
    ) {
      return;
    }
    const { error, fkConflict, zeroRows } = await onDeleteCategoria(section.label);
    if (error) {
      alert(
        fkConflict
          ? "No se puede eliminar la categoría porque aún contiene productos. Elimina o mueve los productos primero."
          : error.message
            ? `No se pudo eliminar: ${error.message}`
            : "No se pudo eliminar la categoría."
      );
      return;
    }
    // 0 filas afectadas (RLS bloqueando en silencio, o ya no existía)
    // se trata como "ya no está" — se oculta del cliente igual.
    if (zeroRows) onForceHideCategoria?.(section.label);
  };

  const handleDeleteSubgrupo = async (group) => {
    if (
      !window.confirm(
        `¿Eliminar el subgrupo "${group.title}"? Los productos que tiene NO se borran — quedan sin subgrupo dentro de "${section.label}".`
      )
    ) {
      return;
    }
    const { error, zeroRows } = await onDeleteSubgrupo(section.label, rawSubgrupo(group));
    if (error) {
      alert(error.message ? `No se pudo eliminar: ${error.message}` : "No se pudo eliminar el subgrupo.");
      return;
    }
    if (zeroRows) onForceHideSubgrupo?.(section.label, group.title);
  };

  // Si solo hay un grupo y no tiene título (== no hay subgrupos reales
  // en esta categoría), se muestran los productos directo, sin un
  // sub-acordeón innecesario de un solo nivel.
  const hasRealSubgroups = section.groups.length > 1 || !!section.groups[0]?.title;
  const totalItems = section.groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <div
      className={`tz-vis-category ${isDragging ? "tz-vis-category-dragging" : ""} ${
        isDragOver ? "tz-vis-category-drag-over" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOverCategoria?.();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropCategoria?.();
      }}
    >
      {editingCategoria ? (
        <div className="tz-vis-inline-edit-row">
          <input
            type="text"
            className="tz-text-input"
            value={categoriaValue}
            onChange={(e) => setCategoriaValue(e.target.value)}
            autoFocus
          />
          <button
            type="button"
            className="tz-vis-edit-btn"
            onClick={saveCategoriaRename}
            disabled={categoriaSaving}
            aria-label="Guardar categoría"
          >
            {categoriaSaving ? <Loader2 size={13} className="tz-spin" /> : <Check size={13} />}
          </button>
          <button
            type="button"
            className="tz-vis-edit-btn"
            onClick={() => {
              setEditingCategoria(false);
              setCategoriaError("");
            }}
            disabled={categoriaSaving}
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
            aria-label={`Arrastrar para reordenar ${section.label}`}
            title="Arrastrar para reordenar"
          >
            <GripVertical size={15} />
          </span>
          <button
            type="button"
            className="tz-vis-category-header"
            onClick={() => setOpen((prev) => !prev)}
          >
            <span>{section.label}</span>
            <span className="tz-vis-category-meta">
              {totalItems} {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </span>
          </button>
          <button
            type="button"
            className="tz-vis-edit-btn"
            onClick={(e) => {
              e.stopPropagation();
              setCategoriaValue(section.label);
              setCategoriaError("");
              setEditingCategoria(true);
            }}
            aria-label={`Editar categoría ${section.label}`}
            title="Editar categoría"
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className="tz-vis-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteCategoria();
            }}
            aria-label={`Eliminar categoría ${section.label}`}
            title="Eliminar categoría"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
      {categoriaError && <p className="tz-error">{categoriaError}</p>}

      {open && (
        <div className="tz-vis-accordion-inner">
          {!hasRealSubgroups ? (
            <SearchableProductList
              items={section.groups[0]?.items ?? []}
              onToggleVisibility={onToggleVisibility}
              onDelete={onDelete}
              onSoftDelete={onSoftDelete}
              onEditProducto={onEditProducto}
              categoriaLabel={section.label}
              subgrupoRaw={null}
              onAddVariante={onAddVariante}
            />
          ) : (
            section.groups.map((group, gi) => {
              const key = `${section.key}::${group.title ?? "sin-subgrupo"}::${gi}`;
              const subOpen = openSubgrupos.has(key);
              const isEditingThisSubgrupo = editingSubgrupoKey === key;
              return (
                <div className="tz-vis-subsection" key={key}>
                  {isEditingThisSubgrupo ? (
                    <div className="tz-vis-inline-edit-row">
                      <input
                        type="text"
                        className="tz-text-input"
                        value={subgrupoValue}
                        onChange={(e) => setSubgrupoValue(e.target.value)}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="tz-vis-edit-btn"
                        onClick={() => saveSubgrupoRename(group)}
                        disabled={subgrupoSaving}
                        aria-label="Guardar subgrupo"
                      >
                        {subgrupoSaving ? (
                          <Loader2 size={13} className="tz-spin" />
                        ) : (
                          <Check size={13} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="tz-vis-edit-btn"
                        onClick={() => {
                          setEditingSubgrupoKey(null);
                          setSubgrupoError("");
                        }}
                        disabled={subgrupoSaving}
                        aria-label="Cancelar"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="tz-vis-header-row">
                      <button
                        type="button"
                        className="tz-vis-subgroup-header"
                        onClick={() => toggleSubgrupo(key)}
                      >
                        <span>{group.title || "Sin subgrupo"}</span>
                        <span className="tz-vis-category-meta">
                          {group.items.length}{" "}
                          {subOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </span>
                      </button>
                      {group.title && (
                        <>
                          <button
                            type="button"
                            className="tz-vis-edit-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditSubgrupo(key, group);
                            }}
                            aria-label={`Editar subgrupo ${group.title}`}
                            title="Editar subgrupo"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            className="tz-vis-delete-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSubgrupo(group);
                            }}
                            aria-label={`Eliminar subgrupo ${group.title}`}
                            title="Eliminar subgrupo"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {subgrupoError && isEditingThisSubgrupo && (
                    <p className="tz-error">{subgrupoError}</p>
                  )}
                  {subOpen && !isEditingThisSubgrupo && (
                    <div className="tz-vis-accordion-inner">
                      <SearchableProductList
                        items={group.items}
                        onToggleVisibility={onToggleVisibility}
                        onDelete={onDelete}
                        onSoftDelete={onSoftDelete}
                        onEditProducto={onEditProducto}
                        categoriaLabel={section.label}
                        subgrupoRaw={rawSubgrupo(group)}
                        onAddVariante={onAddVariante}
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

/* Reemplaza la lista plana/agrupada anterior de "Visibilidad en
   catálogo público": acordeón Categoría -> Subgrupo -> productos, con
   búsqueda/escaneo contextual por sección, alta+baja de productos
   (toggle + eliminar con confirmación y fallback a soft delete), y
   edición al vuelo (lápiz) de producto/categoría/subgrupo. */
export default function CatalogVisibilityAccordion({
  sections,
  onToggleVisibility,
  onDelete,
  onSoftDelete,
  onEditProducto,
  onRenameCategoria,
  onRenameSubgrupo,
  onDeleteCategoria,
  onDeleteSubgrupo,
  onCreateCategoria,
  onAddVariante,
  onReorderCategorias,
}) {
  // Blindaje del lado del cliente: si Supabase deja pasar un delete o
  // update sin afectar ninguna fila (RLS bloqueando en silencio, o la
  // fila ya no existía), refetchCatalog() trae de vuelta exactamente
  // la misma "categoría/subgrupo fantasma" que se acababa de intentar
  // borrar/renombrar, porque sigue viva en la base. Estos sets filtran
  // esos nombres del lado del cliente sin importar lo que diga el
  // backend en la próxima carga — así el usuario puede sacárselos de
  // encima de la vista aunque el backend no coopere. Viven acá (no en
  // App.jsx) porque son "ruido visual de esta sesión del modal", no
  // datos reales — se resetean solos si el modal se cierra y se abre
  // de nuevo.
  const [hiddenCategorias, setHiddenCategorias] = useState(() => new Set());
  const [hiddenSubgrupos, setHiddenSubgrupos] = useState(() => new Set());

  const [creatingCategoria, setCreatingCategoria] = useState(false);
  const [newCategoriaValue, setNewCategoriaValue] = useState("");
  const [creatingSaving, setCreatingSaving] = useState(false);
  const [creatingError, setCreatingError] = useState("");

  /* ---- Drag & Drop de categorías (HTML5 nativo, sin librería): el
     handle (GripVertical) es el único elemento 'draggable' — dragover/
     drop se escuchan en la tarjeta entera de CategoriaAccordion para
     que soltar en cualquier parte de la categoría destino cuente. Al
     soltar, se arma el array completo reordenado y se delega el
     persistido (optimista + UPDATE a 'categorias.orden') a
     reorderCategorias() en useCatalog.js. ---- */
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const handleDrop = (targetIndex, currentVisibleSections) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const reordered = [...currentVisibleSections];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(targetIndex, 0, moved);
    setDragIndex(null);
    setDragOverIndex(null);
    onReorderCategorias?.(reordered.map((s) => s.label));
  };

  const handleCreateCategoria = async () => {
    const nombre = newCategoriaValue.trim();
    if (!nombre) {
      setCreatingError("Escribe un nombre para la categoría.");
      return;
    }
    setCreatingSaving(true);
    setCreatingError("");
    const { error } = await onCreateCategoria(nombre);
    setCreatingSaving(false);
    if (error) {
      setCreatingError(
        error.message ? `No se pudo crear: ${error.message}` : "No se pudo crear la categoría."
      );
      return;
    }
    setNewCategoriaValue("");
    setCreatingCategoria(false);
  };

  const forceHideCategoria = (label) => {
    setHiddenCategorias((prev) => new Set(prev).add(label));
  };
  const forceHideSubgrupo = (categoriaLabel, subgrupoTitle) => {
    setHiddenSubgrupos((prev) => new Set(prev).add(`${categoriaLabel}::${subgrupoTitle}`));
  };

  const visibleSections = sections
    .filter((s) => !hiddenCategorias.has(s.label))
    .map((s) => ({
      ...s,
      groups: s.groups.filter((g) => !hiddenSubgrupos.has(`${s.label}::${g.title}`)),
    }));

  return (
    <div className="tz-vis-accordion">
      <div className="tz-vis-create-categoria">
        {creatingCategoria ? (
          <div className="tz-vis-inline-edit-row">
            <input
              type="text"
              className="tz-text-input"
              placeholder="Nombre de la nueva categoría"
              value={newCategoriaValue}
              onChange={(e) => setNewCategoriaValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateCategoria();
              }}
              autoFocus
            />
            <button
              type="button"
              className="tz-vis-edit-btn"
              onClick={handleCreateCategoria}
              disabled={creatingSaving}
              aria-label="Guardar categoría"
            >
              {creatingSaving ? <Loader2 size={13} className="tz-spin" /> : <Check size={13} />}
            </button>
            <button
              type="button"
              className="tz-vis-edit-btn"
              onClick={() => {
                setCreatingCategoria(false);
                setNewCategoriaValue("");
                setCreatingError("");
              }}
              disabled={creatingSaving}
              aria-label="Cancelar"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="tz-camera-cancel tz-scanner-upload-btn"
            onClick={() => {
              setCreatingCategoria(true);
              setCreatingError("");
            }}
          >
            <Plus size={15} /> Nueva Categoría
          </button>
        )}
        {creatingError && <p className="tz-error">{creatingError}</p>}
      </div>

      {visibleSections.map((section, index) => (
        <CategoriaAccordion
          key={section.key}
          section={section}
          onToggleVisibility={onToggleVisibility}
          onDelete={onDelete}
          onSoftDelete={onSoftDelete}
          onEditProducto={onEditProducto}
          onRenameCategoria={onRenameCategoria}
          onRenameSubgrupo={onRenameSubgrupo}
          onDeleteCategoria={onDeleteCategoria}
          onDeleteSubgrupo={onDeleteSubgrupo}
          onForceHideCategoria={forceHideCategoria}
          onForceHideSubgrupo={forceHideSubgrupo}
          onAddVariante={onAddVariante}
          onDragHandleStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(index));
            setDragIndex(index);
          }}
          onDragOverCategoria={() => setDragOverIndex(index)}
          onDropCategoria={() => handleDrop(index, visibleSections)}
          onDragEndCategoria={() => {
            setDragIndex(null);
            setDragOverIndex(null);
          }}
          isDragging={dragIndex === index}
          isDragOver={dragOverIndex === index && dragIndex !== null && dragIndex !== index}
        />
      ))}
    </div>
  );
}
