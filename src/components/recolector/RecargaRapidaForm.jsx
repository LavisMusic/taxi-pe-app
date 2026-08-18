import { useEffect, useState } from "react";
import { Zap, Loader2, UserPlus, Camera, RotateCcw, AlertTriangle } from "lucide-react";
import {
  METODOS_PAGO,
  METODOS_CON_COMPROBANTE,
  METODO_PAGO_EFECTIVO,
  METODO_PAGO_FIADO,
  TIPO_ITEM_CREDITOS,
  TIPO_ITEM_MEMBRESIA,
  NIVELES_SERVICIO,
  NIVEL_SERVICIO_ECONOMICO,
} from "../../lib/taxiEnums";
import { NIVEL_COLOR } from "../../lib/nivelServicio";
import { PAQUETES_DEMO } from "../../lib/paquetesDemo";
import { formatSoles } from "../../utils/format";
import RegistroConductorModal from "./RegistroConductorModal";
import ComprobanteScannerModal from "./ComprobanteScannerModal";

const MONTOS_RAPIDOS = [20, 50, 100, 200];

const nivelLabel = (nivel) => NIVELES_SERVICIO.find((n) => n.value === (nivel || NIVEL_SERVICIO_ECONOMICO))?.label ?? nivel;

// Módulo principal de /recolector (y accesible desde /admin): buscar
// conductor vía combobox (con alta rápida inline si no existe), tipo
// de venta, PAQUETE elegido de un desplegable (nada de monto/cantidad
// a mano — el precio y lo que otorga vienen fijos del paquete, así que
// no hace falta "validar que coincida": coincide siempre, por
// construcción) y método de pago con su lógica propia.
export default function RecargaRapidaForm({
  conductores,
  categorias,
  subgrupos,
  recolectorId,
  registrarRecarga,
  crearConductor,
  saving,
  error,
  paquetes = [],
  // Cuando se abre desde el botón de recarga directa de una tarjeta
  // del Directorio (admin), ya se sabe para quién es — se salta el
  // combobox por completo y no se puede cambiar de conductor desde acá.
  lockedConductor = null,
}) {
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [conductorId, setConductorId] = useState(lockedConductor?.id ?? "");
  const [tipoItem, setTipoItem] = useState(TIPO_ITEM_MEMBRESIA);
  const [paqueteId, setPaqueteId] = useState("");
  const [metodoPago, setMetodoPago] = useState("");
  const [comprobante, setComprobante] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [montoRecibido, setMontoRecibido] = useState("");
  const [registroOpen, setRegistroOpen] = useState(false);
  const [localError, setLocalError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const conductor = lockedConductor || conductores.find((c) => c.id === conductorId) || null;

  const resultados = search.trim()
    ? conductores
        .filter((c) => `${c.nombre} ${c.placa}`.toLowerCase().includes(search.trim().toLowerCase()))
        .slice(0, 8)
    : [];
  const sinResultados = search.trim().length > 0 && resultados.length === 0;

  // Paquetes reales del tipo elegido; si no hay ninguno configurado
  // todavía, cae a la lista demo (marcada "(demo)") SOLO para poder
  // probar el flujo — nunca se guarda en la base por sí sola, solo si
  // el usuario de verdad aprieta "Registrar Recarga" con una elegida.
  const paquetesReales = paquetes.filter((p) => p.tipo_item === tipoItem && p.activo !== false);
  const paquetesDelTipo = paquetesReales.length > 0 ? paquetesReales : PAQUETES_DEMO[tipoItem];
  const usandoDemo = paquetesReales.length === 0;
  const paquete = paquetesDelTipo.find((p) => String(p.id) === String(paqueteId)) || null;

  // Al cambiar el tipo de venta, la lista de paquetes cambia entera —
  // la selección anterior ya no tiene sentido.
  useEffect(() => {
    setPaqueteId("");
  }, [tipoItem]);

  const requiereComprobante = METODOS_CON_COMPROBANTE.includes(metodoPago);
  const montoNum = Number(paquete?.precio) || 0;
  const vuelto =
    metodoPago === METODO_PAGO_EFECTIVO && montoRecibido !== "" ? Number(montoRecibido) - montoNum : null;

  const elegirMetodo = (key) => {
    setMetodoPago(key);
    setComprobante(null);
    setMontoRecibido("");
    if (METODOS_CON_COMPROBANTE.includes(key)) setScannerOpen(true);
  };

  const resetForm = () => {
    setSearch("");
    setConductorId(lockedConductor?.id ?? "");
    setTipoItem(TIPO_ITEM_MEMBRESIA);
    setPaqueteId("");
    setMetodoPago("");
    setComprobante(null);
    setMontoRecibido("");
    setLocalError("");
  };

  // Un conductor con `aprobado: false` puede seguir apareciendo en el
  // buscador (a propósito — el recolector necesita encontrarlo para
  // saber que ya está cargado en el sistema) pero no puede cobrar nada
  // todavía: recién es "real" para la plata cuando el Admin lo aprueba
  // desde el Centro de Peticiones.
  const conductorNoAprobado = !!conductor && conductor.aprobado === false;

  const puedeEnviar =
    !!conductor &&
    !conductorNoAprobado &&
    !!paquete &&
    !!metodoPago &&
    (!requiereComprobante || !!comprobante);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError("");
    setSuccessMsg("");

    if (!conductor) {
      setLocalError("Busca y selecciona un conductor.");
      return;
    }
    if (conductorNoAprobado) {
      setLocalError(
        "Este conductor está pendiente de aprobación en el Centro de Peticiones. No se pueden procesar pagos aún."
      );
      return;
    }
    if (!paquete) {
      setLocalError("Elige un paquete.");
      return;
    }
    if (!metodoPago) {
      setLocalError("Elige un método de pago.");
      return;
    }
    if (requiereComprobante && !comprobante) {
      setLocalError("Escanea el comprobante antes de registrar.");
      return;
    }

    const { error: submitError } = await registrarRecarga({
      conductor,
      recolectorId,
      tipoItem,
      monto: montoNum,
      cantidadCreditos: Number(paquete.creditos) || 0,
      diasMembresia: Number(paquete.dias_membresia) || undefined,
      metodoPago,
      comprobante,
    });

    if (!submitError) {
      setSuccessMsg(`Recarga registrada para ${conductor.nombre}.`);
      resetForm();
    }
  };

  return (
    <>
      <form className="tz-payment-modal" onSubmit={handleSubmit} style={{ maxWidth: 480, margin: "0 auto" }}>
        <h2>
          <Zap size={17} /> Recarga Rápida
        </h2>

        <label className="tz-field-label">Conductor</label>
        {conductor && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid var(--border-soft)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <span>
              <strong style={{ color: "var(--text)" }}>{conductor.nombre}</strong>
              <span style={{ color: "var(--text-dim)", marginLeft: 6 }}>{conductor.placa}</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  marginLeft: 8,
                  color: NIVEL_COLOR[conductor.nivel_servicio || NIVEL_SERVICIO_ECONOMICO] ?? "var(--text-dim)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: NIVEL_COLOR[conductor.nivel_servicio || NIVEL_SERVICIO_ECONOMICO] ?? "var(--text-dim)",
                  }}
                />
                {nivelLabel(conductor.nivel_servicio)}
              </span>
            </span>
            {!lockedConductor && (
              <button type="button" className="tz-metodo-pago-change" onClick={() => setConductorId("")}>
                Cambiar
              </button>
            )}
          </div>
        )}
        {conductor && conductorNoAprobado && (
          <p className="tz-error" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={14} />
            Este conductor está pendiente de aprobación en el Centro de Peticiones. No se pueden procesar
            pagos aún.
          </p>
        )}
        {!conductor && (
          <div className="tz-global-search-wrap">
            <input
              type="text"
              className="tz-text-input"
              placeholder="Buscar por nombre o placa…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              role="combobox"
              aria-expanded={searchOpen}
              aria-autocomplete="list"
            />
            {searchOpen && resultados.length > 0 && (
              <div className="tz-global-search-dropdown">
                {resultados.map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    className="tz-global-search-item"
                    onClick={() => {
                      setConductorId(c.id);
                      setSearch("");
                      setSearchOpen(false);
                    }}
                  >
                    <span className="tz-global-search-item-name">{c.nombre}</span>
                    <span className="tz-global-search-item-meta">
                      {c.placa} · {c.estado ?? "pendiente"} ·{" "}
                      <span style={{ color: NIVEL_COLOR[c.nivel_servicio || NIVEL_SERVICIO_ECONOMICO] ?? "inherit" }}>
                        {nivelLabel(c.nivel_servicio)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {searchOpen && sinResultados && (
              <div className="tz-global-search-dropdown">
                <button
                  type="button"
                  className="tz-global-search-item"
                  style={{ color: "var(--cyan)", fontWeight: 700 }}
                  onClick={() => setRegistroOpen(true)}
                >
                  <UserPlus size={14} style={{ marginRight: 6, verticalAlign: "-2px" }} />
                  Crear nuevo conductor "{search.trim()}"
                </button>
              </div>
            )}
          </div>
        )}

        <label className="tz-field-label" style={{ marginTop: 12 }}>
          Tipo de venta
        </label>
        <div className="tz-gasto-tipo-buttons">
          <button
            type="button"
            className={`tz-gasto-tipo-btn ${tipoItem === TIPO_ITEM_MEMBRESIA ? "tz-gasto-tipo-active" : ""}`}
            onClick={() => setTipoItem(TIPO_ITEM_MEMBRESIA)}
          >
            Membresía
          </button>
          <button
            type="button"
            className={`tz-gasto-tipo-btn ${tipoItem === TIPO_ITEM_CREDITOS ? "tz-gasto-tipo-active" : ""}`}
            onClick={() => setTipoItem(TIPO_ITEM_CREDITOS)}
          >
            Paquete de Créditos
          </button>
        </div>

        <label className="tz-field-label" style={{ marginTop: 12 }}>
          {tipoItem === TIPO_ITEM_MEMBRESIA ? "Membresía" : "Paquete de créditos"}
        </label>
        <select className="tz-text-input" value={paqueteId} onChange={(e) => setPaqueteId(e.target.value)}>
          <option value="">
            {paquetesDelTipo.length === 0 ? "Ninguna por ahora" : "Elige una opción…"}
          </option>
          {paquetesDelTipo.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre} — {formatSoles(p.precio)}
              {p.tipo_item === TIPO_ITEM_CREDITOS ? ` (${p.creditos} créditos)` : ` (${p.dias_membresia} días)`}
            </option>
          ))}
        </select>
        {usandoDemo && (
          <p className="tz-camera-note" style={{ margin: "4px 0 0" }}>
            Sin paquetes configurados todavía — mostrando opciones de prueba. Configúralos en "Configurar
            Membresías" (Admin).
          </p>
        )}

        {/* ---- Panel de resumen: aparece apenas hay un paquete elegido ---- */}
        {paquete && (
          <div className="tz-scan-result" style={{ marginTop: 10 }}>
            <p className="tz-scan-result-title">Resumen</p>
            <div className="tz-scan-result-row">
              <span>Paquete:</span>
              <strong>{paquete.nombre}</strong>
            </div>
            <div className="tz-scan-result-row">
              <span>Precio:</span>
              <strong>{formatSoles(paquete.precio)}</strong>
            </div>
            <div className="tz-scan-result-row">
              <span>Otorga:</span>
              <strong>
                {tipoItem === TIPO_ITEM_CREDITOS ? `${paquete.creditos} créditos` : `${paquete.dias_membresia} días`}
              </strong>
            </div>
          </div>
        )}

        <div className="tz-metodo-pago">
          <div className="tz-metodo-pago-head">
            <label className="tz-field-label">Método de pago</label>
          </div>
          <div className="tz-gasto-tipo-buttons">
            {METODOS_PAGO.map((m) => (
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
        </div>

        {/* ---- Efectivo: Calculadora de Vuelto ---- */}
        {metodoPago === METODO_PAGO_EFECTIVO && (
          <div className="tz-add-entry" style={{ marginTop: 4 }}>
            <label className="tz-field-label">Monto recibido (S/)</label>
            <input
              type="number"
              inputMode="decimal"
              className="tz-amount-input"
              placeholder="0.00"
              value={montoRecibido}
              onChange={(e) => setMontoRecibido(e.target.value)}
            />
            <div className="tz-vuelto-quick-buttons">
              {MONTOS_RAPIDOS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className="tz-vuelto-quick-btn"
                  onClick={() => setMontoRecibido(String(m))}
                >
                  S/ {m}
                </button>
              ))}
            </div>
            {vuelto != null &&
              (vuelto < 0 ? (
                <p className="tz-error">Falta {formatSoles(Math.abs(vuelto))}.</p>
              ) : (
                <p className="tz-vuelto-display">
                  VUELTO: <strong>{formatSoles(vuelto)}</strong>
                </p>
              ))}
          </div>
        )}

        {/* ---- Yape/Plin/Otros: comprobante escaneado obligatorio ---- */}
        {requiereComprobante && (
          <div className="tz-add-entry" style={{ marginTop: 4 }}>
            {comprobante ? (
              <div className="tz-scan-result">
                <p className="tz-scan-result-title">Comprobante listo</p>
                <div className="tz-scan-result-row">
                  <span>ID operación:</span>
                  <strong>{comprobante.opId || "s/d"}</strong>
                </div>
                <div className="tz-scan-result-row">
                  <span>Fecha / Hora:</span>
                  <strong>
                    {comprobante.fecha} {comprobante.hora}
                  </strong>
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
              <button type="button" className="tz-scan-btn" onClick={() => setScannerOpen(true)}>
                <Camera size={16} /> Escanear comprobante
              </button>
            )}
          </div>
        )}

        {(localError || error) && <p className="tz-error">{localError || error}</p>}
        {successMsg && <p className="tz-success">{successMsg}</p>}

        <button
          type="submit"
          className="tz-scan-btn tz-payment-save"
          disabled={saving || !puedeEnviar}
          style={{ marginTop: 14 }}
        >
          {saving ? <Loader2 size={16} className="tz-spin" /> : <Zap size={16} />}
          {saving ? "Registrando…" : "Registrar Recarga"}
        </button>

        {/* ---- Fiado: atajo visible para dar de alta un conductor nuevo ---- */}
        {metodoPago === METODO_PAGO_FIADO && !conductor && (
          <button
            type="button"
            className="tz-camera-cancel"
            style={{ marginTop: 10 }}
            onClick={() => setRegistroOpen(true)}
          >
            <UserPlus size={15} style={{ marginRight: 6, verticalAlign: "-2px" }} />
            + Nuevo Conductor
          </button>
        )}
      </form>

      {registroOpen && (
        <RegistroConductorModal
          categorias={categorias}
          subgrupos={subgrupos}
          crearConductor={crearConductor}
          initialNombre={search.trim()}
          onClose={() => setRegistroOpen(false)}
          onCreated={(nombre, nuevoConductor) => {
            if (nuevoConductor?.id) setConductorId(nuevoConductor.id);
            setSearch("");
            setSearchOpen(false);
            setSuccessMsg(`${nombre} fue registrado y ya está seleccionado.`);
          }}
        />
      )}

      {scannerOpen && (
        <ComprobanteScannerModal
          precioEsperado={paquete?.precio}
          onConfirm={(data) => {
            setComprobante(data);
            setScannerOpen(false);
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </>
  );
}
