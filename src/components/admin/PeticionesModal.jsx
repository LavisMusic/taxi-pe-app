import { useState } from "react";
import {
  Inbox,
  X,
  Check,
  XCircle,
  Loader2,
  MessageCircle,
  KeyRound,
  Image as ImageIcon,
  Trash2,
  Wallet,
  ExternalLink,
  History,
} from "lucide-react";
import {
  NIVELES_SERVICIO,
  NIVEL_SERVICIO_ECONOMICO,
  TIPOS_USUARIO,
  ESTADO_PETICION_VERIFICADO,
  TIPO_ITEM_MEMBRESIA,
} from "../../lib/taxiEnums";
import { buildWhatsappLink } from "../../lib/whatsapp";
import { conductoresPorRevisar, recolectoresPorRevisar } from "../../lib/peticiones";
import { useLocalidades } from "../../hooks/useLocalidades";
import ImagenGuardada from "../ImagenGuardada";
import HistorialVerificacionesTab from "./HistorialVerificacionesTab";
import { useUrlVisible } from "../../lib/imagenesPrivadas";
import { formatTelefono, formatSoles, formatDate } from "../../utils/format";

const FOTOS = [
  { key: "foto_general_url", label: "Toma general" },
  { key: "foto_interior_url", label: "Interior" },
  { key: "foto_conductor_dni_url", label: "Conductor + DNI" },
];

// "Pendiente de revisión": ver src/lib/peticiones.js (mismo criterio que
// el número del botón del Admin).
function etiquetaNivel(valor) {
  return NIVELES_SERVICIO.find((n) => n.value === valor)?.label ?? valor;
}

// Tarjeta de un conductor pendiente dentro de la pestaña "Registro": sus
// 3 fotos obligatorias en miniatura y lo que mandó en su verificación
// (categoría, subgrupo, localidad, asientos y el nivel de servicio que
// pide) — el Admin puede corregir todo antes de aprobar; el nivel lo
// confirma él. Aprobar/Rechazar.
function ConductorPendienteRow({ conductor, categorias, subgrupos, localidades, onAprobar, onRechazar }) {
  const [categoriaId, setCategoriaId] = useState(String(conductor.categoria_id ?? categorias[0]?.id ?? ""));
  const [subgrupoId, setSubgrupoId] = useState(conductor.subgrupo_id ? String(conductor.subgrupo_id) : "");
  const [localidad, setLocalidad] = useState(conductor.localidad ?? "");
  const [asientos, setAsientos] = useState(conductor.asientos_totales ?? 4);
  const [nivel, setNivel] = useState(conductor.nivel_servicio_solicitado ?? conductor.nivel_servicio ?? NIVEL_SERVICIO_ECONOMICO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const subgruposDeLaCategoria = subgrupos.filter((sg) => String(sg.categoria_id) === String(categoriaId));
  const selectStyle = { padding: "7px 8px", fontSize: 12 };

  return (
    <li className="tz-history-row">
      <div className="tz-history-row-detail" style={{ padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <strong style={{ color: "var(--text)" }}>{conductor.nombre}</strong>
            <p style={{ margin: "2px 0", color: "var(--text-dim)", fontSize: 13 }}>
              Placa {conductor.placa || "—"}
              {conductor.dni ? ` · DNI ${conductor.dni}` : ""}
              {conductor.telefono ? ` · ${formatTelefono(conductor.telefono)}` : ""}
            </p>
          </div>
        </div>

        <div className="tz-peticion-fotos">
          {FOTOS.map((f) => (
            <div key={f.key} className="tz-peticion-foto">
              {conductor[f.key] ? (
                <ImagenGuardada src={conductor[f.key]} alt={f.label} />
              ) : (
                <div className="tz-peticion-foto-placeholder">
                  <ImageIcon size={18} />
                </div>
              )}
              <span>{f.label}</span>
            </div>
          ))}
        </div>

        <div className="tz-peticion-datos">
          <label>
            <span>Categoría</span>
            <select
              className="tz-text-input"
              style={selectStyle}
              value={categoriaId}
              onChange={(e) => {
                setCategoriaId(e.target.value);
                setSubgrupoId("");
              }}
            >
              {categorias.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.nombre}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Subgrupo</span>
            <select className="tz-text-input" style={selectStyle} value={subgrupoId} onChange={(e) => setSubgrupoId(e.target.value)}>
              <option value="">Sin subgrupo</option>
              {subgruposDeLaCategoria.map((sg) => (
                <option key={sg.id} value={sg.id}>
                  {sg.nombre}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Localidad</span>
            <select className="tz-text-input" style={selectStyle} value={localidad} onChange={(e) => setLocalidad(e.target.value)}>
              <option value="">Sin localidad</option>
              {localidades.map((loc) => (
                <option key={loc.id ?? loc.nombre} value={loc.nombre}>
                  {loc.nombre}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Asientos</span>
            <input
              type="number"
              min={1}
              max={65}
              className="tz-text-input"
              style={selectStyle}
              value={asientos}
              onChange={(e) => setAsientos(e.target.value)}
            />
          </label>
          <label>
            <span>
              Nivel de servicio
              {conductor.nivel_servicio_solicitado ? " (pidió " + etiquetaNivel(conductor.nivel_servicio_solicitado) + ")" : ""}
            </span>
            <select className="tz-text-input" style={selectStyle} value={nivel} onChange={(e) => setNivel(e.target.value)}>
              {NIVELES_SERVICIO.map((n) => (
                <option key={n.value} value={n.value}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="tz-error" style={{ margin: "4px 0 0" }}>{error}</p>}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
          <button
            type="button"
            className="tz-vis-approve-btn"
            disabled={busy || !categoriaId}
            onClick={async () => {
              const n = Number(asientos);
              if (!Number.isInteger(n) || n < 1 || n > 65) {
                setError("Los asientos deben ser un número entero entre 1 y 65.");
                return;
              }
              setError("");
              setBusy(true);
              const { error } = await onAprobar(conductor.id, {
                categoriaId,
                subgrupoId: subgrupoId || null,
                localidad: localidad || null,
                asientosTotales: n,
                nivelServicio: nivel,
              });
              setBusy(false);
              if (error) setError("No se pudo aprobar. Intenta de nuevo.");
              // Pedido: avisarle al conductor por WhatsApp apenas se
              // aprueba su registro, con el mismo número que ÉL puso en
              // su formulario — solo si la aprobación salió bien de
              // verdad (si `onAprobar` devolvió error, no tiene sentido
              // avisarle que "ya puede usar la app").
              if (!error) {
                const link = buildWhatsappLink(
                  conductor.telefono,
                  `Hola ${conductor.nombre}, tu solicitud de registro en TaxiP fue aprobada. Ya puedes ingresar y empezar a usar la app.`
                );
                if (link) window.open(link, "_blank", "noopener");
              }
            }}
            aria-label="Aprobar conductor"
            title="Aprobar"
          >
            {busy ? <Loader2 size={15} className="tz-spin" /> : <Check size={15} />}
          </button>
          <button
            type="button"
            className="tz-vis-reject-btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onRechazar(conductor.id);
              setBusy(false);
            }}
            aria-label="Rechazar conductor"
            title="Rechazar"
          >
            <XCircle size={15} />
          </button>
        </div>
      </div>
    </li>
  );
}

// Fila de un Recolector auto-registrado pendiente — mucho más simple
// que la del conductor (sin fotos vehiculares ni categoría a elegir):
// nombre, teléfono, DNI, foto de perfil, Aprobar/Rechazar.
function RecolectorPendienteRow({ usuario, onAprobar, onRechazar }) {
  const [busy, setBusy] = useState(false);

  return (
    <li className="tz-history-row">
      <div className="tz-history-row-detail" style={{ padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {usuario.foto_dni_url || usuario.foto_url ? (
              <ImagenGuardada
                src={usuario.foto_dni_url || usuario.foto_url}
                alt={usuario.nombre}
                style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover" }}
              />
            ) : (
              <div className="tz-peticion-foto-placeholder" style={{ width: 40, height: 40 }}>
                <ImageIcon size={16} />
              </div>
            )}
            <div>
              <strong style={{ color: "var(--text)" }}>
                {usuario.nombre}
                {usuario.apellido ? ` ${usuario.apellido}` : ""}
              </strong>
              <p style={{ margin: "2px 0", color: "var(--text-dim)", fontSize: 13 }}>
                DNI {usuario.dni}
                {usuario.ruc ? ` · RUC ${usuario.ruc}` : ""} · {formatTelefono(usuario.telefono)}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              className="tz-vis-approve-btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onAprobar(usuario.id);
                setBusy(false);
              }}
              aria-label="Aprobar recolector"
              title="Aprobar"
            >
              {busy ? <Loader2 size={15} className="tz-spin" /> : <Check size={15} />}
            </button>
            <button
              type="button"
              className="tz-vis-reject-btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onRechazar(usuario.id);
                setBusy(false);
              }}
              aria-label="Rechazar recolector"
              title="Rechazar"
            >
              <XCircle size={15} />
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}

function RegistroTab({
  conductoresPendientes,
  categorias,
  subgrupos,
  localidades,
  onAprobar,
  onRechazar,
  recolectoresPendientes,
  onAprobarRecolector,
  onRechazarRecolector,
}) {
  // Filtro: Conductores / Recolectores.
  const [filtro, setFiltro] = useState("conductores");
  const pendientes = filtro === "conductores" ? conductoresPendientes : [];
  const recolectores = filtro === "recolectores" ? recolectoresPendientes : [];
  const totalConductores = conductoresPendientes.length;

  const filtros = (
    <div className="tz-gasto-tipo-buttons" style={{ marginBottom: 10 }}>
      {[
        { id: "conductores", label: `Conductores${totalConductores ? ` (${totalConductores})` : ""}` },
        { id: "recolectores", label: `Recolectores${recolectoresPendientes.length ? ` (${recolectoresPendientes.length})` : ""}` },
      ].map((f) => (
        <button
          key={f.id}
          type="button"
          className={`tz-gasto-tipo-btn ${filtro === f.id ? "tz-gasto-tipo-active" : ""}`}
          onClick={() => setFiltro(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );

  if (pendientes.length === 0 && recolectores.length === 0) {
    return (
      <>
        {filtros}
        <p className="tz-method-history-empty">No hay registros pendientes de aprobación.</p>
      </>
    );
  }

  return (
    <>
      {filtros}
      {pendientes.length > 0 && (
        <>
          <p className="tz-field-label">Conductores</p>
          <ul className="tz-history-rows">
            {pendientes.map((c) => (
              <ConductorPendienteRow
                key={c.id}
                conductor={c}
                categorias={categorias}
                subgrupos={subgrupos}
                localidades={localidades}
                onAprobar={onAprobar}
                onRechazar={onRechazar}
              />
            ))}
          </ul>
        </>
      )}
      {recolectores.length > 0 && (
        <>
          <p className="tz-field-label" style={{ marginTop: pendientes.length > 0 ? 14 : 0 }}>
            Recolectores
          </p>
          <ul className="tz-history-rows">
            {recolectores.map((u) => (
              <RecolectorPendienteRow
                key={u.id}
                usuario={u}
                onAprobar={onAprobarRecolector}
                onRechazar={onRechazarRecolector}
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

const TIPO_LABEL = Object.fromEntries(TIPOS_USUARIO.map((t) => [t.value, t.label]));

// Fila de una petición de PIN: el flujo 2FA manual del Admin termina en
// "Verificar Identidad" (abre WhatsApp con el mensaje de confirmación Y
// mueve la petición a 'verificado') — el PIN nuevo en sí YA NO lo
// genera ni lo manda el Admin (bug reportado: el dueño de la cuenta
// debe poder elegir su propio PIN, el Admin solo "acepta"). Una vez
// verificado, el propio interesado vuelve a /recuperar-pin con su DNI y
// ahí elige su PIN nuevo (ver RecuperarPinPage.jsx/useCrearPeticionPin.js)
// — la petición se cierra sola en ese momento, no hace falta ningún
// botón más acá.
function PeticionPinRow({ peticion, onVerificar, onDescartar }) {
  const verificado = peticion.estado === ESTADO_PETICION_VERIFICADO;
  const sinTelefono = !peticion.telefono;

  const handleVerificar = () => {
    const link = buildWhatsappLink(
      peticion.telefono,
      "Hola, recibimos una solicitud de cambio de PIN. ¿Confirmas que fuiste tú? Una vez confirmado, puedes elegir tu PIN nuevo entrando de nuevo a Olvidé mi PIN con tu DNI."
    );
    if (link) window.open(link, "_blank", "noopener");
    onVerificar(peticion.id);
  };

  return (
    <li className="tz-history-row">
      <div className="tz-history-row-detail" style={{ padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <span className="tz-tag tz-tag-ok" style={{ marginRight: 6 }}>
              {TIPO_LABEL[peticion.tipo_usuario] ?? peticion.tipo_usuario}
            </span>
            <strong style={{ color: "var(--text)" }}>{peticion.nombre}</strong>
            <p style={{ margin: "2px 0", color: "var(--text-dim)", fontSize: 13 }}>
              DNI {peticion.dni}
              {peticion.placa ? ` · Placa ${peticion.placa}` : ""}
              {peticion.telefono ? ` · ${formatTelefono(peticion.telefono)}` : " · Sin teléfono registrado"}
            </p>
          </div>
          <button
            type="button"
            className="tz-vis-delete-btn"
            onClick={() => onDescartar(peticion.id)}
            aria-label="Descartar petición"
            title="Descartar"
          >
            <Trash2 size={14} />
          </button>
        </div>

        {verificado ? (
          <p className="tz-success" style={{ margin: "6px 0 0" }}>
            Identidad verificada — a la espera de que {peticion.nombre.split(" ")[0]} elija su PIN nuevo en
            "Olvidé mi PIN".
          </p>
        ) : (
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="tz-camera-cancel tz-scanner-upload-btn"
              disabled={sinTelefono}
              onClick={handleVerificar}
            >
              <MessageCircle size={14} /> Verificar Identidad
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

// Fila de una solicitud de saldo de un Recolector (autorecarga desde
// /recolector) — mismo esqueleto grande que ConductorPendienteRow (foto
// protagonista + detalle + Aprobar/Rechazar simétricos abajo), en vez
// del link de texto chiquito que tenía antes. Comprobante siempre
// presente (obligatorio en el modal de origen, ver
// AutorecargaRecolectorModal); Aprobar aplica el beneficio (créditos o
// extiende membresía) a `usuarios` de una. Esta solicitud es SIEMPRE el
// recolector recargando su PROPIO saldo — no hay ningún conductor
// involucrado acá (eso es un flujo aparte, Recarga Rápida), así que la
// tarjeta no muestra "conductor que lo recibe": no existe tal cosa en
// este flujo.
function RecargaRecolectorRow({ peticion, recolector, onAprobar, onRechazar }) {
  const [busy, setBusy] = useState(false);
  const esMembresia = peticion.tipo_item === TIPO_ITEM_MEMBRESIA;

  return (
    <li className="tz-history-row">
      <div className="tz-history-row-detail" style={{ padding: 12 }}>
        <div>
          <strong style={{ color: "var(--text)" }}>{recolector?.nombre ?? "Recolector eliminado"}</strong>
          <p style={{ margin: "2px 0", color: "var(--text-dim)", fontSize: 13 }}>
            {recolector?.dni ? `DNI ${recolector.dni}` : ""}
            {recolector?.telefono ? ` · ${formatTelefono(recolector.telefono)}` : ""}
          </p>
        </div>

        <div className="tz-peticion-solicitud">
          <span className={`tz-tag ${esMembresia ? "tz-tag-warn" : "tz-tag-ok"}`}>
            {esMembresia ? "Membresía" : "Créditos"}
          </span>
          <strong>{peticion.paquete_nombre}</strong>
          <span className="tz-peticion-solicitud-meta">
            {esMembresia ? `${peticion.dias_membresia} días` : `${peticion.creditos} créditos`} ·{" "}
            {formatSoles(peticion.monto)} · {peticion.metodo_pago} · {formatDate(peticion.created_at)}
          </span>
        </div>

        {peticion.comprobante_url ? (
          <a href={peticion.comprobante_url} target="_blank" rel="noreferrer" className="tz-comprobante-preview">
            <img src={peticion.comprobante_url} alt="Comprobante" />
            <span>
              Comprobante · toca para ampliar <ExternalLink size={11} style={{ verticalAlign: "-1px" }} />
            </span>
          </a>
        ) : (
          <div className="tz-peticion-foto-placeholder" style={{ height: 80 }}>
            <ImageIcon size={22} />
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            className="tz-cliente-action-btn tz-cliente-action-pago"
            disabled={busy || !recolector}
            onClick={async () => {
              setBusy(true);
              await onAprobar(peticion);
              setBusy(false);
            }}
          >
            {busy ? <Loader2 size={14} className="tz-spin" /> : <Check size={14} />} Aprobar
          </button>
          <button
            type="button"
            className="tz-cliente-action-btn tz-cliente-action-delete"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onRechazar(peticion.id);
              setBusy(false);
            }}
          >
            <XCircle size={14} /> Rechazar
          </button>
        </div>
      </div>
    </li>
  );
}

// Recarga que pidió el propio conductor (botón "Recargar" de /conductor):
// el comprobante está en el bucket privado (enlace firmado). Al aprobar se
// registra la venta y se le da la membresía o las gemas.
function RecargaConductorRow({ peticion, conductor, onAprobar, onRechazar }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const esMembresia = peticion.tipo_item === TIPO_ITEM_MEMBRESIA;
  const comprobante = useUrlVisible(peticion.comprobante_url);

  return (
    <li className="tz-history-row">
      <div className="tz-history-row-detail" style={{ padding: 12 }}>
        <div>
          <strong style={{ color: "var(--text)" }}>{conductor?.nombre ?? "Conductor eliminado"}</strong>
          <p style={{ margin: "2px 0", color: "var(--text-dim)", fontSize: 13 }}>
            {conductor?.placa ? `Placa ${conductor.placa}` : ""}
            {conductor?.telefono ? ` · ${formatTelefono(conductor.telefono)}` : ""}
          </p>
        </div>

        <div className="tz-peticion-solicitud">
          <span className={`tz-tag ${esMembresia ? "tz-tag-warn" : "tz-tag-ok"}`}>{esMembresia ? "Membresía" : "Gemas"}</span>
          <strong>{peticion.paquete_nombre}</strong>
          <span className="tz-peticion-solicitud-meta">
            {esMembresia ? `${peticion.dias_membresia} días` : `${peticion.creditos} gemas`} · {formatSoles(peticion.monto)} ·{" "}
            {peticion.metodo_pago} · {formatDate(peticion.created_at)}
          </span>
        </div>

        {comprobante ? (
          <a href={comprobante} target="_blank" rel="noreferrer" className="tz-comprobante-preview">
            <img src={comprobante} alt="Comprobante" />
            <span>
              Comprobante · toca para ampliar <ExternalLink size={11} style={{ verticalAlign: "-1px" }} />
            </span>
          </a>
        ) : (
          <div className="tz-peticion-foto-placeholder" style={{ height: 80 }}>
            <ImageIcon size={22} />
          </div>
        )}

        {error && <p className="tz-error" style={{ marginTop: 8 }}>{error}</p>}
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 10 }}>
          <button
            type="button"
            className="tz-cliente-action-btn tz-cliente-action-pago"
            disabled={busy || !conductor}
            onClick={async () => {
              setBusy(true);
              setError("");
              const r = await onAprobar(peticion);
              setBusy(false);
              if (r?.error) setError(r.message || "No se pudo aprobar la recarga.");
            }}
          >
            {busy ? <Loader2 size={14} className="tz-spin" /> : <Check size={14} />} Aprobar
          </button>
          <button
            type="button"
            className="tz-cliente-action-btn tz-cliente-action-delete"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onRechazar(peticion.id);
              setBusy(false);
            }}
          >
            <XCircle size={14} /> Rechazar
          </button>
        </div>
      </div>
    </li>
  );
}

// Pestaña "Recargas": filtro Recolectores / Conductores.
function RecargasTab({
  recargasRecolector,
  usuarios,
  onAprobarRecolector,
  onRechazarRecolector,
  recargasConductor,
  conductores,
  onAprobarConductor,
  onRechazarConductor,
}) {
  const [filtro, setFiltro] = useState(() =>
    recargasRecolector.length === 0 && recargasConductor.length > 0 ? "conductores" : "recolectores"
  );
  const filtros = (
    <div className="tz-gasto-tipo-buttons" style={{ marginBottom: 10 }}>
      {[
        { id: "recolectores", label: `Recolectores${recargasRecolector.length ? ` (${recargasRecolector.length})` : ""}` },
        { id: "conductores", label: `Conductores${recargasConductor.length ? ` (${recargasConductor.length})` : ""}` },
      ].map((f) => (
        <button
          key={f.id}
          type="button"
          className={`tz-gasto-tipo-btn ${filtro === f.id ? "tz-gasto-tipo-active" : ""}`}
          onClick={() => setFiltro(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );

  if (filtro === "conductores") {
    const conductoresById = new Map(conductores.map((c) => [c.id, c]));
    return (
      <>
        {filtros}
        {recargasConductor.length === 0 ? (
          <p className="tz-method-history-empty">No hay solicitudes de recarga de conductores.</p>
        ) : (
          <ul className="tz-history-rows">
            {recargasConductor.map((p) => (
              <RecargaConductorRow
                key={p.id}
                peticion={p}
                conductor={conductoresById.get(p.conductor_id)}
                onAprobar={onAprobarConductor}
                onRechazar={onRechazarConductor}
              />
            ))}
          </ul>
        )}
      </>
    );
  }

  const usuariosById = new Map(usuarios.map((u) => [u.id, u]));
  return (
    <>
      {filtros}
      {recargasRecolector.length === 0 ? (
        <p className="tz-method-history-empty">No hay solicitudes de recarga de recolectores.</p>
      ) : (
        <ul className="tz-history-rows">
          {recargasRecolector.map((p) => (
            <RecargaRecolectorRow
              key={p.id}
              peticion={p}
              recolector={usuariosById.get(p.recolector_id)}
              onAprobar={onAprobarRecolector}
              onRechazar={onRechazarRecolector}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function RecuperacionPinTab({ peticiones, onVerificar, onDescartar }) {
  if (peticiones.length === 0) {
    return <p className="tz-method-history-empty">No hay solicitudes de recuperación de PIN.</p>;
  }
  return (
    <ul className="tz-history-rows">
      {peticiones.map((p) => (
        <PeticionPinRow key={p.id} peticion={p} onVerificar={onVerificar} onDescartar={onDescartar} />
      ))}
    </ul>
  );
}

// "Centro de Peticiones" — botón nuevo del header del Admin. Reúne dos
// colas de trabajo que antes vivían sueltas (aprobación de conductores
// en el Directorio) o no existían (recuperación de PIN, flujo 2FA
// manual por WhatsApp: el admin es el "segundo factor", confirma la
// identidad por chat antes de tocar la base).
export default function PeticionesModal({
  conductores,
  categorias,
  subgrupos = [],
  onAprobar,
  onRechazar,
  usuarios,
  onAprobarRecolector,
  onRechazarRecolector,
  peticionesPin,
  onVerificarPin,
  onDescartarPin,
  recargasRecolector,
  onAprobarRecargaRecolector,
  onRechazarRecargaRecolector,
  recargasConductor = [],
  onAprobarRecargaConductor,
  onRechazarRecargaConductor,
  onClose,
}) {
  const [tab, setTab] = useState("registro");
  const { localidades } = useLocalidades();
  const conductoresPendientes = conductoresPorRevisar(conductores, usuarios);
  const recolectoresPendientes = recolectoresPorRevisar(usuarios);
  const pendientesCount = conductoresPendientes.length + recolectoresPendientes.length;

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Inbox size={17} /> Centro de Peticiones
          </h2>

          <div className="tz-gasto-tipo-buttons" style={{ marginBottom: 14 }}>
            <button
              type="button"
              className={`tz-gasto-tipo-btn ${tab === "registro" ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => setTab("registro")}
            >
              Registro {pendientesCount > 0 ? `(${pendientesCount})` : ""}
            </button>
            <button
              type="button"
              className={`tz-gasto-tipo-btn ${tab === "pin" ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => setTab("pin")}
            >
              <KeyRound size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} />
              Recuperación de PIN {peticionesPin.length > 0 ? `(${peticionesPin.length})` : ""}
            </button>
            <button
              type="button"
              className={`tz-gasto-tipo-btn ${tab === "recargas" ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => setTab("recargas")}
            >
              <Wallet size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} />
              Recargas{" "}
              {recargasRecolector.length + recargasConductor.length > 0
                ? `(${recargasRecolector.length + recargasConductor.length})`
                : ""}
            </button>
            <button
              type="button"
              className={`tz-gasto-tipo-btn ${tab === "historial" ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => setTab("historial")}
            >
              <History size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} />
              Historial de verificaciones
            </button>
          </div>

          {tab === "registro" ? (
            <RegistroTab
              conductoresPendientes={conductoresPendientes}
              categorias={categorias}
              subgrupos={subgrupos}
              localidades={localidades}
              onAprobar={onAprobar}
              onRechazar={onRechazar}
              recolectoresPendientes={recolectoresPendientes}
              onAprobarRecolector={onAprobarRecolector}
              onRechazarRecolector={onRechazarRecolector}
            />
          ) : tab === "historial" ? (
            <HistorialVerificacionesTab />
          ) : tab === "pin" ? (
            <RecuperacionPinTab peticiones={peticionesPin} onVerificar={onVerificarPin} onDescartar={onDescartarPin} />
          ) : (
            <RecargasTab
              recargasRecolector={recargasRecolector}
              usuarios={usuarios}
              onAprobarRecolector={onAprobarRecargaRecolector}
              onRechazarRecolector={onRechazarRecargaRecolector}
              recargasConductor={recargasConductor}
              conductores={conductores}
              onAprobarConductor={onAprobarRecargaConductor}
              onRechazarConductor={onRechazarRecargaConductor}
            />
          )}
        </div>
      </div>
    </div>
  );
}
