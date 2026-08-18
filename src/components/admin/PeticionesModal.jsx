import { useState } from "react";
import {
  Inbox,
  X,
  Check,
  XCircle,
  Loader2,
  MessageCircle,
  ShieldCheck,
  KeyRound,
  Image as ImageIcon,
  Trash2,
  Wallet,
  ExternalLink,
} from "lucide-react";
import {
  ESTADO_CONDUCTOR_RECHAZADO,
  ESTADO_CUENTA_PENDIENTE,
  TIPOS_USUARIO,
  ESTADO_PETICION_VERIFICADO,
  TIPO_ITEM_MEMBRESIA,
} from "../../lib/taxiEnums";
import { buildWhatsappLink } from "../../lib/whatsapp";
import { formatTelefono, formatSoles, formatDate } from "../../utils/format";

const FOTOS = [
  { key: "foto_general_url", label: "Toma general" },
  { key: "foto_interior_url", label: "Interior" },
  { key: "foto_conductor_dni_url", label: "Conductor + DNI" },
];

// "Pendiente de revisión" = aprobado:false Y no rechazado todavía. Se
// filtra por `aprobado`, NO por `estado` — `estado` puede traer
// cualquier valor por default de columna que no controlamos del todo,
// mientras que `aprobado` lo insertamos siempre a mano en el create
// (ver useConductores.js/crearConductor). Filtrar por estado era la
// causa del bug "conductor fantasma": un alta desde Recolector podía
// quedar con un `estado` que esConductorPendiente() no reconocía como
// pendiente, y la fila nunca aparecía acá aunque sí en la base.
function esPendienteDeRevision(conductor) {
  return !conductor.aprobado && conductor.estado !== ESTADO_CONDUCTOR_RECHAZADO;
}

// Tarjeta de un conductor pendiente dentro de la pestaña "Registro":
// sus 3 fotos obligatorias en miniatura + categoría a confirmar +
// Aprobar/Rechazar (mismas acciones que ya existían en el Directorio,
// solo que ahora viven acá).
function ConductorPendienteRow({ conductor, categorias, onAprobar, onRechazar }) {
  const [categoriaId, setCategoriaId] = useState(conductor.categoria_id ?? categorias[0]?.id ?? "");
  const [busy, setBusy] = useState(false);

  return (
    <li className="tz-history-row">
      <div className="tz-history-row-detail" style={{ padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <strong style={{ color: "var(--text)" }}>{conductor.nombre}</strong>
            <p style={{ margin: "2px 0", color: "var(--text-dim)", fontSize: 13 }}>
              Placa {conductor.placa}
              {conductor.telefono ? ` · ${formatTelefono(conductor.telefono)}` : ""}
            </p>
          </div>
        </div>

        <div className="tz-peticion-fotos">
          {FOTOS.map((f) => (
            <div key={f.key} className="tz-peticion-foto">
              {conductor[f.key] ? (
                <img src={conductor[f.key]} alt={f.label} />
              ) : (
                <div className="tz-peticion-foto-placeholder">
                  <ImageIcon size={18} />
                </div>
              )}
              <span>{f.label}</span>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          <select
            className="tz-text-input"
            style={{ padding: "7px 8px", fontSize: 12, flex: 1 }}
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
          >
            {categorias.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.nombre}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="tz-vis-approve-btn"
            disabled={busy || !categoriaId}
            onClick={async () => {
              setBusy(true);
              await onAprobar(conductor.id, categoriaId);
              setBusy(false);
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
            {usuario.foto_url ? (
              <img
                src={usuario.foto_url}
                alt={usuario.nombre}
                style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover" }}
              />
            ) : (
              <div className="tz-peticion-foto-placeholder" style={{ width: 40, height: 40 }}>
                <ImageIcon size={16} />
              </div>
            )}
            <div>
              <strong style={{ color: "var(--text)" }}>{usuario.nombre}</strong>
              <p style={{ margin: "2px 0", color: "var(--text-dim)", fontSize: 13 }}>
                DNI {usuario.dni} · {formatTelefono(usuario.telefono)}
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
  conductores,
  categorias,
  onAprobar,
  onRechazar,
  recolectoresPendientes,
  onAprobarRecolector,
  onRechazarRecolector,
}) {
  const pendientes = conductores.filter(esPendienteDeRevision);

  if (pendientes.length === 0 && recolectoresPendientes.length === 0) {
    return <p className="tz-method-history-empty">No hay registros pendientes de aprobación.</p>;
  }

  return (
    <>
      {pendientes.length > 0 && (
        <>
          <p className="tz-field-label">Conductores</p>
          <ul className="tz-history-rows">
            {pendientes.map((c) => (
              <ConductorPendienteRow
                key={c.id}
                conductor={c}
                categorias={categorias}
                onAprobar={onAprobar}
                onRechazar={onRechazar}
              />
            ))}
          </ul>
        </>
      )}
      {recolectoresPendientes.length > 0 && (
        <>
          <p className="tz-field-label" style={{ marginTop: pendientes.length > 0 ? 14 : 0 }}>
            Recolectores
          </p>
          <ul className="tz-history-rows">
            {recolectoresPendientes.map((u) => (
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

// Fila de una petición de PIN: el flujo 2FA manual es secuencial —
// "Verificar Identidad" (abre WhatsApp con el mensaje de confirmación Y
// mueve la petición a 'verificado') tiene que pasar ANTES de que
// aparezca "Generar y Enviar PIN" (cambia el PIN de verdad y abre
// WhatsApp con el PIN nuevo). Mientras no se generó el PIN nuevo no hay
// nada que perder si el admin repite "Verificar Identidad".
function PeticionPinRow({ peticion, onVerificar, onGenerarYEnviar, onDescartar }) {
  const [busy, setBusy] = useState(false);
  const [pinGenerado, setPinGenerado] = useState(null);
  const [error, setError] = useState("");

  const verificado = peticion.estado === ESTADO_PETICION_VERIFICADO;
  const sinTelefono = !peticion.telefono;

  const handleVerificar = () => {
    const link = buildWhatsappLink(
      peticion.telefono,
      "Hola, recibimos una solicitud de cambio de PIN. ¿Confirmas que fuiste tú?"
    );
    if (link) window.open(link, "_blank", "noopener");
    onVerificar(peticion.id);
  };

  const handleGenerar = async () => {
    setBusy(true);
    setError("");
    const { error: genError, pin } = await onGenerarYEnviar(peticion);
    setBusy(false);
    if (genError) {
      setError("No se pudo generar el PIN.");
      return;
    }
    setPinGenerado(pin);
    const link = buildWhatsappLink(peticion.telefono, `Hola ${peticion.nombre}, tu nuevo PIN es: ${pin}`);
    if (link) window.open(link, "_blank", "noopener");
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

        {pinGenerado && (
          <p className="tz-success" style={{ margin: "6px 0 0" }}>
            PIN nuevo: <strong>{pinGenerado}</strong> — se abrió WhatsApp para enviarlo.
          </p>
        )}
        {error && <p className="tz-error">{error}</p>}

        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="tz-camera-cancel tz-scanner-upload-btn"
            disabled={sinTelefono}
            onClick={handleVerificar}
          >
            <MessageCircle size={14} /> Verificar Identidad
          </button>
          <button
            type="button"
            className="tz-scan-btn tz-payment-save"
            disabled={!verificado || busy || sinTelefono || !!pinGenerado}
            onClick={handleGenerar}
            style={{ flex: "0 0 auto" }}
          >
            {busy ? <Loader2 size={14} className="tz-spin" /> : <ShieldCheck size={14} />}
            Generar y Enviar PIN
          </button>
        </div>
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

function RecargasRecolectorTab({ peticiones, usuarios, onAprobar, onRechazar }) {
  if (peticiones.length === 0) {
    return <p className="tz-method-history-empty">No hay solicitudes de recarga de recolectores.</p>;
  }
  const usuariosById = new Map(usuarios.map((u) => [u.id, u]));
  return (
    <ul className="tz-history-rows">
      {peticiones.map((p) => (
        <RecargaRecolectorRow
          key={p.id}
          peticion={p}
          recolector={usuariosById.get(p.recolector_id)}
          onAprobar={onAprobar}
          onRechazar={onRechazar}
        />
      ))}
    </ul>
  );
}

function RecuperacionPinTab({ peticiones, onVerificar, onGenerarYEnviar, onDescartar }) {
  if (peticiones.length === 0) {
    return <p className="tz-method-history-empty">No hay solicitudes de recuperación de PIN.</p>;
  }
  return (
    <ul className="tz-history-rows">
      {peticiones.map((p) => (
        <PeticionPinRow
          key={p.id}
          peticion={p}
          onVerificar={onVerificar}
          onGenerarYEnviar={onGenerarYEnviar}
          onDescartar={onDescartar}
        />
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
  onAprobar,
  onRechazar,
  usuarios,
  onAprobarRecolector,
  onRechazarRecolector,
  peticionesPin,
  onVerificarPin,
  onGenerarYEnviarPin,
  onDescartarPin,
  recargasRecolector,
  onAprobarRecargaRecolector,
  onRechazarRecargaRecolector,
  onClose,
}) {
  const [tab, setTab] = useState("registro");
  const recolectoresPendientes = usuarios.filter(
    (u) => u.rol === "recolector" && u.estado_cuenta === ESTADO_CUENTA_PENDIENTE
  );
  const pendientesCount = conductores.filter(esPendienteDeRevision).length + recolectoresPendientes.length;

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
              Recargas de Recolectores {recargasRecolector.length > 0 ? `(${recargasRecolector.length})` : ""}
            </button>
          </div>

          {tab === "registro" ? (
            <RegistroTab
              conductores={conductores}
              categorias={categorias}
              onAprobar={onAprobar}
              onRechazar={onRechazar}
              recolectoresPendientes={recolectoresPendientes}
              onAprobarRecolector={onAprobarRecolector}
              onRechazarRecolector={onRechazarRecolector}
            />
          ) : tab === "pin" ? (
            <RecuperacionPinTab
              peticiones={peticionesPin}
              onVerificar={onVerificarPin}
              onGenerarYEnviar={onGenerarYEnviarPin}
              onDescartar={onDescartarPin}
            />
          ) : (
            <RecargasRecolectorTab
              peticiones={recargasRecolector}
              usuarios={usuarios}
              onAprobar={onAprobarRecargaRecolector}
              onRechazar={onRechazarRecargaRecolector}
            />
          )}
        </div>
      </div>
    </div>
  );
}
