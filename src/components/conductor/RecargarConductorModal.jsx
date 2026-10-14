import { useEffect, useState } from "react";
import { X, Wallet, Camera, ImagePlus, Loader2, Check, Clock, XCircle } from "lucide-react";
import { formatSoles, formatDate } from "../../utils/format";
import {
  TIPO_ITEM_MEMBRESIA,
  TIPO_ITEM_CREDITOS,
  METODO_PAGO_YAPE,
  METODO_PAGO_PLIN,
  METODO_PAGO_OTROS,
  ESTADO_RECARGA_RECHAZADO,
  ESTADO_RECARGA_APROBADO,
} from "../../lib/taxiEnums";
import { usePaquetes } from "../../hooks/usePaquetes";
import { useMiRecargaConductor } from "../../hooks/useRecargasConductor";

// "Recargar" del pie de página del conductor: pide membresía o gemas por
// su cuenta (Yape/Plin/Otros + foto del comprobante, obligatoria). La
// solicitud queda en revisión hasta que el Admin la aprueba en el Centro
// de Peticiones. Misma regla que la recarga del Admin: con la membresía
// vigente no se recarga ni membresía ni gemas.
const TIPOS = [
  { id: TIPO_ITEM_MEMBRESIA, label: "Membresía" },
  { id: TIPO_ITEM_CREDITOS, label: "Gemas" },
];
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

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const vigente = conductor.vencimiento_suscripcion && new Date(conductor.vencimiento_suscripcion) > new Date();
  const activos = paquetes.filter((p) => p.activo !== false && p.tipo_item === tipo);
  const paquete = activos.find((p) => String(p.id) === String(paqueteId)) || null;

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
    const r = await crear({ paquete, metodoPago: metodo, archivo });
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
        <p className="tz-stock-editor-sub">Podrás recargar membresía o gemas cuando termine.</p>
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
        <div className="tz-plan-filtros">
          {TIPOS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`tz-gasto-tipo-btn ${tipo === t.id ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => {
                setTipo(t.id);
                setPaqueteId("");
                setError("");
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="tz-field-label">Paquete</label>
        <select className="tz-text-input" value={paqueteId} onChange={(e) => setPaqueteId(e.target.value)}>
          <option value="">{activos.length === 0 ? "No hay paquetes disponibles" : "Elige un paquete…"}</option>
          {activos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre} — {p.tipo_item === TIPO_ITEM_MEMBRESIA ? `${p.dias_membresia} días` : `${p.creditos} gemas`} ·{" "}
              {formatSoles(p.precio)}
            </option>
          ))}
        </select>
        {paquete?.descripcion && (
          <p className="tz-camera-note" style={{ margin: "6px 0 0" }}>
            {paquete.descripcion}
          </p>
        )}

        <label className="tz-field-label" style={{ marginTop: 12 }}>
          ¿Cómo pagaste?
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

        {error && <p className="tz-error">{error}</p>}
        <button
          type="button"
          className="tz-scan-btn tz-payment-save"
          style={{ width: "100%", marginTop: 14 }}
          onClick={enviar}
          disabled={enviando}
        >
          {enviando ? <Loader2 size={15} className="tz-spin" /> : <Wallet size={15} />} Enviar solicitud
          {paquete ? ` de ${formatSoles(paquete.precio)}` : ""}
        </button>
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
