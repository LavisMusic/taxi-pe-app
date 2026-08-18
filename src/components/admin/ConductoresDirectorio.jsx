import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Pencil, Save, X, Loader2, Zap } from "lucide-react";
import ProductImage from "../ProductImage";
import GestionImagenModal from "./GestionImagenModal";
import NivelAccordionGroup from "../NivelAccordionGroup";
import RecolectorCard from "./RecolectorCard";
import { formatDate, formatTelefono } from "../../utils/format";
import {
  ESTADOS_CONDUCTOR_OPERATIVOS,
  ESTADO_CONDUCTOR_RECHAZADO,
  ESTADO_CUENTA_ACTIVO,
  NIVELES_SERVICIO,
} from "../../lib/taxiEnums";
import { agruparPorNivel } from "../../lib/nivelServicio";

// Tab sintética, no viene de la tabla `categorias` — "predeterminada e
// inamovible" (siempre está, tenga o no recolectores cargados) a
// diferencia de las tabs reales, que solo aparecen si tienen al menos
// un conductor aprobado.
const TAB_RECOLECTORES = "__recolectores__";

// Tarjeta de un conductor: foto (mismo componente ProductImage del
// catálogo, reusando el Aurora/Mesh Gradient tal cual — solo cambia
// qué campo del item alimenta la imagen), datos editables inline
// (lápiz → inputs → guardar/cancelar, patrón de
// CatalogVisibilityAccordion) y el selector de estado operativo a la
// derecha. El glow del borde (`data-nivel` en .tz-card, ver Styles.jsx)
// es puramente decorativo según nivel_servicio — no afecta ninguna
// lógica acá. La aprobación de conductores nuevos vive en el Centro de
// Peticiones (PeticionesModal), no acá — este Directorio solo muestra
// conductores ya aprobados.
function ConductorCard({ conductor, subgrupos, onUpdate, onSetEstado, onRecargar }) {
  const [editing, setEditing] = useState(false);
  const [nombre, setNombre] = useState(conductor.nombre);
  const [placa, setPlaca] = useState(conductor.placa);
  const [telefono, setTelefono] = useState(conductor.telefono || "");
  const [subgrupoId, setSubgrupoId] = useState(conductor.subgrupo_id ?? "");
  const [nivelServicio, setNivelServicio] = useState(conductor.nivel_servicio ?? "economico");
  const [gestionandoFoto, setGestionandoFoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [busyEstado, setBusyEstado] = useState(false);

  const rechazado = conductor.estado === ESTADO_CONDUCTOR_RECHAZADO;
  const subgruposDeSuCategoria = subgrupos.filter((s) => s.categoria_id === conductor.categoria_id);

  const startEdit = () => {
    setNombre(conductor.nombre);
    setPlaca(conductor.placa);
    setTelefono(conductor.telefono || "");
    setSubgrupoId(conductor.subgrupo_id ?? "");
    setNivelServicio(conductor.nivel_servicio ?? "economico");
    setError("");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!nombre.trim() || !placa.trim()) {
      setError("Nombre y placa no pueden quedar vacíos.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: saveError } = await onUpdate(conductor.id, {
      nombre: nombre.trim(),
      placa: placa.trim().toUpperCase(),
      telefono: telefono.trim() || null,
      subgrupo_id: subgrupoId || null,
      nivel_servicio: nivelServicio,
    });
    setSaving(false);
    if (saveError) {
      setError("No se pudo guardar.");
      return;
    }
    setEditing(false);
  };

  const handleEstadoChange = async (e) => {
    setBusyEstado(true);
    await onSetEstado(conductor.id, e.target.value);
    setBusyEstado(false);
  };

  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="tz-card"
      data-nivel={conductor.nivel_servicio || "economico"}
    >
      <div className="tz-card-row">
        <ProductImage
          item={{ imagenUrl: conductor.foto_url, name: conductor.nombre }}
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
                    className="tz-text-input"
                    value={placa}
                    onChange={(e) => setPlaca(e.target.value)}
                    placeholder="Placa"
                  />
                  <input
                    type="text"
                    inputMode="numeric"
                    className="tz-text-input"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    placeholder="Teléfono"
                  />
                  <select
                    className="tz-text-input"
                    value={subgrupoId}
                    onChange={(e) => setSubgrupoId(e.target.value)}
                    disabled={subgruposDeSuCategoria.length === 0}
                  >
                    <option value="">
                      {subgruposDeSuCategoria.length === 0 ? "Sin subgrupos en su categoría" : "Sin subgrupo"}
                    </option>
                    {subgruposDeSuCategoria.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre}
                      </option>
                    ))}
                  </select>
                  <select
                    className="tz-text-input"
                    value={nivelServicio}
                    onChange={(e) => setNivelServicio(e.target.value)}
                  >
                    {NIVELES_SERVICIO.map((n) => (
                      <option key={n.value} value={n.value}>
                        {n.label}
                      </option>
                    ))}
                  </select>
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
                    <h3 className="tz-card-name">{conductor.nombre}</h3>
                    <button
                      type="button"
                      className="tz-vis-edit-btn"
                      onClick={startEdit}
                      aria-label="Editar conductor"
                      title="Editar datos"
                    >
                      <Pencil size={14} />
                    </button>
                    {onRecargar && (
                      <button
                        type="button"
                        className="tz-vis-edit-btn"
                        onClick={() => onRecargar(conductor)}
                        aria-label="Recarga rápida"
                        title="Recarga rápida para este conductor"
                      >
                        <Zap size={14} />
                      </button>
                    )}
                  </div>
                  <p style={{ margin: "2px 0", color: "var(--text-dim)", fontSize: 13 }}>
                    Placa <strong style={{ color: "var(--text)" }}>{conductor.placa}</strong>
                    {conductor.telefono ? ` · ${formatTelefono(conductor.telefono)}` : ""}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="tz-card-bottom">
            <div className="tz-card-stockrow">
              {conductor.creditos != null && (
                <span className="tz-tag tz-tag-ok">{conductor.creditos} créditos</span>
              )}
              {conductor.vencimiento_suscripcion && (
                <span className="tz-tag tz-tag-warn">
                  Vence {formatDate(conductor.vencimiento_suscripcion)}
                </span>
              )}
              {rechazado && <span className="tz-tag tz-tag-danger">Rechazado</span>}
            </div>

            <select
              className="tz-estado-select"
              data-estado={conductor.estado}
              value={conductor.estado ?? ""}
              onChange={handleEstadoChange}
              disabled={busyEstado}
            >
              {ESTADOS_CONDUCTOR_OPERATIVOS.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {gestionandoFoto && (
        <GestionImagenModal
          nombre={conductor.nombre}
          fotoUrl={conductor.foto_url}
          storageKey={conductor.id}
          isProfilePic
          onFotoUrlChange={(url) => onUpdate(conductor.id, { foto_url: url })}
          onClose={() => setGestionandoFoto(false)}
        />
      )}
    </motion.div>
  );
}

// Directorio completo: pestañas por categoría (Autos/Mototaxis/
// Minivans... las que existan en `categorias`, ordenadas por `orden`),
// y dentro de cada una, los conductores agrupados en acordeones por
// nivel_servicio (VIP/Premium/Ejecutivo/Económico) — solo se ven las
// tarjetas de un grupo al desplegarlo. Los conductores pendientes de
// aprobación (`aprobado: false`) YA NO aparecen acá — se revisan desde
// el Centro de Peticiones (botón del header del Admin).
export default function ConductoresDirectorio({
  conductores,
  categorias,
  subgrupos = [],
  onUpdate,
  onSetEstado,
  onRecargar,
  recolectores = [],
  onUpdateRecolector,
  onRecargarRecolector,
}) {
  const aprobados = useMemo(() => conductores.filter((c) => c.aprobado), [conductores]);
  const categoriasConAprobados = useMemo(
    () => categorias.filter((cat) => aprobados.some((c) => String(c.categoria_id) === String(cat.id))),
    [categorias, aprobados]
  );
  const recolectoresActivos = useMemo(
    () => recolectores.filter((u) => u.rol === "recolector" && u.estado_cuenta === ESTADO_CUENTA_ACTIVO),
    [recolectores]
  );

  const [activeTab, setActiveTab] = useState(null);
  const tab = activeTab ?? categoriasConAprobados[0]?.id ?? TAB_RECOLECTORES;

  const esTabRecolectores = tab === TAB_RECOLECTORES;
  const visibles = aprobados.filter((c) => String(c.categoria_id) === String(tab));
  const grupos = agruparPorNivel(visibles);

  return (
    <section>
      <nav className="tz-tabs">
        {categoriasConAprobados.map((cat) => (
          <button
            key={cat.id}
            className={`tz-tab ${String(tab) === String(cat.id) ? "tz-tab-active" : ""}`}
            onClick={() => setActiveTab(cat.id)}
          >
            {cat.nombre}
          </button>
        ))}
        <button
          className={`tz-tab ${esTabRecolectores ? "tz-tab-active" : ""}`}
          onClick={() => setActiveTab(TAB_RECOLECTORES)}
        >
          Recolectores
        </button>
      </nav>

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {esTabRecolectores ? (
          recolectoresActivos.length === 0 ? (
            <div className="tz-empty">
              <p>No hay recolectores activos todavía.</p>
            </div>
          ) : (
            <div className="tz-directorio-grid">
              {recolectoresActivos.map((u) => (
                <RecolectorCard
                  key={u.id}
                  recolector={u}
                  onUpdate={onUpdateRecolector}
                  onRecargar={onRecargarRecolector}
                />
              ))}
            </div>
          )
        ) : grupos.length === 0 ? (
          <div className="tz-empty">
            <p>No hay conductores aprobados en esta categoría todavía.</p>
          </div>
        ) : (
          grupos.map((g, i) => (
            <NivelAccordionGroup key={g.nivel} nivel={g.nivel} label={g.label} count={g.conductores.length} defaultOpen={i === 0}>
              <div className="tz-directorio-grid">
                {g.conductores.map((c) => (
                  <ConductorCard
                    key={c.id}
                    conductor={c}
                    subgrupos={subgrupos}
                    onUpdate={onUpdate}
                    onSetEstado={onSetEstado}
                    onRecargar={onRecargar}
                  />
                ))}
              </div>
            </NivelAccordionGroup>
          ))
        )}
      </div>
    </section>
  );
}
