import { useState } from "react";
import { Settings, Plus, Save, Pencil, Trash2, X, Loader2 } from "lucide-react";
import ListaArrastrable from "./ListaArrastrable";
import { formatSoles } from "../../utils/format";
import { TIPO_ITEM_MEMBRESIA } from "../../lib/taxiEnums";
import PestanasPildora from "../PestanasPildora";
import CampoDescuento, { aFechaLocal, aIso, validarDescuento } from "../CampoDescuento";
import { descuentoVigente } from "../TarjetasPlanes";

// Solo membresías (los créditos ya no existen). Las de recolectores
// (`conCupo`) llevan además el cupo de conductores que pueden atender en su
// periodo (fase 3b de gemas).
function PaqueteForm({ initial, onGuardar, onCancelar, saving, conCupo = false }) {
  const [nombre, setNombre] = useState(initial?.nombre ?? "");
  // Precio SIN descuento (precio_base, migración 20261205100000); la base
  // calcula el precio vigente con el descuento programado.
  const [precio, setPrecio] = useState(String(initial?.precio_base ?? initial?.precio ?? ""));
  const [descPct, setDescPct] = useState(String(initial?.descuento_pct ?? 0));
  const [descDesde, setDescDesde] = useState(aFechaLocal(initial?.descuento_desde));
  const [descHasta, setDescHasta] = useState(aFechaLocal(initial?.descuento_hasta));
  const [diasMembresia, setDiasMembresia] = useState(String(initial?.dias_membresia ?? "30"));
  const [cupo, setCupo] = useState(String(initial?.cupo_conductores ?? ""));
  const [descripcion, setDescripcion] = useState(initial?.descripcion ?? "");
  // Destacados: con esta membresía vigente, el conductor sale en
  // "Destacados" del directorio del admin (prioridad de atención).
  const [destaca, setDestaca] = useState(!!initial?.destaca);
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
    if (!Number(diasMembresia) || Number(diasMembresia) <= 0) {
      setError("Ingresa los días de vigencia.");
      return;
    }
    const errDesc = validarDescuento(descPct, descDesde, descHasta);
    if (errDesc) {
      setError(errDesc);
      return;
    }
    if (conCupo && (!Number(cupo) || Number(cupo) <= 0 || !Number.isInteger(Number(cupo)))) {
      setError("Ingresa cuántos conductores puede atender en su periodo.");
      return;
    }
    setError("");
    onGuardar({
      tipo_item: TIPO_ITEM_MEMBRESIA,
      nombre: nombre.trim(),
      precio: precioNum,
      precio_base: precioNum,
      descuento_pct: Number(String(descPct || 0).replace(",", ".")) || 0,
      descuento_desde: aIso(descDesde),
      descuento_hasta: aIso(descHasta),
      dias_membresia: Number(diasMembresia),
      creditos: null,
      ...(conCupo ? { cupo_conductores: Number(cupo) } : {}),
      // Solo si la base ya tiene la columna (vino al leer) o se encendió.
      ...(!conCupo && (initial?.destaca !== undefined || destaca) ? { destaca } : {}),
      descripcion: descripcion.trim(),
    });
  };

  return (
    <div className="tz-add-entry">
      <label className="tz-field-label">Nombre</label>
      <input
        type="text"
        className="tz-text-input"
        placeholder={conCupo ? "Ej. Recolector 20 conductores" : "Ej. Membresía Básica"}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
      />

      <label className="tz-field-label">Precio sin descuento (S/)</label>
      <input type="number" inputMode="decimal" className="tz-text-input" value={precio} onChange={(e) => setPrecio(e.target.value)} />

      <label className="tz-field-label">Días de vigencia que otorga</label>
      <input type="number" inputMode="numeric" className="tz-text-input" value={diasMembresia} onChange={(e) => setDiasMembresia(e.target.value)} />

      {conCupo && (
        <>
          <label className="tz-field-label">Cupo de conductores en su periodo</label>
          <input
            type="number"
            inputMode="numeric"
            className="tz-text-input"
            placeholder="Ej. 20"
            value={cupo}
            onChange={(e) => setCupo(e.target.value)}
          />
          <p className="tz-stock-editor-sub" style={{ margin: "4px 0 0" }}>
            Cuántos conductores distintos puede atender (venderles membresía) mientras dure.
          </p>
        </>
      )}

      <CampoDescuento
        pct={descPct}
        desde={descDesde}
        hasta={descHasta}
        onPct={setDescPct}
        onDesde={setDescDesde}
        onHasta={setDescHasta}
      />

      {!conCupo && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0 4px" }}>
          <label className="tz-toggle">
            <input type="checkbox" checked={destaca} onChange={(e) => setDestaca(e.target.checked)} aria-label="Destacado" />
            <span className="tz-toggle-slider" />
          </label>
          <span style={{ fontSize: 13, color: destaca ? "var(--yellow)" : "var(--text-dim)" }}>
            {destaca ? "★ Destacado: sus conductores salen en Destacados de tu panel" : "No destacado"}
          </span>
        </div>
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

// Descuento de la fila: vigente (late) o programado.
function ChipDescuento({ item }) {
  const pct = Number(item?.descuento_pct || 0);
  if (!pct) return null;
  const vigente = descuentoVigente(item) > 0;
  const fin = item.descuento_hasta && new Date(item.descuento_hasta).getTime() <= Date.now();
  if (fin) return null;
  return (
    <span className={`tz-chip-desc ${vigente ? "is-vigente" : ""}`}>
      −{pct}% {vigente ? (item.descuento_hasta ? `hasta ${new Date(item.descuento_hasta).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit" })}` : "") : "programado"}
    </span>
  );
}

function PaqueteRow({ paquete, onActualizar, onEliminar, conCupo = false }) {
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
        <PaqueteForm initial={paquete} onGuardar={guardar} onCancelar={() => setEditing(false)} saving={saving} conCupo={conCupo} />
      </div>
    );
  }

  return (
    <div className="tz-history-row-detail" style={{ padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <span>
        <strong style={{ color: "var(--text)" }}>{paquete.nombre}</strong>
        <span style={{ marginLeft: 8 }}>
          {formatSoles(paquete.precio)} ·{" "}
          {`${paquete.dias_membresia} días`}
          {conCupo && paquete.cupo_conductores ? ` · ${paquete.cupo_conductores} conductores` : ""}
          {!conCupo && paquete.destaca ? " · ★ destacado" : ""}
        </span>
        <ChipDescuento item={paquete} />
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

// "Configurar Membresías" — administra la LISTA de membresías de DOS
// catálogos independientes (Conductores
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
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const catalogo = catalogos.find((c) => c.key === audiencia) ?? catalogos[0];
  const { paquetes, loading, error, crearPaquete, actualizarPaquete, eliminarPaquete, reordenarPaquetes } = catalogo;
  const conCupo = !!catalogo.conCupo;
  const tabActivo = TIPO_ITEM_MEMBRESIA;
  const paquetesDelTab = paquetes.filter((p) => p.tipo_item === TIPO_ITEM_MEMBRESIA);

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
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
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

          {/* A qué catálogo pertenece el paquete: misma píldora que Configurar
              planes en Caja (PestanasPildora.jsx). */}
          <PestanasPildora
            opciones={catalogos.map((c) => ({ id: c.key, label: c.label }))}
            valor={audiencia}
            onCambio={(k) => {
              setAudiencia(k);
              setAddOpen(false);
              setSaveError("");
            }}
          />


          {!addOpen ? (
            <button className="tz-scan-btn tz-add-entry-toggle" onClick={() => setAddOpen(true)}>
              <Plus size={16} /> Añadir paquete
            </button>
          ) : (
            <>
              {saveError && <p className="tz-error">{saveError}</p>}
              <PaqueteForm
                key={audiencia}
                initial={{ tipo_item: tabActivo }}
                conCupo={conCupo}
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
              key={`${audiencia}-${tabActivo}`}
              items={paquetesDelTab}
              onReordenar={reordenarPaquetes}
              vacio={<p className="tz-method-history-empty">No hay paquetes configurados todavía.</p>}
              renderItem={(p) => <PaqueteRow paquete={p} onActualizar={actualizarPaquete} onEliminar={eliminarPaquete} conCupo={conCupo} />}
            />
          )}
        </div>
      </div>
    </div>
  );
}
