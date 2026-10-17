import { useEffect, useState } from "react";
import { ShieldCheck, Camera, Check } from "lucide-react";
import Dropdown from "./Dropdown";
import ImagenGuardada from "./ImagenGuardada";
import GestionImagenModal from "./admin/GestionImagenModal";
import { useConductorTemporal } from "../hooks/useConductorTemporal";
import { useCategoriasPublicas } from "../hooks/useCategoriasPublicas";
import { useLocalidades } from "../hooks/useLocalidades";
import { esEdadValida, SEXOS, NIVELES_SERVICIO, NIVEL_SERVICIO_ECONOMICO } from "../lib/taxiEnums";

// Las mismas 3 fotos obligatorias que RegistroConductorForm.jsx (mismo
// criterio: sin "Mejorar con IA", son evidencia que revisa el Admin).
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

// Verificación de la cuenta temporal del conductor (registro exprés:
// nombre completo + teléfono). Mismos datos que el formulario del Admin
// para añadir un conductor (RegistroConductorForm.jsx) menos el nombre —
// placa, DNI, asientos, localidad, subgrupo, nivel de servicio (lo que
// pide: el Admin lo confirma al aprobar), foto de perfil y las 3 fotos —
// más edad, sexo y PIN. El vehículo (categoría) lo elige en su panel; si
// todavía no lo eligió (o llega desde el login, sin poder leer su fila),
// se le pregunta acá. Reusado en StaffLoginForm.jsx y ConductorPage.jsx:
// solo llama a `onVerificado(usuario)` al terminar.
export default function VerificarConductorForm({ usuario, conductor = null, onVerificado, submitLabel = "Enviar verificación" }) {
  const { verificarCuenta, loading } = useConductorTemporal();
  const { categorias, subgrupos } = useCategoriasPublicas();
  const { localidades } = useLocalidades();
  const [edad, setEdad] = useState("");
  const [sexo, setSexo] = useState("");
  const [dni, setDni] = useState("");
  const [placa, setPlaca] = useState("");
  const [asientosTotales, setAsientosTotales] = useState(conductor?.asientos_totales ?? 4);
  const [localidad, setLocalidad] = useState(conductor?.localidad ?? "");
  const [categoriaId, setCategoriaId] = useState(conductor?.categoria_id ?? "");
  const [subgrupoId, setSubgrupoId] = useState("");
  const [nivelServicio, setNivelServicio] = useState(NIVEL_SERVICIO_ECONOMICO);
  const [fotoPerfilUrl, setFotoPerfilUrl] = useState(conductor?.foto_url ?? "");
  const [fotos, setFotos] = useState({ fotoGeneralUrl: "", fotoInteriorUrl: "", fotoConductorDniUrl: "" });
  const [gestionandoFoto, setGestionandoFoto] = useState(null);
  const [fotoKey] = useState(() => `conductor-${Date.now()}-${Math.round(Math.random() * 1e6)}`);
  const [nuevoPin, setNuevoPin] = useState("");
  const [confirmarNuevoPin, setConfirmarNuevoPin] = useState("");
  const [error, setError] = useState("");

  // Lo que ya dio (vehículo en su panel, localidad en el registro) no se
  // vuelve a preguntar; el PIN solo si la cuenta todavía no tiene uno.
  const vehiculoElegido = !!conductor?.categoria_id;
  const localidadElegida = !!conductor?.localidad;
  const tienePin = !!usuario.pin;
  const subgruposDeLaCategoria = subgrupos.filter((s) => String(s.categoria_id) === String(categoriaId));
  useEffect(() => {
    setSubgrupoId("");
  }, [categoriaId]);

  const faltanFotos = FOTOS_REQUERIDAS.some((f) => !fotos[f.key]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!esEdadValida(edad)) return setError("Ingresa una edad válida (18 a 90 años).");
    if (!sexo) return setError("Selecciona tu sexo.");
    if (!/^\d{8}$/.test(dni.trim())) return setError("El DNI debe tener 8 dígitos.");
    if (!placa.trim()) return setError("La placa es obligatoria.");
    const asientos = Number(asientosTotales);
    if (!Number.isInteger(asientos) || asientos < 1 || asientos > 65) {
      return setError("La capacidad de asientos debe ser un número entero entre 1 y 65.");
    }
    if (!localidad) return setError("Selecciona tu localidad.");
    if (!categoriaId) return setError("Elige tu vehículo.");
    if (!fotoPerfilUrl) return setError("La foto de perfil es obligatoria.");
    if (faltanFotos) return setError("Las 3 fotos de verificación (general, interior y tú con tu DNI) son obligatorias.");
    if (!tienePin) {
      if (!/^\d{6}$/.test(nuevoPin)) return setError("El PIN debe tener 6 dígitos.");
      if (nuevoPin !== confirmarNuevoPin) return setError("Los PIN no coinciden.");
    }

    const { usuario: actualizado, message } = await verificarCuenta({
      usuarioId: usuario.id,
      telefono: usuario.telefono,
      nombre: usuario.nombre,
      edad: Number(edad),
      sexo,
      dni: dni.trim(),
      placa: placa.trim().toUpperCase(),
      asientosTotales: asientos,
      localidad,
      categoriaId,
      subgrupoId: subgrupoId || null,
      nivelServicioSolicitado: nivelServicio,
      fotoUrl: fotoPerfilUrl,
      ...fotos,
      pin: tienePin ? null : nuevoPin,
    });
    if (!actualizado) {
      setError(message);
      return;
    }
    onVerificado(actualizado);
  };

  return (
    <>
      <form onSubmit={handleSubmit}>
        <p className="tz-stock-editor-sub">
          Hola, {usuario.nombre} — completa esto para que tu cuenta deje de ser temporal. El Admin la revisa en el
          Centro de Peticiones; mientras tanto puedes seguir usando la app.
        </p>

        <label className="tz-field-label" htmlFor="verif-edad">
          Edad
        </label>
        <input
          id="verif-edad"
          type="number"
          inputMode="numeric"
          min={18}
          max={90}
          autoFocus
          className="tz-text-input"
          value={edad}
          onChange={(e) => setEdad(e.target.value)}
          placeholder="25"
        />

        <label className="tz-field-label">Sexo</label>
        <Dropdown value={sexo} onChange={setSexo} options={SEXOS} placeholder="Selecciona" ariaLabel="Sexo" />

        <label className="tz-field-label" htmlFor="verif-dni">
          DNI
        </label>
        <input
          id="verif-dni"
          type="text"
          inputMode="numeric"
          maxLength={8}
          className="tz-text-input"
          value={dni}
          onChange={(e) => setDni(e.target.value)}
          placeholder="12345678"
        />

        <label className="tz-field-label" htmlFor="verif-placa">
          Placa
        </label>
        <input
          id="verif-placa"
          type="text"
          className="tz-text-input"
          value={placa}
          onChange={(e) => setPlaca(e.target.value)}
          placeholder="ABC-123"
        />

        <label className="tz-field-label" htmlFor="verif-asientos">
          Capacidad de pasajeros (asientos)
        </label>
        <input
          id="verif-asientos"
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
          Cuántos pasajeros puede llevar a la vez tu vehículo (sin contarte a ti).
        </p>

        {!localidadElegida && (
          <>
            <label className="tz-field-label">Localidad</label>
            <Dropdown
              value={localidad}
              onChange={setLocalidad}
              options={localidades.map((loc) => ({ value: loc.nombre, label: loc.nombre }))}
              placeholder={localidades.length === 0 ? "Sin localidades creadas" : "Selecciona una localidad"}
              disabled={localidades.length === 0}
              ariaLabel="Localidad"
            />
          </>
        )}

        {!vehiculoElegido && (
          <>
            <label className="tz-field-label">Vehículo</label>
            <Dropdown
              value={categoriaId}
              onChange={setCategoriaId}
              options={categorias.map((cat) => ({ value: cat.id, label: cat.nombre }))}
              placeholder="¿Qué vehículo manejas?"
              ariaLabel="Vehículo"
            />
          </>
        )}

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
        <p className="tz-camera-note" style={{ margin: "2px 0 0" }}>
          El Admin lo confirma al aprobar tu cuenta; hasta entonces trabajas como Económico.
        </p>

        <label className="tz-field-label">Foto de Perfil (obligatoria)</label>
        <button
          type="button"
          className="tz-camera-cancel"
          style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", width: "100%" }}
          onClick={() => setGestionandoFoto({ key: "perfil", label: "Foto de Perfil", slug: "perfil", isProfilePic: true })}
        >
          {fotoPerfilUrl ? (
            <img src={fotoPerfilUrl} alt="Foto de perfil elegida" style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover" }} />
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
                    <ImagenGuardada src={fotos[f.key]} alt={f.label} style={{ width: 22, height: 22, borderRadius: 6, objectFit: "cover" }} />
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

        {!tienePin && (
          <>
            <label className="tz-field-label" htmlFor="verif-pin">
              Crea tu PIN (6 dígitos)
            </label>
            <input
              id="verif-pin"
              type="password"
              inputMode="numeric"
              maxLength={6}
              className="tz-text-input"
              value={nuevoPin}
              onChange={(e) => setNuevoPin(e.target.value)}
              placeholder="••••••"
            />

            <label className="tz-field-label" htmlFor="verif-pin-confirm">
              Confirma tu PIN
            </label>
            <input
              id="verif-pin-confirm"
              type="password"
              inputMode="numeric"
              maxLength={6}
              className="tz-text-input"
              value={confirmarNuevoPin}
              onChange={(e) => setConfirmarNuevoPin(e.target.value)}
              placeholder="••••••"
            />
          </>
        )}

        {error && <p className="tz-error">{error}</p>}
        <button type="submit" className="tz-scan-btn tz-payment-save" disabled={loading} style={{ marginTop: 10 }}>
          <ShieldCheck size={16} />
          {loading ? "Guardando…" : submitLabel}
        </button>
      </form>

      {gestionandoFoto && (
        <GestionImagenModal
          nombre={`${usuario.nombre} — ${gestionandoFoto.label}`}
          fotoUrl={gestionandoFoto.key === "perfil" ? fotoPerfilUrl : fotos[gestionandoFoto.key]}
          storageKey={`${fotoKey}-${gestionandoFoto.slug}`}
          isProfilePic={!!gestionandoFoto.isProfilePic}
          privado={!gestionandoFoto.isProfilePic}
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
