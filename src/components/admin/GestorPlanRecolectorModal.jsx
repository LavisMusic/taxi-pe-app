import { useEffect, useMemo, useState } from "react";
import { X, Zap, Loader2, CreditCard, Camera, ImagePlus, CalendarClock, RotateCcw } from "lucide-react";
import { formatSoles, formatDate, formatTime } from "../../utils/format";
import {
  METODOS_PAGO,
  METODOS_CON_COMPROBANTE,
  METODO_PAGO_EFECTIVO,
  METODO_PAGO_FIADO,
  TIPO_ITEM_MEMBRESIA,
  ESTADO_RECARGA_APROBADO,
  ESTADO_RECARGA_RECHAZADO,
} from "../../lib/taxiEnums";
import { subirComprobante } from "../../lib/comprobantes";
import Dropdown from "../Dropdown";
import BotonPegarComprobante from "../BotonPegarComprobante";
import CanjeGemas from "../CanjeGemas";
import { supabase } from "../../supabaseClient";

// Gestor del plan de UN recolector (botón ⚡ de su tarjeta en el
// Directorio del Admin, categoría "Recolectores") — el mismo diseño que el
// gestor del conductor (GestorRecargaConductorModal). Fase 3b de gemas:
// los recolectores compran una MEMBRESÍA con días y cupo de conductores
// distintos que pueden atender en su periodo (los créditos ya no existen).
//   * Membresía y cupo: tarjetas (vence, cupo usado, teléfono).
//   * Vender membresía: paquetes de recolectores con canje de sus gemas
//     verdes; comprobante OBLIGATORIO si es digital; vuelto si es
//     efectivo. La base la aprueba en el acto (empieza un periodo nuevo).
//   * Pagos: sus compras (solo consulta).
const APARTADOS = [
  { id: "estado", label: "Membresía y cupo" },
  { id: "recarga", label: "Vender membresía" },
  { id: "corregir", label: "Corregir membresía" },
  { id: "pagos", label: "Pagos" },
];
const aFechaInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// Corregir sin cobrar: vencimiento, cupo total y, si se pide, reiniciar el
// periodo (los conductores atendidos vuelven a 0). Lo hace la base
// (taxi_corregir_membresia_recolector).
function CorregirMembresia({ recolector, cupo, onHecho }) {
  const [fecha, setFecha] = useState(aFechaInput(recolector.membresia_vencimiento));
  const [cupoTotal, setCupoTotal] = useState(String(cupo?.cupo ?? ""));
  const [reiniciar, setReiniciar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (cupo && cupoTotal === "") setCupoTotal(String(cupo.cupo ?? 0));
  }, [cupo]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async () => {
    setError("");
    const n = Number(cupoTotal);
    if (fecha && (!Number.isInteger(n) || n < 0)) return setError("El cupo debe ser un número entero (0 o más).");
    setGuardando(true);
    const { error: e } = await supabase.rpc("taxi_corregir_membresia_recolector", {
      p_recolector_id: recolector.id,
      // Fin del día elegido (hora de Perú, UTC-5); vacío = sin membresía.
      p_vence: fecha ? new Date(`${fecha}T23:59:59-05:00`).toISOString() : null,
      p_cupo: fecha ? n : null,
      p_reiniciar: reiniciar,
    });
    setGuardando(false);
    if (e) return setError(e.message || "No se pudo guardar.");
    setReiniciar(false);
    onHecho?.(fecha ? "Membresía corregida." : "Membresía quitada.");
  };

  return (
    <div className="tz-plan-seccion" style={{ alignItems: "flex-end" }}>
      <label className="tz-plan-campo">
        <span>Vence el</span>
        <input type="date" className="tz-text-input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </label>
      <label className="tz-plan-campo">
        <span>Cupo de conductores{cupo ? ` (usados: ${cupo.usado})` : ""}</span>
        <input
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          className="tz-text-input"
          value={cupoTotal}
          onChange={(e) => setCupoTotal(e.target.value)}
          disabled={!fecha}
        />
      </label>
      <button
        type="button"
        className={`tz-gasto-tipo-btn tz-reiniciar-periodo ${reiniciar ? "tz-gasto-tipo-active" : ""}`}
        onClick={() => setReiniciar((v) => !v)}
        disabled={!fecha}
        aria-pressed={reiniciar}
      >
        <RotateCcw size={13} /> Reiniciar el periodo
      </button>
      <button type="button" className="tz-cliente-action-btn" onClick={guardar} disabled={guardando}>
        {guardando ? <Loader2 size={13} className="tz-spin" /> : <CalendarClock size={13} />} Guardar
      </button>
      <p className="tz-stock-editor-sub" style={{ flexBasis: "100%", margin: 0 }}>
        Solo corrige: no registra venta ni pago. Deja la fecha vacía para quitarle la membresía.
        {reiniciar ? " Al guardar, los conductores atendidos vuelven a 0 y el periodo empieza hoy." : ""}
      </p>
      {error && <p className="tz-error" style={{ flexBasis: "100%", margin: 0 }}>{error}</p>}
    </div>
  );
}
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

  const activos = paquetes.filter((p) => p.activo !== false && p.tipo_item === TIPO_ITEM_MEMBRESIA);
  const paquete = activos.find((p) => String(p.id) === String(paqueteId)) || null;
  // Canje de sus gemas verdes (encendido por defecto) y si ya puede comprar.
  const [canje, setCanje] = useState(null);
  const [usarGemas, setUsarGemas] = useState(true);
  useEffect(() => {
    setCanje(null);
    if (!paquete) return undefined;
    let vigente = true;
    supabase
      .rpc("taxi_gemas_canje_recolector", { p_recolector_id: recolector.id, p_paquete_id: String(paquete.id) })
      .then(({ data, error: e }) => {
        if (vigente && !e && data) setCanje(data);
      });
    return () => {
      vigente = false;
    };
  }, [paquete?.id, recolector.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const descuento = usarGemas && Number(canje?.n) > 0 ? Number(canje.monto) || 0 : 0;
  const noPuede = canje && canje.puede === false;
  const total = Math.max(Math.round(((Number(paquete?.precio) || 0) - descuento) * 100) / 100, 0);
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
    if (!paquete) return setError("Elige la membresía que compró.");
    if (noPuede) return setError("Su membresía sigue vigente y con cupo: podrá comprar otra cuando se le acabe el cupo o venza.");
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
    const { error: err } = await crearPeticion({
      recolector,
      paquete,
      metodoPago: metodo,
      comprobanteUrl,
      usarGemas: descuento > 0,
      autoAprobar: true,
    });
    setEnviando(false);
    if (err) return setError(err.message || "No se pudo registrar la membresía.");
    setArchivo(null);
    setPreview("");
    setRecibido("");
    setMetodo("");
    setPaqueteId("");
    onHecho?.(`Membresía activada para ${recolector.nombre}: ${paquete.nombre}.`);
  };

  return (
    <>
      <label className="tz-field-label">Membresía</label>
      <Dropdown
        value={paqueteId}
        onChange={(v) => setPaqueteId(String(v))}
        options={activos.map((p) => ({
          value: String(p.id),
          label: `${p.nombre} — ${p.dias_membresia} días · ${p.cupo_conductores || 0} conductores · ${formatSoles(p.precio)}`,
        }))}
        placeholder={activos.length === 0 ? "No hay membresías de recolector" : "Elige una membresía…"}
        ariaLabel="Membresía"
      />
      {noPuede && <p className="tz-error">Su membresía sigue vigente y con cupo: podrá comprar otra cuando se le acabe el cupo o venza.</p>}
      {paquete && !noPuede && (
        <CanjeGemas color="verde" quien="sus" canje={canje} precio={paquete.precio} activo={usarGemas} onCambiar={setUsarGemas} />
      )}
      {paquete && (
        <p className="tz-plan-total" style={{ margin: "8px 0 0" }}>
          Total: <strong>{formatSoles(total)}</strong> · {paquete.dias_membresia} días · {paquete.cupo_conductores || 0} conductores
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
          <BotonPegarComprobante onArchivo={(f) => elegirArchivo({ target: { files: [f], value: "" } })} />
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
        disabled={enviando || noPuede}
      >
        {enviando ? <Loader2 size={15} className="tz-spin" /> : <Zap size={15} />} Activar membresía
        {paquete ? ` de ${formatSoles(total)}` : ""}
      </button>
    </>
  );
}

export default function GestorPlanRecolectorModal({ recolector, paquetes = [], peticiones = [], crearPeticion, onCorregido, onClose }) {
  const [apartado, setApartado] = useState("estado");
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  // Cupo del periodo (conductores distintos atendidos).
  const [cupo, setCupo] = useState(null);
  useEffect(() => {
    let vigente = true;
    supabase.rpc("taxi_cupo_recolector", { p_recolector_id: recolector.id }).then(({ data, error: e }) => {
      if (vigente && !e && data) setCupo(data);
    });
    return () => {
      vigente = false;
    };
  }, [recolector.id, aviso]);

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


  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <h2>
          <CreditCard size={17} /> Membresía · {recolector.nombre}
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
                <span>Cupo usado</span>
                <strong>{cupo ? `${cupo.usado} de ${cupo.cupo}` : "—"}</strong>
              </div>
              <div className="tz-gestor-recarga-dato">
                <span>Teléfono</span>
                <strong>{recolector.telefono || "Sin registrar"}</strong>
              </div>
            </div>
            <p className="tz-stock-editor-sub" style={{ margin: "8px 0 0" }}>
              Cada conductor distinto al que le vende membresía en su periodo usa 1 cupo. Al acabarse el cupo o vencer,
              puede comprar otra membresía en el acto.
            </p>
          </>
        )}

        {apartado === "recarga" && (
          <RecargaRapida recolector={recolector} paquetes={paquetes} crearPeticion={crearPeticion} onHecho={setAviso} />
        )}


        {apartado === "corregir" && (
          <CorregirMembresia
            key={recolector.membresia_vencimiento || "sin"}
            recolector={recolector}
            cupo={cupo}
            onHecho={(msg) => {
              setAviso(msg);
              onCorregido?.();
            }}
          />
        )}

        {apartado === "pagos" &&
          (susCompras.length === 0 ? (
            <p className="tz-stock-editor-sub">Todavía no compró membresía.</p>
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
                    <span>
                      Membresía · {p.dias_membresia} días{p.cupo_conductores ? ` · ${p.cupo_conductores} conductores` : ""}
                      {Number(p.gemas_usadas) > 0 ? ` · ${p.gemas_usadas} gemas` : ""}
                    </span>
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
