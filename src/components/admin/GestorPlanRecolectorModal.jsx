import { useEffect, useMemo, useState } from "react";
import { X, Zap, Loader2, Check, CreditCard, Camera, ImagePlus } from "lucide-react";
import { formatSoles, formatDate, formatTime } from "../../utils/format";
import {
  METODOS_PAGO,
  METODOS_CON_COMPROBANTE,
  METODO_PAGO_EFECTIVO,
  METODO_PAGO_FIADO,
  TIPO_ITEM_CREDITOS,
  TIPO_ITEM_MEMBRESIA,
  ESTADO_RECARGA_APROBADO,
  ESTADO_RECARGA_RECHAZADO,
} from "../../lib/taxiEnums";
import { subirComprobante } from "../../lib/comprobantes";
import Dropdown from "../Dropdown";

// Gestor del plan de UN recolector (botón ⚡ de su tarjeta en el
// Directorio del Admin, categoría "Recolectores") — el mismo diseño que el
// gestor del conductor (GestorRecargaConductorModal). Los recolectores
// solo compran paquetes de CRÉDITOS (su mercadería: vender una membresía
// de N días le cuesta N créditos); la membresía que ya tuvieran sigue
// hasta que venza.
//   * Créditos y estado: tarjetas (membresía, vence, créditos, teléfono).
//   * Recarga rápida: paquetes de créditos de recolectores; comprobante
//     OBLIGATORIO si es digital; vuelto si es efectivo. Queda como compra
//     aprobada (peticiones_recarga_recolector).
//   * Corregir créditos: sin registrar venta.
//   * Pagos: sus compras de saldo (solo consulta).
const APARTADOS = [
  { id: "estado", label: "Créditos y estado" },
  { id: "recarga", label: "Recarga rápida" },
  { id: "vencimiento", label: "Corregir créditos" },
  { id: "pagos", label: "Pagos" },
];
const CLASE_METODO = { efectivo: "efectivo", yape: "yape", plin: "plin", otros: "otros" };
const DIAS_AVISO = 7;
const diasHasta = (iso) => (iso ? Math.ceil((new Date(iso) - new Date()) / 86400000) : null);

function estadoMembresia(recolector) {
  const dias = diasHasta(recolector.membresia_vencimiento);
  if (dias == null) return { label: "Sin membresía", color: "var(--text-dim)" };
  if (dias < 0) return { label: "Vencida", color: "var(--danger)" };
  if (dias <= DIAS_AVISO) return { label: "Por vencer", color: "var(--yellow)" };
  return { label: "Activa", color: "var(--green)" };
}

function textoVencimiento(recolector) {
  const dias = diasHasta(recolector.membresia_vencimiento);
  if (dias == null) return "Nunca tuvo membresía.";
  const fecha = formatDate(recolector.membresia_vencimiento);
  if (dias > 1) return `Vence el ${fecha} (en ${dias} días).`;
  if (dias === 1) return `Vence el ${fecha} (mañana).`;
  if (dias === 0) return `Vence hoy (${fecha}).`;
  return `Venció el ${fecha}.`;
}

function RecargaRapida({ recolector, paquetes, crearPeticion, onHecho }) {
  const [paqueteId, setPaqueteId] = useState("");
  const [metodo, setMetodo] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [preview, setPreview] = useState("");
  const [recibido, setRecibido] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const activos = paquetes.filter((p) => p.activo !== false && p.tipo_item === TIPO_ITEM_CREDITOS);
  const paquete = activos.find((p) => String(p.id) === String(paqueteId)) || null;
  const total = Number(paquete?.precio) || 0;
  const esEfectivo = metodo === METODO_PAGO_EFECTIVO;
  const esDigital = METODOS_CON_COMPROBANTE.includes(metodo);
  const recibidoNum = Number(String(recibido).replace(",", "."));
  const vuelto = esEfectivo && Number.isFinite(recibidoNum) && recibido !== "" ? recibidoNum - total : null;

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
    let comprobanteUrl = null;
    if (esDigital) {
      const { url, error: errSubida } = await subirComprobante(archivo, `admin/recolector-${recolector.id}`);
      if (errSubida) {
        setEnviando(false);
        return setError(`No se pudo subir el comprobante: ${errSubida.message || errSubida}`);
      }
      comprobanteUrl = url;
    }
    const { error: err } = await crearPeticion({ recolector, paquete, metodoPago: metodo, comprobanteUrl, autoAprobar: true });
    setEnviando(false);
    if (err) return setError(err.message || "No se pudo registrar la recarga.");
    setArchivo(null);
    setPreview("");
    setRecibido("");
    setMetodo("");
    setPaqueteId("");
    onHecho?.(`Recarga aplicada a ${recolector.nombre}: ${paquete.nombre}.`);
  };

  return (
    <>
      <label className="tz-field-label">Paquete de créditos</label>
      <Dropdown
        value={paqueteId}
        onChange={(v) => setPaqueteId(String(v))}
        options={activos.map((p) => ({
          value: String(p.id),
          label: `${p.nombre} — ${p.creditos} créditos · ${formatSoles(p.precio)}`,
        }))}
        placeholder={activos.length === 0 ? "No hay paquetes de créditos" : "Elige un paquete…"}
        ariaLabel="Paquete"
      />
      {paquete && (
        <p className="tz-plan-total" style={{ margin: "8px 0 0" }}>
          Total: <strong>{formatSoles(total)}</strong> · {paquete.creditos} créditos
        </p>
      )}

      <label className="tz-field-label" style={{ marginTop: 12 }}>
        Método de pago
      </label>
      <div className="tz-gasto-tipo-buttons">
        {METODOS_PAGO.filter((m) => m.key !== METODO_PAGO_FIADO).map((m) => (
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
          <label className="tz-field-label" style={{ marginTop: 12 }} htmlFor="gestor-rec-recibido">
            Efectivo recibido (S/)
          </label>
          <input
            id="gestor-rec-recibido"
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

      {error && <p className="tz-error">{error}</p>}
      <button
        type="button"
        className="tz-scan-btn tz-payment-save"
        style={{ width: "100%", marginTop: 14 }}
        onClick={registrar}
        disabled={enviando}
      >
        {enviando ? <Loader2 size={15} className="tz-spin" /> : <Zap size={15} />} Registrar recarga
        {paquete ? ` de ${formatSoles(total)}` : ""}
      </button>
    </>
  );
}

export default function GestorPlanRecolectorModal({ recolector, paquetes = [], peticiones = [], crearPeticion, onUpdate, onClose }) {
  const [apartado, setApartado] = useState("estado");
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState("");
  const [creditos, setCreditos] = useState(String(recolector.creditos_disponibles ?? 0));

  const estado = estadoMembresia(recolector);
  const vigente = (diasHasta(recolector.membresia_vencimiento) ?? -1) >= 0;
  const labelMetodo = (key) => METODOS_PAGO.find((m) => m.key === key)?.label ?? key;

  const susCompras = useMemo(
    () =>
      peticiones
        .filter((p) => p.recolector_id === recolector.id)
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
    [peticiones, recolector.id]
  );

  const actualizar = async (campos, etiqueta) => {
    setError("");
    setAviso("");
    setGuardando(etiqueta);
    const { error: err } = await onUpdate(recolector.id, campos);
    setGuardando("");
    if (err) setError(err.message || "No se pudo guardar.");
    return !err;
  };

  const corregir = async () => {
    const cred = Number(creditos);
    if (!Number.isInteger(cred) || cred < 0) return setError("Los créditos deben ser un número entero (0 o más).");
    const ok = await actualizar({ creditos_disponibles: cred }, "creditos");
    if (ok) setAviso("Corrección guardada.");
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <h2>
          <CreditCard size={17} /> Créditos · {recolector.nombre}
        </h2>
        <p className="tz-brand-sub" style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="tz-plan-badge" style={{ "--tz-plan-color": estado.color }}>
            {estado.label}
          </span>
          {textoVencimiento(recolector)}
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
                if (a.id === "vencimiento") setCreditos(String(recolector.creditos_disponibles ?? 0));
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
                <strong>{vigente ? "Activa" : "Sin membresía"}</strong>
              </div>
              <div className="tz-gestor-recarga-dato">
                <span>Vence</span>
                <strong>{recolector.membresia_vencimiento ? formatDate(recolector.membresia_vencimiento) : "—"}</strong>
              </div>
              <div className="tz-gestor-recarga-dato">
                <span>Créditos</span>
                <strong>{recolector.creditos_disponibles ?? 0}</strong>
              </div>
              <div className="tz-gestor-recarga-dato">
                <span>Teléfono</span>
                <strong>{recolector.telefono || "Sin registrar"}</strong>
              </div>
            </div>
            <p className="tz-stock-editor-sub" style={{ margin: "8px 0 0" }}>
              Los recolectores solo compran créditos: vender una membresía de N días les cuesta N créditos.
              {vigente ? " Su membresía actual sigue hasta que venza." : ""}
            </p>
          </>
        )}

        {apartado === "recarga" && (
          <RecargaRapida recolector={recolector} paquetes={paquetes} crearPeticion={crearPeticion} onHecho={setAviso} />
        )}

        {apartado === "vencimiento" && (
          <div className="tz-plan-seccion" style={{ alignItems: "flex-end" }}>
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
            <button type="button" className="tz-cliente-action-btn" onClick={corregir} disabled={guardando === "creditos"}>
              {guardando === "creditos" ? <Loader2 size={13} className="tz-spin" /> : <Check size={13} />} Guardar créditos
            </button>
            <p className="tz-stock-editor-sub" style={{ flexBasis: "100%", margin: 0 }}>
              Solo para corregir un error: no registra ninguna venta.
            </p>
          </div>
        )}

        {apartado === "pagos" &&
          (susCompras.length === 0 ? (
            <p className="tz-stock-editor-sub">Todavía no compró saldo.</p>
          ) : (
            <div className="tz-cierre-list">
              {susCompras.map((p) => (
                <div key={p.id} className={`tz-receipt tz-receipt-compact ${p.estado === ESTADO_RECARGA_RECHAZADO ? "tz-plan-pago-anulado" : ""}`}>
                  <div className="tz-receipt-header">
                    <span className="tz-receipt-title">{p.paquete_nombre || "Recarga"}</span>
                    <span className="tz-receipt-date">
                      {formatDate(p.created_at)} · {formatTime(p.created_at)} · {labelMetodo(p.metodo_pago)}
                    </span>
                  </div>
                  <div className="tz-receipt-divider" />
                  <div className="tz-receipt-row">
                    <span>{p.tipo_item === TIPO_ITEM_MEMBRESIA ? `Membresía · ${p.dias_membresia} días` : `${p.creditos} créditos`}</span>
                    <strong>{formatSoles(p.monto)}</strong>
                  </div>
                  <div className="tz-receipt-row tz-plan-pagos-nota">
                    <span>Estado</span>
                    <span>{p.estado === ESTADO_RECARGA_APROBADO ? "Aprobada" : p.estado === ESTADO_RECARGA_RECHAZADO ? "Rechazada" : "Pendiente"}</span>
                  </div>
                  {p.comprobante_url && (
                    <a className="tz-comprobante-mini" href={p.comprobante_url} target="_blank" rel="noopener noreferrer" title="Ver comprobante">
                      <img src={p.comprobante_url} alt="Comprobante" loading="lazy" />
                      <span>Comprobante adjunto · tocar para ampliar</span>
                    </a>
                  )}
                </div>
              ))}
            </div>
          ))}

        {error && <p className="tz-error">{error}</p>}
        {aviso && <p className="tz-success">{aviso}</p>}
      </div>
    </div>
  );
}
