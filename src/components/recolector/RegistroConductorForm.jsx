import { useEffect, useState } from "react";
import { Save, Loader2, Camera, Check } from "lucide-react";
import GestionImagenModal from "../admin/GestionImagenModal";
import Dropdown from "../Dropdown";
import { useLocalidades } from "../../hooks/useLocalidades";
import {
  NIVELES_SERVICIO,
  NIVEL_SERVICIO_ECONOMICO,
  esNombreCompletoValido,
  esTelefonoValido,
} from "../../lib/taxiEnums";

// Los 3 slots de foto obligatorios que pide el flujo de aprobación —
// cada uno es un GestionImagenModal independiente (mismo componente que
// usa el Directorio para la foto de perfil, pero SIN `isProfilePic`:
// tienen que quedar crudas, sin el botón "Mejorar con IA", porque son
// evidencia que el Admin revisa, no una foto de producto), con su
// propio storageKey para no pisarse entre sí en Storage.
const FOTOS_REQUERIDAS = [
  {
    key: "fotoGeneralUrl",
    label: "Toma General",
    ayuda: "Debe verse claramente la placa o el número pintado a los costados del vehículo.",
    slug: "general",
  },
  { key: "fotoInteriorUrl", label: "Toma del Interior", ayuda: "", slug: "interior" },
  { key: "fotoConductorDniUrl", label: "Conductor sosteniendo su DNI", ayuda: "", slug: "conductor-dni" },
];

// Los CAMPOS del alta de conductor, sin el "chrome" de modal (backdrop/
// tz-modal/botón cerrar) — así se puede usar tanto dentro de
// RegistroConductorModal.jsx (modal standalone, Recolector/Admin/
// "Regístrate" de /login) como embebido en el modal dual de acceso de
// la Home (pestaña "Registrarse", ver AccesoConductorModal.jsx), sin
// anidar dos backdrops. Mismos 3 flujos y misma lógica de
// requiereLogin/aprobado que antes — ver el comentario largo en
// RegistroConductorModal.jsx.
export default function RegistroConductorForm({
  categorias,
  subgrupos = [],
  crearConductor,
  crearConductorConUsuario,
  requiereLogin = false,
  aprobado = false,
  onClose,
  onCreated,
  onCreatedUsuario,
  initialNombre = "",
}) {
  const { localidades } = useLocalidades();
  const [nombre, setNombre] = useState(initialNombre);
  const [placa, setPlaca] = useState("");
  const [telefono, setTelefono] = useState("");
  const [dni, setDni] = useState("");
  const [localidad, setLocalidad] = useState("");
  const [categoriaId, setCategoriaId] = useState(categorias[0]?.id ?? "");
  const [subgrupoId, setSubgrupoId] = useState("");
  const [nivelServicio, setNivelServicio] = useState(NIVEL_SERVICIO_ECONOMICO);
  // Fase 4 (Colectivo): capacidad real del vehículo — de esto depende
  // cuántos pasajeros puede llevar a la vez (ver `asientos_disponibles`
  // en RadarGlobal.jsx/ChatWindow.jsx). "4" como default cubre el caso
  // más común (auto sedán) sin obligar a tocar nada si el conductor no
  // sabe bien cuántos asientos declarar.
  const [asientosTotales, setAsientosTotales] = useState(4);

  // Localidad ya no es un array estático — llega async de la tabla
  // `localidades` (useLocalidades.js). Se arranca vacío y se rellena
  // con la primera de la lista apenas carga, mismo criterio que ya usa
  // `categoriaId` con `categorias[0]?.id` (esa sí llega sincrónica por
  // prop).
  useEffect(() => {
    if (!localidad && localidades.length > 0) setLocalidad(localidades[0].nombre);
  }, [localidad, localidades]);
  const [fotoPerfilUrl, setFotoPerfilUrl] = useState("");
  const [fotos, setFotos] = useState({ fotoGeneralUrl: "", fotoInteriorUrl: "", fotoConductorDniUrl: "" });
  const [gestionandoFoto, setGestionandoFoto] = useState(null);

  const subgruposDeLaCategoria = subgrupos.filter((s) => String(s.categoria_id) === String(categoriaId));

  // Cambiar de categoría invalida cualquier subgrupo ya elegido (son
  // de la categoría vieja) — se limpia para no mandar un subgrupo que
  // no pertenece a la categoría final.
  useEffect(() => {
    setSubgrupoId("");
  }, [categoriaId]);
  const [fotoKey] = useState(() => `nuevo-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const faltanFotos = FOTOS_REQUERIDAS.some((f) => !fotos[f.key]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!esNombreCompletoValido(nombre)) {
      setError("Escribe el nombre completo (nombre y apellido), ej. \"Daniela Rivas\".");
      return;
    }
    if (!placa.trim()) {
      setError("La placa es obligatoria.");
      return;
    }
    if (!esTelefonoValido(telefono)) {
      setError("Ingresa un celular válido: 9 dígitos, empieza con 9 (ej. 987654321).");
      return;
    }
    if (!/^\d{8}$/.test(dni.trim())) {
      setError("El DNI debe tener 8 dígitos.");
      return;
    }
    const asientos = Number(asientosTotales);
    if (!Number.isInteger(asientos) || asientos < 1 || asientos > 65) {
      setError("La capacidad de asientos debe ser un número entero entre 1 y 65.");
      return;
    }
    if (!fotoPerfilUrl) {
      setError("La foto de perfil es obligatoria.");
      return;
    }
    if (faltanFotos) {
      setError("Las 3 fotos de verificación (general, interior y conductor con DNI) son obligatorias.");
      return;
    }

    const payload = {
      nombre: nombre.trim(),
      placa: placa.trim().toUpperCase(),
      telefono: telefono.trim(),
      dni: dni.trim(),
      localidad,
      categoriaId: categoriaId || null,
      subgrupoId: subgrupoId || null,
      nivelServicio,
      asientosTotales: asientos,
      fotoUrl: fotoPerfilUrl,
      ...fotos,
      aprobado,
    };

    setSaving(true);
    if (requiereLogin) {
      const { error: createError, message, usuario, conductor } = await crearConductorConUsuario(payload);
      setSaving(false);
      if (createError) {
        setError(message || "No se pudo registrar al conductor.");
        return;
      }
      onCreatedUsuario?.(usuario, conductor);
      onCreated?.(nombre.trim(), conductor);
      onClose();
      return;
    }

    const { error: createError, conductor } = await crearConductor(payload);
    setSaving(false);
    if (createError) {
      setError("No se pudo registrar al conductor.");
      return;
    }
    onCreated?.(nombre.trim(), conductor);
    onClose();
  };

  return (
    <>
      {!aprobado && (
        <p className="tz-stock-editor-sub">
          Queda pendiente de aprobación hasta que el Admin revise sus fotos en el Centro de Peticiones.
        </p>
      )}
      {requiereLogin && (
        <p className="tz-stock-editor-sub">
          El PIN de acceso se crea en el primer login, no acá — no hace falta inventar una contraseña
          ahora.
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <label className="tz-field-label">Nombre Completo</label>
        <input
          type="text"
          autoFocus
          className="tz-text-input"
          placeholder="Nombre y apellido"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />

        <label className="tz-field-label">Placa</label>
        <input
          type="text"
          className="tz-text-input"
          placeholder="ABC-123"
          value={placa}
          onChange={(e) => setPlaca(e.target.value)}
        />

        <label className="tz-field-label">Teléfono</label>
        <input
          type="tel"
          inputMode="numeric"
          maxLength={9}
          className="tz-text-input"
          placeholder="987654321"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
        />
        <p className="tz-camera-note" style={{ margin: "2px 0 0" }}>
          Debe ser un número real con WhatsApp para la verificación.
        </p>

        <label className="tz-field-label">DNI</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={8}
          className="tz-text-input"
          placeholder="12345678"
          value={dni}
          onChange={(e) => setDni(e.target.value)}
        />

        <label className="tz-field-label">Capacidad de pasajeros (asientos)</label>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={65}
          step={1}
          className="tz-text-input"
          placeholder="4"
          value={asientosTotales}
          onChange={(e) => setAsientosTotales(e.target.value)}
        />
        <p className="tz-camera-note" style={{ margin: "2px 0 0" }}>
          Cuántos pasajeros puede llevar a la vez tu vehículo (sin contarte a ti) — define cuántas personas
          pueden compartir el mismo viaje.
        </p>

        <label className="tz-field-label">Localidad</label>
        <Dropdown
          value={localidad}
          onChange={setLocalidad}
          options={localidades.map((loc) => ({ value: loc.nombre, label: loc.nombre }))}
          placeholder={localidades.length === 0 ? "Sin localidades creadas" : "Selecciona una localidad"}
          disabled={localidades.length === 0}
          ariaLabel="Localidad"
        />

        <label className="tz-field-label">Categoría</label>
        <Dropdown
          value={categoriaId}
          onChange={setCategoriaId}
          options={categorias.map((cat) => ({ value: cat.id, label: cat.nombre }))}
          placeholder={categorias.length === 0 ? "Sin categorías creadas" : "Selecciona una categoría"}
          disabled={categorias.length === 0}
          ariaLabel="Categoría"
        />

        <label className="tz-field-label">Subgrupo (empresa/flota)</label>
        <Dropdown
          value={subgrupoId}
          onChange={setSubgrupoId}
          options={[
            { value: "", label: subgruposDeLaCategoria.length === 0 ? "Sin subgrupos en esta categoría" : "Sin subgrupo" },
            ...subgruposDeLaCategoria.map((s) => ({ value: s.id, label: s.nombre })),
          ]}
          disabled={subgruposDeLaCategoria.length === 0}
          ariaLabel="Subgrupo"
        />

        <label className="tz-field-label">Nivel de servicio</label>
        <Dropdown
          value={nivelServicio}
          onChange={setNivelServicio}
          options={NIVELES_SERVICIO.map((n) => ({ value: n.value, label: n.label }))}
          ariaLabel="Nivel de servicio"
        />

        <label className="tz-field-label">Foto de Perfil (obligatoria)</label>
        <button
          type="button"
          className="tz-camera-cancel"
          style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}
          onClick={() => setGestionandoFoto({ key: "perfil", label: "Foto de Perfil", slug: "perfil", isProfilePic: true })}
        >
          {fotoPerfilUrl ? (
            <img
              src={fotoPerfilUrl}
              alt="Foto de perfil elegida"
              style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover" }}
            />
          ) : (
            <Camera size={15} />
          )}
          {fotoPerfilUrl ? "Cambiar foto de perfil" : "Gestionar foto de perfil"}
        </button>

        <label className="tz-field-label">Fotos de verificación (obligatorias, sin editar)</label>
        <div className="tz-vis-accordion" style={{ gap: 6 }}>
          {FOTOS_REQUERIDAS.map((f) => (
            <div key={f.key}>
              <button
                type="button"
                className="tz-camera-cancel"
                style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between", width: "100%" }}
                onClick={() => setGestionandoFoto(f)}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {fotos[f.key] ? (
                    <img
                      src={fotos[f.key]}
                      alt={f.label}
                      style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover" }}
                    />
                  ) : (
                    <Camera size={15} />
                  )}
                  {f.label}
                </span>
                {fotos[f.key] ? <Check size={15} color="var(--green)" /> : null}
              </button>
              {f.ayuda && (
                <p className="tz-camera-note" style={{ margin: "2px 0 0" }}>
                  {f.ayuda}
                </p>
              )}
            </div>
          ))}
        </div>

        {error && <p className="tz-error">{error}</p>}
        <button type="submit" className="tz-scan-btn tz-payment-save" disabled={saving} style={{ marginTop: 10 }}>
          {saving ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
          {saving ? "Guardando…" : "Registrar Conductor"}
        </button>
      </form>

      {gestionandoFoto && (
        <GestionImagenModal
          nombre={`${nombre.trim() || "Nuevo conductor"} — ${gestionandoFoto.label}`}
          fotoUrl={gestionandoFoto.key === "perfil" ? fotoPerfilUrl : fotos[gestionandoFoto.key]}
          storageKey={`${fotoKey}-${gestionandoFoto.slug}`}
          isProfilePic={!!gestionandoFoto.isProfilePic}
          onFotoUrlChange={(url) =>
            gestionandoFoto.key === "perfil"
              ? setFotoPerfilUrl(url)
              : setFotos((prev) => ({ ...prev, [gestionandoFoto.key]: url }))
          }
          onClose={() => setGestionandoFoto(null)}
        />
      )}
    </>
  );
}
