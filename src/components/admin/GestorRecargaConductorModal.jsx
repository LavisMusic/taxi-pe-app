import { useEffect, useMemo, useState } from "react";
import { X, Zap, Loader2, CalendarClock, Trash2, Receipt, AlertTriangle, Check, CreditCard, Camera, ImagePlus } from "lucide-react";
import PanelVentaRegistrada from "../PanelVentaRegistrada";
import { formatSoles, formatDate, formatTime } from "../../utils/format";
import {
  ESTADOS_CONDUCTOR_OPERATIVOS,
  METODOS_PAGO,
  METODOS_CON_COMPROBANTE,
  METODO_PAGO_EFECTIVO,
  TIPO_ITEM_CREDITOS,
  TIPO_ITEM_MEMBRESIA,
} from "../../lib/taxiEnums";
import { ventaParaPanel } from "../../lib/ventaBoleta";
import { subirComprobante } from "../../lib/comprobantes";

// Gestor de la membresía de UN conductor (botón ⚡ de su tarjeta en el
// Directorio del Admin) — COMPLETAMENTE igual al gestor del plan de un
// negocio del super admin de Caja Tonazo (PlanNegocioModal.jsx): mismo
// encabezado, mismos apartados en el mismo orden y el mismo diseño, cada
// uno con los datos de Taxi-PE:
//   * Membresía y estado: tarjetas (membresía, vence, créditos,
//     teléfono) + membresía asignada (sin cobrar) y estado operativo.
//   * Recarga rápida: Membresía / Créditos (diferencia propia de
//     Taxi-PE: los créditos se pueden recargar aunque la membresía siga
//     activa); bloqueada si la membresía sigue vigente; filtro Mensual /
//     Anual / Otros; paquete; total; método; comprobante OBLIGATORIO si
//     es digital (Tomar foto / Adjuntar — se comprime y se GUARDA); vuelto
//     si es efectivo. Al registrar sube el desplegable de venta
//     registrada (imprimir / resumen / boleta / copiar).
//     El recolector sigue con su propio formulario (solo escanea).
//   * Corregir vencimiento: fecha y créditos, sin registrar venta.
//   * Pagos: sus ventas con el diseño de "Mis ventas" — Anular y Boleta.
const APARTADOS = [
  { id: "estado", label: "Membresía y estado" },
  { id: "recarga", label: "Recarga rápida" },
  { id: "vencimiento", label: "Corregir vencimiento" },
  { id: "pagos", label: "Pagos" },
];
const DURACIONES = [
  { id: "mensual", label: "Mensual" },
  { id: "anual", label: "Anual" },
  { id: "otros", label: "Otros" },
];
const TIPOS = [
  { id: TIPO_ITEM_MEMBRESIA, label: "Membresía" },
  { id: TIPO_ITEM_CREDITOS, label: "Créditos" },
];
const CLASE_METODO = { efectivo: "efectivo", yape: "yape", plin: "plin", otros: "otros", fiado: "otros" };
const DIAS_AVISO = 7;

const aFechaInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const duracionDe = (p) => {
  const d = Number(p.dias_membresia) || 0;
  if (d <= 31) return "mensual";
  if (d >= 360) return "anual";
  return "otros";
};
const diasHasta = (iso) => (iso ? Math.ceil((new Date(iso) - new Date()) / 86400000) : null);

function estadoMembresia(conductor) {
  const dias = diasHasta(conductor.vencimiento_suscripcion);
  if (dias == null) return { label: "Sin membresía", color: "var(--text-dim)" };
  if (dias < 0) return { label: "Vencida", color: "var(--danger)" };
  if (dias <= DIAS_AVISO) return { label: "Por vencer", color: "var(--yellow)" };
  return { label: "Activa", color: "var(--green)" };
}

function textoVencimiento(conductor) {
  const dias = diasHasta(conductor.vencimiento_suscripcion);
  if (dias == null) return "Nunca tuvo membresía.";
  const fecha = formatDate(conductor.vencimiento_suscripcion);
  if (dias > 1) return `Vence el ${fecha} (en ${dias} días).`;
  if (dias === 1) return `Vence el ${fecha} (mañana).`;
  if (dias === 0) return `Vence hoy (${fecha}).`;
  return `Venció el ${fecha}.`;
}

function RecargaRapida({ conductor, paquetes, registrarRecarga, saving, errorExterno, onPagado }) {
  const [tipo, setTipo] = useState(TIPO_ITEM_MEMBRESIA);
  const activos = paquetes.filter((p) => p.activo !== false && p.tipo_item === tipo);
  const duraciones = tipo === TIPO_ITEM_MEMBRESIA ? DURACIONES.filter((d) => activos.some((p) => duracionDe(p) === d.id)) : [];
  const [duracion, setDuracion] = useState("mensual");
  const [paqueteId, setPaqueteId] = useState("");
  const [metodo, setMetodo] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [preview, setPreview] = useState("");
  const [recibido, setRecibido] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const duracionActiva = duraciones.some((d) => d.id === duracion) ? duracion : duraciones[0]?.id;
  const visibles = tipo === TIPO_ITEM_MEMBRESIA && duracionActiva ? activos.filter((p) => duracionDe(p) === duracionActiva) : activos;
  const paquete = activos.find((p) => String(p.id) === String(paqueteId)) || null;
  const total = Number(paquete?.precio) || 0;
  const esEfectivo = metodo === METODO_PAGO_EFECTIVO;
  const esDigital = METODOS_CON_COMPROBANTE.includes(metodo);
  const recibidoNum = Number(String(recibido).replace(",", "."));
  const vuelto = esEfectivo && Number.isFinite(recibidoNum) && recibido !== "" ? recibidoNum - total : null;
  const membresiaVigente = (diasHasta(conductor.vencimiento_suscripcion) ?? -1) >= 0;

  const cambiarTipo = (t) => {
    setTipo(t);
    setPaqueteId("");
    setError("");
  };

  const selectorTipo = (
    <div className="tz-plan-filtros">
      {TIPOS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`tz-gasto-tipo-btn ${tipo === t.id ? "tz-gasto-tipo-active" : ""}`}
          onClick={() => cambiarTipo(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (conductor.aprobado === false) {
    return <p className="tz-error">Este conductor está pendiente de aprobación en el Centro de Peticiones.</p>;
  }

  if (tipo === TIPO_ITEM_MEMBRESIA && membresiaVigente) {
    return (
      <>
        {selectorTipo}
        <div className="tz-renovar-estado">
          <span className="tz-renovar-estado-icono">
            <Check size={26} />
          </span>
          <h3 className="tz-recarga-bloqueada">
            Membresía activa
            <br />
            hasta el {formatDate(conductor.vencimiento_suscripcion)}
          </h3>
          <p className="tz-stock-editor-sub">
            No se puede recargar otra membresía mientras esta siga activa. Los créditos sí se pueden recargar.
          </p>
        </div>
      </>
    );
  }

  const elegirArchivo = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setArchivo(f);
    setPreview(URL.createObjectURL(f));
    setError("");
  };

  const registrar = async () => {
    setError("");
    if (!paquete) return setError("Elige el paquete que compró.");
    if (!metodo) return setError("Elige el método de pago.");
    if (esDigital && !archivo) return setError("Con Yape/Plin/Otros el comprobante es obligatorio: toma la foto o adjúntalo.");
    if (esEfectivo && recibido !== "" && (!Number.isFinite(recibidoNum) || recibidoNum < total)) {
      return setError("El efectivo recibido es menor al total.");
    }
    setEnviando(true);
    let voucherUrl = null;
    if (esDigital) {
      const { url, error: errSubida } = await subirComprobante(archivo, `admin/${conductor.id}`);
      if (errSubida) {
        console.error("[GestorRecarga] Error subiendo el comprobante:", errSubida);
        setEnviando(false);
        return setError(`No se pudo subir el comprobante: ${errSubida.message || errSubida}`);
      }
      voucherUrl = url;
    }
    const { error: err, venta, destinatario } = await registrarRecarga({
      destinatarioTipo: "conductor",
      conductor,
      cliente: null,
      recolectorId: null,
      tipoItem: tipo,
      monto: total,
      cantidadCreditos: Number(paquete.creditos) || 0,
      diasMembresia: Number(paquete.dias_membresia) || undefined,
      paqueteId: paquete.id,
      paqueteNombre: paquete.nombre,
      paqueteDescripcion: paquete.descripcion,
      metodoPago: metodo,
      comprobante: voucherUrl ? { voucherUrl } : null,
    });
    setEnviando(false);
    if (err) return;
    const recibidoFinal = esEfectivo && recibido !== "" ? recibidoNum : null;
    setArchivo(null);
    setPreview("");
    setRecibido("");
    setMetodo("");
    setPaqueteId("");
    if (venta) onPagado?.({ venta, destinatario: { ...conductor, ...(destinatario || {}) }, montoRecibido: recibidoFinal });
  };

  return (
    <>
      {selectorTipo}
      {duraciones.length > 1 && (
        <div className="tz-plan-filtros">
          {duraciones.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`tz-gasto-tipo-btn ${duracionActiva === d.id ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => {
                setDuracion(d.id);
                setPaqueteId("");
              }}
            >
              {d.label}
            </button>
          ))}
        </div>
      )}
      <label className="tz-field-label">Paquete</label>
      <select className="tz-text-input" value={paqueteId} onChange={(e) => setPaqueteId(e.target.value)}>
        <option value="">{visibles.length === 0 ? "No hay paquetes en este filtro" : "Elige un paquete…"}</option>
        {visibles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre} —{" "}
            {p.tipo_item === TIPO_ITEM_MEMBRESIA ? `${p.dias_membresia} días` : `${p.creditos} créditos`} · {formatSoles(p.precio)}
          </option>
        ))}
      </select>
      {paquete && (
        <p className="tz-plan-total" style={{ margin: "8px 0 0" }}>
          Total: <strong>{formatSoles(total)}</strong> ·{" "}
          {paquete.tipo_item === TIPO_ITEM_MEMBRESIA ? `${paquete.dias_membresia} días` : `${paquete.creditos} créditos`}
        </p>
      )}

      <label className="tz-field-label" style={{ marginTop: 12 }}>
        Método de pago
      </label>
      <div className="tz-gasto-tipo-buttons">
        {METODOS_PAGO.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`tz-gasto-tipo-btn tz-metodo-btn tz-metodo-btn-${CLASE_METODO[m.key] || "otros"} ${
              metodo === m.key ? "tz-gasto-tipo-active" : ""
            }`}
            onClick={() => {
              setMetodo(m.key);
              setError("");
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {esDigital && (
        <div className="tz-recarga-comprobante">
          <label className="tz-field-label" style={{ marginTop: 12 }}>
            Comprobante (obligatorio)
          </label>
          <div className="tz-recarga-comprobante-botones">
            <label className="tz-scan-btn" style={{ cursor: "pointer" }}>
              <Camera size={16} /> Tomar foto
              <input type="file" accept="image/*" capture="environment" hidden onChange={elegirArchivo} />
            </label>
            <label className="tz-scan-btn" style={{ cursor: "pointer" }}>
              <ImagePlus size={16} /> Adjuntar
              <input type="file" accept="image/*" hidden onChange={elegirArchivo} />
            </label>
          </div>
          {preview && <img src={preview} alt="Comprobante" className="tz-renovar-comprobante" />}
        </div>
      )}

      {esEfectivo && (
        <div className="tz-recarga-vuelto">
          <label className="tz-field-label" style={{ marginTop: 12 }} htmlFor="gestor-recibido">
            Efectivo recibido (S/)
          </label>
          <input
            id="gestor-recibido"
            className="tz-text-input"
            inputMode="decimal"
            placeholder={paquete ? String(total) : "0.00"}
            value={recibido}
            onChange={(e) => setRecibido(e.target.value)}
          />
          <div className="tz-recarga-vuelto-rapidos">
            {paquete && (
              <button type="button" className="tz-gasto-tipo-btn" onClick={() => setRecibido(String(total))}>
                Exacto
              </button>
            )}
            {[10, 20, 50, 100, 200].map((v) => (
              <button key={v} type="button" className="tz-gasto-tipo-btn" onClick={() => setRecibido(String(v))}>
                S/ {v}
              </button>
            ))}
          </div>
          {vuelto != null && (
            <p className={`tz-recarga-vuelto-resultado ${vuelto < 0 ? "tz-recarga-vuelto-falta" : ""}`}>
              {vuelto < 0 ? `Faltan ${formatSoles(-vuelto)}` : `Vuelto: ${formatSoles(vuelto)}`}
            </p>
          )}
        </div>
      )}

      {(error || errorExterno) && <p className="tz-error">{error || errorExterno}</p>}
      <button
        type="button"
        className="tz-scan-btn tz-payment-save"
        style={{ width: "100%", marginTop: 14 }}
        onClick={registrar}
        disabled={enviando || saving}
      >
        {enviando || saving ? <Loader2 size={15} className="tz-spin" /> : <Zap size={15} />} Registrar recarga
        {paquete ? ` de ${formatSoles(total)}` : ""}
      </button>
    </>
  );
}

export default function GestorRecargaConductorModal({
  conductor,
  ventas,
  usuarios,
  paquetes = [],
  onSetEstado,
  onUpdate,
  anular,
  busyId,
  recargaProps,
  onClose,
}) {
  const [apartado, setApartado] = useState("estado");
  const [ventaPanel, setVentaPanel] = useState(null);
  const [confirmandoId, setConfirmandoId] = useState(null);
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState("");
  const [verComprobante, setVerComprobante] = useState(null);
  const [fecha, setFecha] = useState(aFechaInput(conductor.vencimiento_suscripcion));
  const [creditos, setCreditos] = useState(String(conductor.creditos ?? 0));

  const estado = estadoMembresia(conductor);
  const vigente = (diasHasta(conductor.vencimiento_suscripcion) ?? -1) >= 0;
  const membresias = paquetes.filter((p) => p.tipo_item === TIPO_ITEM_MEMBRESIA);
  const paqueteActual = paquetes.find((p) => String(p.id) === String(conductor.membresia_paquete_id));
  const labelMetodo = (key) => METODOS_PAGO.find((m) => m.key === key)?.label ?? key;
  const recolectorDe = (v) => usuarios.find((u) => u.id === v.recolector_id)?.nombre || "Admin";

  const susVentas = useMemo(
    () =>
      ventas
        .filter((v) => v.conductor_id === conductor.id)
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
    [ventas, conductor.id]
  );

  const actualizar = async (campos, etiqueta) => {
    setError("");
    setGuardando(etiqueta);
    const { error: err } = await onUpdate(conductor.id, campos);
    setGuardando("");
    if (err) setError(err.message || "No se pudo guardar.");
    return !err;
  };

  const cambiarEstado = async (e) => {
    setGuardando("estado");
    await onSetEstado(conductor.id, e.target.value);
    setGuardando("");
  };

  const corregir = async () => {
    const cred = Number(creditos);
    if (!Number.isInteger(cred) || cred < 0) return setError("Los créditos deben ser un número entero (0 o más).");
    const ok = await actualizar(
      {
        // Fin del día elegido (hora de Perú, UTC-5); vacío = sin membresía.
        vencimiento_suscripcion: fecha ? new Date(`${fecha}T23:59:59-05:00`).toISOString() : null,
        creditos: cred,
      },
      "fecha"
    );
    if (ok) setAviso("Corrección guardada.");
  };

  const handleAnular = async (venta) => {
    setAviso("");
    const { error: err, eraFiado, fiadoEncontrado } = await anular(venta, conductor, null);
    setConfirmandoId(null);
    if (err) return setError("No se pudo anular la venta.");
    if (eraFiado && !fiadoEncontrado) {
      setAviso(`Esta venta era Fiado pero no encontramos la deuda vinculada — revisa la Libreta de Fiados de ${conductor.nombre}.`);
    }
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <h2>
          <CreditCard size={17} /> Membresía · {conductor.nombre}
        </h2>
        <p className="tz-brand-sub" style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="tz-plan-badge" style={{ "--tz-plan-color": estado.color }}>
            {estado.label}
          </span>
          {textoVencimiento(conductor)}
        </p>

        <div className="tz-plan-filtros tz-plan-apartados">
          {APARTADOS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`tz-gasto-tipo-btn ${apartado === a.id ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => {
                setApartado(a.id);
                setError("");
                setAviso("");
                if (a.id === "vencimiento") {
                  setFecha(aFechaInput(conductor.vencimiento_suscripcion));
                  setCreditos(String(conductor.creditos ?? 0));
                }
              }}
            >
              {a.label}
            </button>
          ))}
        </div>

        {apartado === "estado" && (
          <>
            <div className="tz-gestor-recarga-datos">
              <div className="tz-gestor-recarga-dato">
                <span>Membresía</span>
                <strong>{vigente ? paqueteActual?.nombre || "Membresía" : "Sin membresía"}</strong>
              </div>
              <div className="tz-gestor-recarga-dato">
                <span>Vence</span>
                <strong>{conductor.vencimiento_suscripcion ? formatDate(conductor.vencimiento_suscripcion) : "—"}</strong>
              </div>
              <div className="tz-gestor-recarga-dato">
                <span>Créditos</span>
                <strong>{conductor.creditos ?? 0}</strong>
              </div>
              <div className="tz-gestor-recarga-dato">
                <span>Teléfono</span>
                <strong>{conductor.telefono || "Sin registrar"}</strong>
              </div>
            </div>
            <div className="tz-plan-seccion">
              <label className="tz-plan-campo tz-plan-campo-ancho">
                <span>Membresía asignada (sin cobrar)</span>
                <select
                  className="tz-text-input"
                  value={vigente ? conductor.membresia_paquete_id || "" : ""}
                  onChange={(e) => actualizar({ membresia_paquete_id: e.target.value || null }, "membresia")}
                  disabled={guardando === "membresia" || !vigente}
                >
                  <option value="">Sin membresía</option>
                  {membresias
                    .filter((p) => p.activo !== false || String(p.id) === String(conductor.membresia_paquete_id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre} — {p.dias_membresia} días {formatSoles(p.precio)}
                      </option>
                    ))}
                </select>
                {!vigente && (
                  <small className="tz-stock-editor-sub">
                    Sin membresía vigente: al registrar una recarga queda con el paquete que pague.
                  </small>
                )}
              </label>
              <label className="tz-plan-campo tz-plan-campo-ancho">
                <span>Estado</span>
                <select className="tz-text-input" value={conductor.estado ?? ""} onChange={cambiarEstado} disabled={guardando === "estado"}>
                  {ESTADOS_CONDUCTOR_OPERATIVOS.map((e) => (
                    <option key={e.value} value={e.value}>
                      {e.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </>
        )}

        {apartado === "recarga" && (
          <RecargaRapida
            conductor={conductor}
            paquetes={recargaProps?.paquetes || paquetes}
            registrarRecarga={recargaProps.registrarRecarga}
            saving={recargaProps.saving}
            errorExterno={recargaProps.error}
            onPagado={({ venta, destinatario, montoRecibido }) =>
              setVentaPanel(ventaParaPanel(venta, destinatario, { cajero: "Admin", montoRecibido }))
            }
          />
        )}

        {apartado === "vencimiento" && (
          <div className="tz-plan-seccion" style={{ alignItems: "flex-end" }}>
            <label className="tz-plan-campo">
              <span>Vence el</span>
              <input type="date" className="tz-text-input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </label>
            <label className="tz-plan-campo">
              <span>Créditos</span>
              <input
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                className="tz-text-input"
                value={creditos}
                onChange={(e) => setCreditos(e.target.value)}
              />
            </label>
            <button type="button" className="tz-cliente-action-btn" onClick={corregir} disabled={guardando === "fecha"}>
              {guardando === "fecha" ? <Loader2 size={13} className="tz-spin" /> : <CalendarClock size={13} />} Guardar fecha
            </button>
            <p className="tz-stock-editor-sub" style={{ flexBasis: "100%", margin: 0 }}>
              Solo para corregir un error: no registra ninguna venta. Deja la fecha vacía para quitarle la membresía.
            </p>
          </div>
        )}

        {apartado === "pagos" &&
          (susVentas.length === 0 ? (
            <p className="tz-stock-editor-sub">Todavía no hay pagos registrados.</p>
          ) : (
            <div className="tz-cierre-list">
              {susVentas.map((v) => (
                <div key={v.id} className={`tz-receipt tz-receipt-compact ${v.anulado ? "tz-plan-pago-anulado" : ""}`}>
                  <div className="tz-receipt-header">
                    <span className="tz-receipt-title">{v.codigo_venta || "—"}</span>
                    <span className="tz-receipt-date">
                      {formatDate(v.created_at)} · {formatTime(v.created_at)} · {labelMetodo(v.metodo_pago)}
                    </span>
                  </div>
                  <div className="tz-receipt-divider" />
                  <div className="tz-receipt-row">
                    <span>{v.detalle || (v.tipo_item === TIPO_ITEM_MEMBRESIA ? "Membresía" : "Créditos")}</span>
                    <strong>{formatSoles(v.monto)}</strong>
                  </div>
                  <div className="tz-receipt-row tz-plan-pagos-nota">
                    <span>Recolector</span>
                    <span>{recolectorDe(v)}</span>
                  </div>
                  <div className="tz-receipt-divider" />
                  <div className="tz-receipt-row tz-receipt-total">
                    <span>Total</span>
                    <strong>{formatSoles(v.monto)}</strong>
                  </div>
                  {v.voucher_url && (
                    <button type="button" className="tz-comprobante-mini" onClick={() => setVerComprobante(v)} title="Ver comprobante">
                      <img src={v.voucher_url} alt="Comprobante" loading="lazy" />
                      <span>Comprobante adjunto · tocar para ampliar</span>
                    </button>
                  )}
                  {v.anulado ? (
                    <p className="tz-tag tz-tag-danger" style={{ marginTop: 10, textAlign: "center" }}>
                      Anulado
                    </p>
                  ) : confirmandoId === v.id ? (
                    <div className="tz-plan-pago-confirmar" style={{ marginTop: 10 }}>
                      ¿Anular? Se revierte el saldo.
                      <button
                        type="button"
                        className="tz-cliente-action-btn tz-cliente-action-deuda"
                        disabled={busyId === v.id}
                        onClick={() => handleAnular(v)}
                      >
                        {busyId === v.id ? <Loader2 size={13} className="tz-spin" /> : <Trash2 size={13} />} Anular
                      </button>
                      <button type="button" className="tz-cliente-action-btn" onClick={() => setConfirmandoId(null)}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="tz-cliente-actions" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="tz-cliente-action-btn tz-cliente-action-deuda"
                        style={{ flex: 1, justifyContent: "center" }}
                        onClick={() => setConfirmandoId(v.id)}
                      >
                        <Trash2 size={13} /> Anular Venta
                      </button>
                      <button
                        type="button"
                        className="tz-cliente-action-btn tz-cliente-action-pago"
                        style={{ flex: 1, justifyContent: "center" }}
                        onClick={() => setVentaPanel(ventaParaPanel(v, conductor, { cajero: recolectorDe(v) }))}
                      >
                        <Receipt size={13} /> Boleta
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}

        {aviso && (
          <p className="tz-success" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {aviso.startsWith("Esta venta") && <AlertTriangle size={14} />} {aviso}
          </p>
        )}
        {error && <p className="tz-error">{error}</p>}
      </div>

      {verComprobante && (
        <div className="tz-modal-backdrop" style={{ zIndex: 120 }}>
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="tz-modal-close" onClick={() => setVerComprobante(null)} aria-label="Cerrar">
              <X size={18} />
            </button>
            <h2>Comprobante · {verComprobante.codigo_venta}</h2>
            <img src={verComprobante.voucher_url} alt="Comprobante" style={{ width: "100%", borderRadius: 12 }} />
          </div>
        </div>
      )}

      <PanelVentaRegistrada venta={ventaPanel} onCerrar={() => setVentaPanel(null)} />
    </div>
  );
}
