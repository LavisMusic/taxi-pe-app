import { useEffect, useState } from "react";
import { X, MapPin, Store, PackageCheck, QrCode, KeyRound, Loader2, Send, Check, CheckCheck } from "lucide-react";
import { useEntregaChat } from "../../hooks/useEntregaChat";
import { formatSoles } from "../../utils/format";
import EscanerQrModal from "./EscanerQrModal";
import MapaEntrega from "./MapaEntrega";

// Pantalla de la entrega en curso para el repartidor. Ver DELIVERY.md §7.
//   aceptado → (Pedido recogido y pagado en la Caja) → en_ruta → entregado
//
// Finalizar: primero SIEMPRE el QR del cliente (codifica el PIN). Tras 3
// intentos fallidos —o si no hay cámara / se niega el permiso— se
// habilita el input de PIN como respaldo.

const HILOS = [
  { key: "cliente_conductor", label: "Cliente" },
  { key: "cajero_conductor", label: "Sucursal" },
];
const MAX_INTENTOS_QR = 3;

function Chat({ entregaId, conductorId, hilo }) {
  const { mensajes, enviar, enviando, marcarLeido } = useEntregaChat({
    entregaId,
    conductorId,
    emisorRol: "conductor",
  });
  const [texto, setTexto] = useState("");
  const delHilo = mensajes.filter((m) => m.hilo === hilo);
  const noLeidosDeOtro = delHilo.filter((m) => m.emisor_rol !== "conductor" && m.emisor_rol !== "sistema" && !m.leido).length;

  // Marca leídos los del otro cuando este hilo está a la vista.
  useEffect(() => {
    if (noLeidosDeOtro > 0) marcarLeido(hilo);
  }, [hilo, noLeidosDeOtro, marcarLeido]);

  const onEnviar = async () => {
    const t = texto.trim();
    if (!t) return;
    setTexto("");
    await enviar(hilo, t);
  };

  return (
    <div className="tz-entrega-chat">
      <div className="tz-entrega-chat-scroll">
        {delHilo.length === 0 ? (
          <p className="tz-camera-note" style={{ textAlign: "center" }}>Sin mensajes todavía.</p>
        ) : (
          delHilo.map((m) => (
            <div
              key={m.id}
              className={`tz-entrega-msg ${m.emisor_rol === "conductor" ? "tz-entrega-msg-propio" : ""} ${
                m.emisor_rol === "sistema" ? "tz-entrega-msg-sistema" : ""
              }`}
            >
              {m.emisor_rol !== "conductor" && m.emisor_rol !== "sistema" && (
                <span className="tz-entrega-msg-quien">{m.emisor_rol}</span>
              )}
              <span>{m.mensaje}</span>
              {m.emisor_rol === "conductor" && (
                <span className="tz-entrega-msg-check">
                  {m.leido ? <CheckCheck size={13} /> : <Check size={13} />}
                </span>
              )}
            </div>
          ))
        )}
      </div>
      <div className="tz-entrega-chat-input">
        <input
          className="tz-text-input"
          placeholder="Escribe un mensaje…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEnviar()}
        />
        <button className="tz-scan-btn tz-payment-save" onClick={onEnviar} disabled={enviando || !texto.trim()}>
          {enviando ? <Loader2 size={16} className="tz-spin" /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
}

export default function EntregaActivaModal({ entrega, conductorId, onClose, avanzar, finalizar }) {
  const [hilo, setHilo] = useState("cliente_conductor");
  const [escaneando, setEscaneando] = useState(false);
  const [intentosQr, setIntentosQr] = useState(0);
  const [pinForzado, setPinForzado] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const estado = entrega.estado;
  const pinDisponible = pinForzado || intentosQr >= MAX_INTENTOS_QR;
  const dir = entrega.direccion_entrega || "";
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    entrega.entrega_lat && entrega.entrega_lng ? `${entrega.entrega_lat},${entrega.entrega_lng}` : dir
  )}`;

  const marcarRecogido = async () => {
    setBusy(true);
    setMsg("");
    const r = await avanzar(entrega.id, "en_ruta");
    setBusy(false);
    if (r?.status && r.status !== "ok") setMsg(`No se pudo (${r.status}).`);
  };

  // Intenta finalizar con un código (del QR o del PIN). Devuelve true si cerró.
  const intentarFinalizar = async (codigo) => {
    setBusy(true);
    setMsg("");
    const r = await finalizar(entrega.id, codigo);
    setBusy(false);
    if (r?.status === "ok") {
      onClose();
      return true;
    }
    setMsg(
      r?.status === "pin_incorrecto"
        ? "El código no corresponde a esta entrega."
        : `No se pudo finalizar (${r?.status}).`
    );
    return false;
  };

  const onQrLeido = async (texto) => {
    setEscaneando(false);
    const ok = await intentarFinalizar(texto);
    if (!ok) {
      setIntentosQr((n) => n + 1);
      setMsg("Ese QR no corresponde a esta entrega. Intentá de nuevo.");
    }
  };

  const onQrTimeout = () => {
    setEscaneando(false);
    setIntentosQr((n) => n + 1);
    setMsg("No se pudo leer el QR. Volvé a intentar.");
  };

  const onSinCamara = (m) => {
    setEscaneando(false);
    setPinForzado(true);
    setMsg(`${m} Ingresá el PIN que el cliente recibió por WhatsApp.`);
  };

  const onConfirmarPin = async () => {
    if (pin.trim().length < 4) {
      setMsg("Ingresá el PIN completo.");
      return;
    }
    await intentarFinalizar(pin);
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>

        <h2>Entrega en curso</h2>
        <span className={`tz-entrega-badge tz-entrega-badge-${estado}`}>{estado.replace("_", " ")}</span>

        <div className="tz-method-history" style={{ marginTop: 12 }}>
          <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{entrega.cliente_nombre || "Cliente"}</p>
          <p className="tz-camera-note" style={{ margin: "0 0 4px", display: "flex", gap: 6 }}>
            <MapPin size={14} /> {dir || "Sin dirección"}
          </p>
          {entrega.caja_sucursal && (
            <p className="tz-camera-note" style={{ margin: "0 0 4px", display: "flex", gap: 6 }}>
              <Store size={14} /> {entrega.caja_sucursal}
            </p>
          )}
          {entrega.total != null && (
            <p className="tz-camera-note" style={{ margin: 0 }}>Total del pedido: {formatSoles(entrega.total)}</p>
          )}
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="tz-camera-cancel tz-image-manager-btn"
            style={{ marginTop: 8, display: "inline-flex" }}
          >
            <MapPin size={14} /> Abrir en Google Maps
          </a>
        </div>

        {/* El mapa se DESMONTA mientras el escáner está abierto — leaflet
            usa z-index altos y se filtraba por encima del modal. */}
        {!escaneando && (
          <MapaEntrega
            entregaId={entrega.id}
            conductorId={entrega.conductor_id || conductorId}
            destino={
              entrega.entrega_lat && entrega.entrega_lng
                ? { lat: Number(entrega.entrega_lat), lng: Number(entrega.entrega_lng) }
                : null
            }
            origen={
              entrega.origen_lat != null
                ? { lat: Number(entrega.origen_lat), lng: Number(entrega.origen_lng) }
                : null
            }
            posInicial={
              entrega.repartidor_lat != null
                ? { lat: Number(entrega.repartidor_lat), lng: Number(entrega.repartidor_lng), at: entrega.repartidor_pos_at }
                : null
            }
          />
        )}

        {/* Acción según estado */}
        <div style={{ marginTop: 12 }}>
          {estado === "aceptado" && (
            <button className="tz-scan-btn tz-payment-save" style={{ width: "100%" }} disabled={busy} onClick={marcarRecogido}>
              {busy ? <Loader2 size={16} className="tz-spin" /> : <PackageCheck size={16} />} Pedido recogido y pagado
            </button>
          )}

          {estado === "en_ruta" && (
            <>
              <button
                className="tz-scan-btn tz-payment-save"
                style={{ width: "100%" }}
                disabled={busy}
                onClick={() => { setMsg(""); setEscaneando(true); }}
              >
                <QrCode size={16} /> Escanear QR y finalizar
                {intentosQr > 0 && !pinDisponible ? ` (intento ${intentosQr + 1}/${MAX_INTENTOS_QR})` : ""}
              </button>

              {pinDisponible && (
                <div className="tz-add-entry" style={{ marginTop: 10 }}>
                  <label className="tz-field-label">
                    <KeyRound size={13} style={{ verticalAlign: "-2px" }} /> PIN del cliente (respaldo)
                  </label>
                  <input
                    className="tz-amount-input"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="______"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  />
                  <div className="tz-add-entry-actions">
                    <button className="tz-scan-btn tz-payment-save" disabled={busy} onClick={onConfirmarPin}>
                      {busy ? <Loader2 size={16} className="tz-spin" /> : <PackageCheck size={16} />} Confirmar entrega
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {msg && <p className="tz-error" style={{ marginTop: 8 }}>{msg}</p>}

        {/* Chat: cliente / sucursal */}
        <div className="tz-gasto-tipo-buttons" style={{ marginTop: 16 }}>
          {HILOS.map((h) => (
            <button
              key={h.key}
              type="button"
              className={`tz-gasto-tipo-btn ${hilo === h.key ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => setHilo(h.key)}
            >
              {h.label}
            </button>
          ))}
        </div>
        <Chat entregaId={entrega.id} conductorId={conductorId} hilo={hilo} />
      </div>

      {escaneando && (
        <EscanerQrModal
          onLeido={onQrLeido}
          onTimeout={onQrTimeout}
          onSinCamara={onSinCamara}
          onCancelar={() => setEscaneando(false)}
        />
      )}
    </div>
  );
}
