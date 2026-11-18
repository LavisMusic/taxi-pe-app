import { useEffect, useState } from "react";
import { Wallet, X, Loader2, Camera, RotateCcw } from "lucide-react";
import BotonPegarComprobante from "../BotonPegarComprobante";
import ComprobanteScannerModal from "./ComprobanteScannerModal";
import { formatSoles } from "../../utils/format";
import { METODOS_PAGO, METODO_PAGO_EFECTIVO, TIPO_ITEM_MEMBRESIA } from "../../lib/taxiEnums";
import TarjetasPlanes from "../TarjetasPlanes";
import { itemsDeMembresias } from "../../lib/membresias";
import DatosPagoComprobante from "../DatosPagoComprobante";
import { useContactoPlataforma } from "../../hooks/useContactoPlataforma";
import { supabase } from "../../supabaseClient";
import CanjeGemas from "../CanjeGemas";

const METODOS_AUTORECARGA = METODOS_PAGO.filter((m) => m.key !== METODO_PAGO_EFECTIVO);

// Autorecarga: el propio Recolector compra su MEMBRESÍA (días + cupo de
// conductores, fase 3b de gemas) desde /recolector. Crea una PETICIÓN
// pendiente que el Admin aprueba en el Centro de Peticiones. Puede
// comprar cuando su membresía venció o se le acabó el cupo (empieza un
// periodo nuevo). Canjea sus gemas verdes, encendido por defecto.
export default function AutorecargaRecolectorModal({ recolector, paquetes, glowPaquetes = false, crearPeticion, onClose }) {
  const [paqueteId, setPaqueteId] = useState("");
  const [metodoPago, setMetodoPago] = useState("");
  const [comprobante, setComprobante] = useState(null);
  // El botón de comprobante aparece después de copiar el número (+8 s).
  const [comprobanteListo, setComprobanteListo] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const contacto = useContactoPlataforma();

  const paquetesActivos = paquetes.filter((p) => p.tipo_item === TIPO_ITEM_MEMBRESIA && p.activo !== false);
  const paquete = paquetesActivos.find((p) => String(p.id) === String(paqueteId)) || null;

  // Canje de gemas (y si ya puede comprar).
  const [canje, setCanje] = useState(null);
  const [usarGemas, setUsarGemas] = useState(true);
  useEffect(() => {
    setCanje(null);
    if (!paquete || !recolector?.id) return undefined;
    let vigente = true;
    supabase
      .rpc("taxi_gemas_canje_recolector", { p_recolector_id: recolector.id, p_paquete_id: String(paquete.id) })
      .then(({ data, error: e }) => {
        if (vigente && !e && data) setCanje(data);
      });
    return () => {
      vigente = false;
    };
  }, [paquete?.id, recolector?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const descuento = usarGemas && Number(canje?.n) > 0 ? Number(canje.monto) || 0 : 0;
  const aPagar = paquete ? Math.max(Math.round((Number(paquete.precio) - descuento) * 100) / 100, 0) : 0;
  // ¿Ya puede comprar? Se consulta al abrir (con la primera membresía): con
  // una vigente y con cupo no se muestran las opciones ni se puede seguir.
  const [bloqueo, setBloqueo] = useState(null); // null = consultando
  const primeraId = paquetesActivos[0]?.id;
  useEffect(() => {
    if (!primeraId || !recolector?.id) {
      setBloqueo(false);
      return undefined;
    }
    let vivo = true;
    supabase
      .rpc("taxi_gemas_canje_recolector", { p_recolector_id: recolector.id, p_paquete_id: String(primeraId) })
      .then(({ data, error: e }) => {
        if (vivo) setBloqueo(!e && data?.puede === false);
      });
    return () => {
      vivo = false;
    };
  }, [primeraId, recolector?.id]);
  const noPuede = bloqueo === true || (canje && canje.puede === false);
  // Imagen pegada: va directo al lector del comprobante.
  const [archivoPegado, setArchivoPegado] = useState(null);

  const elegirMetodo = (key) => {
    setMetodoPago(key);
    setComprobante(null);
  };

  const handleEnviar = async () => {
    setError("");
    setSuccessMsg("");
    if (!paquete) return setError("Elige una membresía.");
    if (noPuede) return setError("Tu membresía sigue vigente y con cupo.");
    if (!metodoPago) return setError("Elige cómo vas a pagar.");
    if (!comprobante) return setError("Escanea el comprobante antes de enviar la solicitud.");
    setSaving(true);
    const { error: submitError } = await crearPeticion({
      recolector,
      paquete,
      metodoPago,
      comprobanteUrl: comprobante.voucherUrl,
      usarGemas: descuento > 0,
      autoAprobar: false,
    });
    setSaving(false);
    if (submitError) {
      setError(submitError.message || "No se pudo enviar la solicitud.");
      return;
    }
    setSuccessMsg("Solicitud enviada — el Admin la va a revisar en el Centro de Peticiones.");
    setPaqueteId("");
    setMetodoPago("");
    setComprobante(null);
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Wallet size={17} /> Mi membresía
          </h2>

          <label className="tz-field-label">1. Elige tu membresía</label>
          {/* Mismo selector que la renovación del negocio y el conductor
              (TarjetasPlanes.jsx): píldora "Por mes | Por año" y tarjetas. */}
          {bloqueo === false && !noPuede && (
            <TarjetasPlanes
              items={itemsDeMembresias(paquetesActivos, (p) => `${p.dias_membresia} días · ${p.cupo_conductores || 0} conductores`)}
              seleccionado={paqueteId}
              onElegir={(id) => setPaqueteId(String(id))}
              vacio={<p className="tz-stock-editor-sub">Ninguna membresía configurada todavía.</p>}
            />
          )}
          {glowPaquetes && (
            <p className="tz-camera-note" style={{ margin: "4px 0 0", color: "var(--pink)" }}>
              ✨ El Admin actualizó el catálogo — revisa las opciones.
            </p>
          )}
          {noPuede && (
            <p className="tz-error">Tu membresía sigue vigente y con cupo: podrás comprar otra cuando se te acabe el cupo o venza.</p>
          )}

          {/* Paso 2 recién con una membresía elegida (y si puede comprar). */}
          {paquete && !noPuede && (
            <div className="tz-paso" key={paqueteId}>
              <CanjeGemas color="verde" canje={canje} precio={paquete.precio} activo={usarGemas} onCambiar={setUsarGemas} />

              <label className="tz-field-label" style={{ marginTop: 12 }}>
                2. ¿Cómo vas a pagar?
              </label>
              <div className="tz-gasto-tipo-buttons">
                {METODOS_AUTORECARGA.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className={`tz-gasto-tipo-btn tz-metodo-btn tz-metodo-btn-${m.key} ${
                      metodoPago === m.key ? "tz-gasto-tipo-active" : ""
                    }`}
                    onClick={() => elegirMetodo(m.key)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <DatosPagoComprobante
                metodo={metodoPago}
                datos={{ yape_plin: contacto.yape_plin, titular: contacto.titular, cuenta: contacto.cuenta_bancaria }}
                pedirComprobante={false}
                sinDatosTexto="Todavía no hay datos de pago configurados. Escríbenos a soporte."
                onListoComprobante={setComprobanteListo}
              />

              {metodoPago && (comprobanteListo || comprobante) && (
                <div className="tz-add-entry tz-pagoc-comprobante" style={{ marginTop: 4 }}>
                  {comprobante ? (
                    <div className="tz-scan-result">
                      <p className="tz-scan-result-title">Comprobante listo</p>
                      <div className="tz-scan-result-row">
                        <span>ID operación:</span>
                        <strong>{comprobante.opId || "s/d"}</strong>
                      </div>
                      <button
                        type="button"
                        className="tz-camera-cancel tz-image-manager-btn"
                        style={{ marginTop: 8 }}
                        onClick={() => setScannerOpen(true)}
                      >
                        <RotateCcw size={14} /> Volver a escanear
                      </button>
                    </div>
                  ) : (
                    <>
                      <button type="button" className="tz-scan-btn tz-pagoc-adjuntar" onClick={() => setScannerOpen(true)}>
                        <Camera size={16} /> Adjuntar comprobante
                      </button>
                      <BotonPegarComprobante
                        onArchivo={(f) => {
                          setArchivoPegado(f);
                          setScannerOpen(true);
                        }}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {error && <p className="tz-error">{error}</p>}
          {successMsg && <p className="tz-success">{successMsg}</p>}

          {!noPuede && (comprobante || saving) && (
            <button
              type="button"
              className="tz-scan-btn tz-payment-save tz-pagoc-enviar"
              disabled={saving || noPuede}
              onClick={handleEnviar}
              style={{ marginTop: 14 }}
            >
              {saving ? <Loader2 size={16} className="tz-spin" /> : <Wallet size={16} />}
              {saving ? "Enviando…" : `Enviar solicitud${paquete ? ` de ${formatSoles(aPagar)}` : ""}`}
            </button>
          )}
        </div>
      </div>

      {scannerOpen && (
        <ComprobanteScannerModal
          precioEsperado={paquete ? aPagar : undefined}
          archivoInicial={archivoPegado}
          onConfirm={(data) => {
            setComprobante(data);
            setScannerOpen(false);
            setArchivoPegado(null);
          }}
          onClose={() => {
            setScannerOpen(false);
            setArchivoPegado(null);
          }}
        />
      )}
    </div>
  );
}
