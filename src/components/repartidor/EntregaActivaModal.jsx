import { useEffect, useState } from "react";
import { X, MapPin, Store, PackageCheck, QrCode, KeyRound, Loader2, Send, Check, CheckCheck, Navigation, User } from "lucide-react";
import { useEntregaChat } from "../../hooks/useEntregaChat";
import { useEscribiendo } from "../../hooks/useEscribiendo";
import { supabase } from "../../supabaseClient";
import PuntosEscribiendo from "../PuntosEscribiendo";
import { formatSoles } from "../../utils/format";
import EscanerQrModal from "./EscanerQrModal";
import EntradaChat from "../chat/EntradaChat";
import AdjuntoMensaje from "../chat/AdjuntoMensaje";
import { claseNota } from "../../lib/adjuntosChat";
import MapaEntrega from "./MapaEntrega";

// Pantalla de la entrega en curso para el repartidor. Ver DELIVERY.md §7.
//   aceptado → (Pedido recogido y pagado en la Caja) → en_ruta → entregado
//
// Finalizar: primero SIEMPRE el QR del cliente (codifica el PIN). Tras 3
// intentos fallidos —o si no hay cámara / se niega el permiso— se
// habilita el input de PIN como respaldo.

// Los chats con la tienda y con el cliente viven en Mensajes ("Tus
// entregas"); acá solo los botones que abren cada uno.
const CHATS = [
  { hilo: "cajero_conductor", label: "Chat tienda", icono: Store },
  { hilo: "cliente_conductor", label: "Chat cliente", icono: User },
];
const MAX_INTENTOS_QR = 3;

function Chat({ entregaId, conductorId, hilo }) {
  const { mensajes, enviar, marcarLeido } = useEntregaChat({
    entregaId,
    conductorId,
    emisorRol: "conductor",
  });
  const delHilo = mensajes.filter((m) => m.hilo === hilo);
  const { escribiendo, avisar, apagar } = useEscribiendo(supabase, entregaId ? `entrega-${entregaId}-${hilo}` : null, "conductor");
  const ultimo = delHilo[delHilo.length - 1];
  useEffect(() => {
    if (ultimo && ultimo.emisor_rol !== "conductor") apagar();
  }, [ultimo?.id, ultimo?.emisor_rol, apagar]);
  const noLeidosDeOtro = delHilo.filter((m) => m.emisor_rol !== "conductor" && m.emisor_rol !== "sistema" && !m.leido).length;

  // Marca leídos los del otro cuando este hilo está a la vista.
  useEffect(() => {
    if (noLeidosDeOtro > 0) marcarLeido(hilo);
  }, [hilo, noLeidosDeOtro, marcarLeido]);

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
              } ${claseNota(m.mensaje)}`}
            >
              {m.emisor_rol !== "conductor" && m.emisor_rol !== "sistema" && (
                <span className="tz-entrega-msg-quien">{m.emisor_rol}</span>
              )}
              <AdjuntoMensaje
                texto={m.mensaje}
                claseBurbuja={`tz-entrega-msg ${m.emisor_rol === "conductor" ? "tz-entrega-msg-propio" : ""}`}
              >
                <span>{m.mensaje}</span>
              </AdjuntoMensaje>
              {m.emisor_rol === "conductor" && (
                <span className="tz-entrega-msg-check">
                  {m.leido ? <CheckCheck size={13} /> : <Check size={13} />}
                </span>
              )}
            </div>
          ))
        )}
        {escribiendo && <PuntosEscribiendo quien={escribiendo === "cajero" ? "La tienda" : "El cliente"} />}
      </div>
      <div className="tz-entrega-chat-input">
        <EntradaChat onEnviar={(t) => enviar(hilo, t)} onEscribir={avisar} />
      </div>
    </div>
  );
}

export default function EntregaActivaModal({ entrega, conductorId, onClose, avanzar, finalizar, onEntregado, noLeidos = null }) {
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
  // Waze solo entiende coordenadas (no una dirección de texto libre) —
  // si el pedido no tiene lat/lng todavía, no hay link posible.
  const wazeUrl =
    entrega.entrega_lat && entrega.entrega_lng
      ? `https://waze.com/ul?ll=${entrega.entrega_lat},${entrega.entrega_lng}&navigate=yes`
      : null;

  // ---- Pago del envío al recoger (contrato, migración 20261107100000):
  // la tienda paga, el repartidor confirma, y recién ahí puede salir. Se
  // vuelve a leer cada pocos segundos mientras espera el pago.
  const [pagoLeido, setPagoLeido] = useState(null);
  const filaPago = pagoLeido && pagoLeido.id === entrega.id ? pagoLeido : entrega;
  const pago = {
    tarifa: Number(filaPago.tarifa) || 0,
    pagadoAt: filaPago.envio_pagado_at || null,
    metodo: filaPago.envio_pago_metodo || null,
    monto: Number(filaPago.envio_monto_pagado) || 0,
    recibidoAt: filaPago.envio_recibido_at || null,
    noRecibidoAt: filaPago.envio_no_recibido_at || null,
  };
  pago.falta = !!filaPago.pago_envio_requerido && pago.tarifa > 0 && !pago.recibidoAt;
  const releerPago = async () => {
    const { data } = await supabase.rpc("rpc_entrega_activa_conductor", { p_conductor_id: conductorId });
    const fila = (data || []).find((e) => e.id === entrega.id);
    if (fila) setPagoLeido(fila);
  };
  useEffect(() => {
    if (estado !== "aceptado" || !pago.falta) return undefined;
    const t = setInterval(releerPago, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, pago.falta, entrega.id]);

  const confirmarPago = async (recibido) => {
    setBusy(true);
    setMsg("");
    const { data, error: e } = await supabase.rpc("rpc_entrega_confirmar_pago", {
      p_entrega_id: entrega.id,
      p_recibido: recibido,
    });
    setBusy(false);
    if (e || (data?.status && data.status !== "ok")) setMsg("No se pudo confirmar el pago. Intenta de nuevo.");
    releerPago();
  };

  const marcarRecogido = async () => {
    setBusy(true);
    setMsg("");
    const r = await avanzar(entrega.id, "en_ruta");
    setBusy(false);
    if (r?.status === "falta_pago_envio") {
      setMsg("Primero confirma que recibiste el pago del envío.");
      releerPago();
    } else if (r?.status && r.status !== "ok") setMsg(`No se pudo (${r.status}).`);
  };

  // Intenta finalizar con un código (del QR o del PIN). Si sale bien,
  // cierra el escáner Y este modal al toque, y avisa a 'onEntregado':
  // la celebración (AnimacionExitoNeon) la monta ConductorPage a
  // pantalla completa — no puede vivir acá ni en el panel de reparto,
  // que se desmonta solo apenas no quedan entregas activas.
  const intentarFinalizar = async (codigo) => {
    setBusy(true);
    setMsg("");
    const r = await finalizar(entrega.id, codigo);
    setBusy(false);
    if (r?.status === "ok") {
      setEscaneando(false);
      onEntregado?.();
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
    const ok = await intentarFinalizar(texto);
    if (!ok) {
      // Si salió bien, intentarFinalizar ya cerró todo.
      setEscaneando(false);
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
    setMsg(`${m} Pídele al cliente el PIN que aparece en su app.`);
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
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="tz-camera-cancel tz-image-manager-btn"
              style={{ display: "inline-flex" }}
            >
              <MapPin size={14} /> Google Maps
            </a>
            {wazeUrl && (
              <a
                href={wazeUrl}
                target="_blank"
                rel="noreferrer"
                className="tz-camera-cancel tz-image-manager-btn"
                style={{ display: "inline-flex" }}
              >
                <Navigation size={14} /> Waze
              </a>
            )}
          </div>
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
          {estado === "aceptado" && pago.falta && !pago.pagadoAt && (
            <div className="tz-pago-envio tz-pago-envio-espera">
              <Loader2 size={15} className="tz-spin" />
              <span>
                Al recoger el pedido, la tienda te paga el envío
                {pago.tarifa > 0 ? ` (${formatSoles(pago.tarifa)})` : ""}. Espera su pago para salir.
              </span>
            </div>
          )}
          {estado === "aceptado" && pago.falta && pago.pagadoAt && (
            <div className="tz-pago-envio tz-pago-envio-pagado">
              <p>
                💵 La tienda te pagó <strong>{formatSoles(pago.monto)}</strong>{" "}
                {pago.metodo === "EFECTIVO" ? "en efectivo" : "por Yape"}.
              </p>
              {pago.noRecibidoAt && <p className="tz-pago-envio-nota">Le avisamos a la tienda que todavía no lo recibes.</p>}
              <div className="tz-pago-envio-acciones">
                <button type="button" className="tz-contrato-btn" disabled={busy} onClick={() => confirmarPago(false)}>
                  No lo recibí
                </button>
                <button type="button" className="tz-contrato-btn tz-contrato-btn-si" disabled={busy} onClick={() => confirmarPago(true)}>
                  {busy ? <Loader2 size={14} className="tz-spin" /> : <Check size={14} />} Recibí el pago
                </button>
              </div>
            </div>
          )}
          {estado === "aceptado" && !pago.falta && (
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

        <div className="tz-entrega-chats-btns">
          {CHATS.map(({ hilo, label, icono: Icono }) => (
            <button
              key={hilo}
              type="button"
              className="tz-camera-cancel tz-image-manager-btn"
              onClick={() => {
                onClose();
                window.dispatchEvent(new CustomEvent("tz-abrir-chat-entrega", { detail: { id: entrega.id, hilo } }));
              }}
              style={{ position: "relative" }}
            >
              <Icono size={14} /> {label}
              {noLeidos?.[hilo] > 0 && <span className="tz-badge-dot">{noLeidos[hilo] > 9 ? "+9" : noLeidos[hilo]}</span>}
            </button>
          ))}
        </div>
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

// Chat de un hilo de la entrega: lo usa Mensajes del conductor ("Tus entregas").
export { Chat as ChatEntregaConductor };
