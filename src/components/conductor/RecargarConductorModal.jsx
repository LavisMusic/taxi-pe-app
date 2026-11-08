import { useEffect, useState } from "react";
import { X, Wallet, Loader2, Check, Clock, XCircle } from "lucide-react";
import { formatSoles, formatDate } from "../../utils/format";
import {
  TIPO_ITEM_MEMBRESIA,
  METODO_PAGO_YAPE,
  METODO_PAGO_PLIN,
  METODO_PAGO_OTROS,
  ESTADO_RECARGA_RECHAZADO,
  ESTADO_RECARGA_APROBADO,
} from "../../lib/taxiEnums";
import { usePaquetes } from "../../hooks/usePaquetes";
import { useMiRecargaConductor } from "../../hooks/useRecargasConductor";
import Dropdown from "../Dropdown";
import DatosPagoComprobante from "../DatosPagoComprobante";
import { useContactoPlataforma } from "../../hooks/useContactoPlataforma";
import { supabase } from "../../supabaseClient";
import CanjeGemas from "../CanjeGemas";
import IconoGema from "../IconoGema";

// "Recargar" del pie de página del conductor: pide membresía o gemas por
// su cuenta (Yape/Plin/Otros + foto del comprobante, obligatoria). La
// solicitud queda en revisión hasta que el Admin la aprueba en el Centro
// de Peticiones. Misma regla que la recarga del Admin: con la membresía
// vigente no se recarga ni membresía ni gemas.
// Solo membresías (los créditos ya no existen, fase 3b).
const METODOS = [
  { key: METODO_PAGO_YAPE, label: "Yape" },
  { key: METODO_PAGO_PLIN, label: "Plin" },
  { key: METODO_PAGO_OTROS, label: "Otros" },
];

export default function RecargarConductorModal({ conductor, onClose }) {
  const { paquetes } = usePaquetes();
  const { ultima, pendiente, cargando, crear } = useMiRecargaConductor(conductor.id);
  const [tipo, setTipo] = useState(TIPO_ITEM_MEMBRESIA);
  const [paqueteId, setPaqueteId] = useState("");
  const [metodo, setMetodo] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [preview, setPreview] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const contacto = useContactoPlataforma();

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const vigente = conductor.vencimiento_suscripcion && new Date(conductor.vencimiento_suscripcion) > new Date();
  const activos = paquetes.filter((p) => p.activo !== false && p.tipo_item === tipo);
  const paquete = activos.find((p) => String(p.id) === String(paqueteId)) || null;

  // Fase 3a: canjear sus gemas verdes cobradas (solo membresía), encendido
  // por defecto. La base aparta las gemas al enviar y descuenta el monto.
  const [canje, setCanje] = useState(null);
  const [usarGemas, setUsarGemas] = useState(true);
  useEffect(() => {
    setCanje(null);
    if (!paquete || paquete.tipo_item !== TIPO_ITEM_MEMBRESIA) return undefined;
    let vigente = true;
    supabase
      .rpc("taxi_gemas_canje_conductor", { p_conductor_id: conductor.id, p_paquete_id: String(paquete.id) })
      .then(({ data, error: e }) => {
        if (vigente && !e && data) setCanje(data);
      });
    return () => {
      vigente = false;
    };
  }, [paquete?.id, paquete?.tipo_item, conductor.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const descuentoGemas = usarGemas && Number(canje?.n) > 0 ? Number(canje.monto) || 0 : 0;
  const montoAPagar = paquete ? Math.max(Math.round((Number(paquete.precio) - descuentoGemas) * 100) / 100, 0) : 0;

  const elegirArchivo = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setArchivo(f);
    setPreview(URL.createObjectURL(f));
    setError("");
  };

  const enviar = async () => {
    setError("");
    if (!paquete) return setError("Elige un paquete.");
    if (!metodo) return setError("Elige cómo pagaste.");
    if (!archivo) return setError("Toma la foto o adjunta tu comprobante.");
    setEnviando(true);
    const r = await crear({ paquete, metodoPago: metodo, archivo, usarGemas: descuentoGemas > 0 });
    setEnviando(false);
    if (r.error) return setError(r.message);
    setPaqueteId("");
    setMetodo("");
    setArchivo(null);
    setPreview("");
  };

  let contenido;
  if (cargando) {
    contenido = (
      <p className="tz-method-history-empty">
        <Loader2 size={14} className="tz-spin" /> Cargando…
      </p>
    );
  } else if (!conductor.aprobado) {
    contenido = <p className="tz-error">Tu cuenta debe estar aprobada por el Admin para recargar.</p>;
  } else if (pendiente) {
    contenido = (
      <div className="tz-renovar-estado">
        <span className="tz-renovar-estado-icono" style={{ color: "var(--yellow)" }}>
          <Clock size={26} />
        </span>
        <h3 className="tz-recarga-bloqueada">Solicitud en revisión</h3>
        <p className="tz-stock-editor-sub">
          {pendiente.paquete_nombre} · {formatSoles(pendiente.monto)} · enviada el {formatDate(pendiente.created_at)}.
          {Number(pendiente.gemas_usadas) > 0 && (
            <>
              <br />
              <IconoGema color="verde" size={12} /> Canjeaste {pendiente.gemas_usadas} gemas (−{formatSoles(Number(pendiente.gemas_monto))})
            </>
          )}
          <br />
          El Admin la revisará en breve; cuando la apruebe, se activa sola.
        </p>
      </div>
    );
  } else if (vigente) {
    contenido = (
      <div className="tz-renovar-estado">
        <span className="tz-renovar-estado-icono">
          <Check size={26} />
        </span>
        <h3 className="tz-recarga-bloqueada">
          Membresía activa
          <br />
          hasta el {formatDate(conductor.vencimiento_suscripcion)}
        </h3>
        <p className="tz-stock-editor-sub">Podrás renovar tu membresía cuando termine.</p>
      </div>
    );
  } else {
    contenido = (
      <>
        {ultima?.estado === ESTADO_RECARGA_RECHAZADO && (
          <p className="tz-error" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <XCircle size={14} /> El Admin rechazó tu última solicitud ({ultima.paquete_nombre}). Revisa tu comprobante.
          </p>
        )}
        {ultima?.estado === ESTADO_RECARGA_APROBADO && (
          <p className="tz-success">Tu última solicitud ({ultima.paquete_nombre}) fue aprobada.</p>
        )}
        <label className="tz-field-label">Paquete</label>
        <Dropdown
          value={paqueteId}
          onChange={(v) => setPaqueteId(String(v))}
          options={activos.map((p) => ({
            value: String(p.id),
            label: `${p.nombre} — ${
              `${p.dias_membresia} días`
            } · ${formatSoles(p.precio)}`,
          }))}
          placeholder={activos.length === 0 ? "No hay paquetes disponibles" : "Elige un paquete…"}
          ariaLabel="Paquete"
        />
        {paquete?.descripcion && (
          <p className="tz-camera-note" style={{ margin: "6px 0 0" }}>
            {paquete.descripcion}
          </p>
        )}

        {paquete && (
          <CanjeGemas color="verde" canje={canje} precio={paquete.precio} activo={usarGemas} onCambiar={setUsarGemas} />
        )}

        <label className="tz-field-label" style={{ marginTop: 12 }}>
          ¿Cómo pagas?
        </label>
        <div className="tz-gasto-tipo-buttons">
          {METODOS.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`tz-gasto-tipo-btn tz-metodo-btn tz-metodo-btn-${m.key} ${metodo === m.key ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => {
                setMetodo(m.key);
                setError("");
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Datos de pago de la plataforma según el método + las dos
            opciones de comprobante (se despliegan al elegir el método). */}
        <DatosPagoComprobante
          metodo={metodo}
          datos={{ yape_plin: contacto.yape_plin, titular: contacto.titular, cuenta: contacto.cuenta_bancaria }}
          archivo={archivo}
          preview={preview}
          onArchivo={(f) => elegirArchivo({ target: { files: [f], value: "" } })}
          sinDatosTexto="Todavía no hay datos de pago configurados. Escríbenos a soporte."
        />

        {error && <p className="tz-error">{error}</p>}
        {(archivo || enviando) && (
          <button
            type="button"
            className="tz-scan-btn tz-payment-save tz-pagoc-enviar"
            style={{ width: "100%", marginTop: 14 }}
            onClick={enviar}
            disabled={enviando}
          >
            {enviando ? <Loader2 size={15} className="tz-spin" /> : <Wallet size={15} />} Enviar solicitud
            {paquete ? ` de ${formatSoles(montoAPagar)}` : ""}
          </button>
        )}
      </>
    );
  }

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Wallet size={17} /> Recargar
          </h2>
          {contenido}
        </div>
      </div>
    </div>
  );
}
