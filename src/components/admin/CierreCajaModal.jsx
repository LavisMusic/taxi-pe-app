import { useState } from "react";
import { X, Receipt, Download, MessageCircle, AlertTriangle, Loader2, Save, FileSpreadsheet, Clock } from "lucide-react";
import { formatSoles, formatDate, formatTime } from "../../utils/format";
import { METODOS_PAGO, METODO_PAGO_EFECTIVO, TIPO_ITEM_CREDITOS, TIPO_ITEM_MEMBRESIA } from "../../lib/taxiEnums";
import { downloadXLSX } from "../../lib/xlsxExport";
import { buildWhatsappLink } from "../../lib/whatsapp";

// Cierre de Caja del turno (Admin o recolector): lo recaudado en el
// turno (ventas vigentes, sin anuladas) contra sus gastos operativos —
// Balance Neto = una resta simple, con el desglose por tipo de venta y
// por método de pago. Para el recolector, los gastos son sus compras de
// créditos del turno; para el Admin, los gastos operativos.
//
// "Cerrar turno" lo hace la base (taxi_cerrar_caja, migración
// 20261012110000): pide el EFECTIVO CONTADO, guarda el cierre con su
// arqueo (contado vs. esperado = efectivo cobrado − gastos en efectivo) y
// arranca el turno siguiente. Si el turno ya venció (00:00, hora de Perú)
// el modal se abre solo y ofrece extenderlo 30 minutos.
//
// Excel del cierre (como las cajas de Caja Tonazo): hojas Resumen,
// Ventas (cada venta con su código TX-…, destinatario, detalle, método)
// y Gastos. Se descarga solo al cerrar el turno y también con el botón
// "Descargar Excel" en cualquier momento.
export default function CierreCajaModal({
  ventasHoy,
  gastosHoy,
  totalGastosHoy,
  cierres = [],
  crearCierre,
  esAdmin = false,
  cajeroNombre = "Admin",
  onClose,
  // Persistencia de Turno (RecolectorPage.jsx): opcional — Admin no lo
  // pasa, así que su flujo queda exactamente igual que antes ("no
  // reinicia ningún contador", ver comentario de arriba). El Recolector
  // sí lo pasa, para marcar el arranque de un turno nuevo apenas este
  // cierre se guardó de verdad.
  onCerrado,
  // Restricción de Recolector: RecolectorPage.jsx pasa el teléfono del
  // PROPIO recolector (leído de su perfil, `usuario.telefono`) — el
  // Admin no lo pasa, así que su botón sigue exactamente igual que
  // antes (wa.me sin número fijo, elige el contacto/grupo a mano).
  telefonoDestino,
  // Para poner el nombre del conductor/cliente en el Excel (opcional).
  conductores = [],
  usuarios = [],
  // Turno vencido (ver useTurnoCaja): muestra el aviso y el botón para
  // extenderlo 30 minutos.
  vencido = false,
  onExtender,
  // Extensiones usadas / permitidas en este turno; `obligatorio` (agotadas
  // y vencido): sin X ni "Extender", solo se puede cerrar el turno.
  extensiones = 0,
  maxExtensiones = 0,
  obligatorio = false,
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [extendiendo, setExtendiendo] = useState(false);
  const [cierreError, setCierreError] = useState("");
  const [efectivoContado, setEfectivoContado] = useState("");

  const recaudadoHoy = ventasHoy.reduce((sum, v) => sum + Number(v.monto || 0), 0);
  const balanceNeto = recaudadoHoy - totalGastosHoy;
  const ticketGeneral = ventasHoy.length > 0 ? recaudadoHoy / ventasHoy.length : 0;

  const totalPorTipo = (tipo) =>
    ventasHoy.filter((v) => v.tipo_item === tipo).reduce((sum, v) => sum + Number(v.monto || 0), 0);

  const totalPorMetodo = (metodo) =>
    ventasHoy.filter((v) => v.metodo_pago === metodo).reduce((sum, v) => sum + Number(v.monto || 0), 0);

  // Arqueo: lo que debería haber en efectivo = cobrado en efectivo −
  // gastos pagados en efectivo (los gastos sin método cuentan como
  // efectivo, igual que en la base).
  const gastosEfectivo = gastosHoy
    .filter((g) => !g.metodo_pago || g.metodo_pago === METODO_PAGO_EFECTIVO)
    .reduce((sum, g) => sum + Number(g.monto || 0), 0);
  const efectivoEsperado = totalPorMetodo(METODO_PAGO_EFECTIVO) - gastosEfectivo;
  const contadoNum = Number(String(efectivoContado).replace(",", "."));
  const contadoValido = efectivoContado !== "" && Number.isFinite(contadoNum) && contadoNum >= 0;
  const diferencia = contadoValido ? contadoNum - efectivoEsperado : null;

  const descargarExcelCierre = () => {
    const ahora = Date.now();
    const nombreDe = (v) =>
      v.cliente_id
        ? usuarios.find((u) => u.id === v.cliente_id)?.nombre || "Cliente"
        : conductores.find((c) => c.id === v.conductor_id)?.nombre || "Conductor";
    const recolectorDe = (v) => usuarios.find((u) => u.id === v.recolector_id)?.nombre || (v.recolector_id ? "" : "Admin");
    const labelMetodo = (key) => METODOS_PAGO.find((m) => m.key === key)?.label ?? key;
    const resumen = [
      ["Cierre de caja", `${formatDate(ahora)} ${formatTime(ahora)}`],
      ["Cajero", cajeroNombre],
      [],
      ["Recaudado (S/)", Number(recaudadoHoy.toFixed(2))],
      ["Gastos operativos (S/)", Number(Number(totalGastosHoy).toFixed(2))],
      ["Balance neto (S/)", Number(balanceNeto.toFixed(2))],
      ["Ventas registradas", ventasHoy.length],
      ["Ticket promedio (S/)", Number(ticketGeneral.toFixed(2))],
      [],
      ["Por tipo de venta", ""],
      ["Membresías (S/)", Number(totalPorTipo(TIPO_ITEM_MEMBRESIA).toFixed(2))],
      ["Créditos (S/)", Number(totalPorTipo(TIPO_ITEM_CREDITOS).toFixed(2))],
      [],
      ["Por método de pago", ""],
      ...METODOS_PAGO.map((m) => [`${m.label} (S/)`, Number(totalPorMetodo(m.key).toFixed(2))]),
    ];
    const ventas = [
      ["Código", "Fecha", "Hora", "Destinatario", "Tipo", "Detalle", "Método", "Monto (S/)", "Recolector"],
      ...[...ventasHoy]
        .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
        .map((v) => [
          v.codigo_venta || "",
          formatDate(v.created_at),
          formatTime(v.created_at),
          `${nombreDe(v)} (${v.cliente_id ? "cliente" : "conductor"})`,
          v.tipo_item === TIPO_ITEM_MEMBRESIA ? "Membresía" : "Créditos",
          v.detalle || "",
          labelMetodo(v.metodo_pago),
          Number(Number(v.monto || 0).toFixed(2)),
          recolectorDe(v),
        ]),
    ];
    const gastos = [
      ["Fecha", "Hora", "Concepto", "Monto (S/)"],
      ...gastosHoy.map((g) => [
        formatDate(g.fecha || g.created_at),
        formatTime(g.fecha || g.created_at),
        g.concepto,
        Number(Number(g.monto || 0).toFixed(2)),
      ]),
    ];
    const fecha = new Date(ahora).toISOString().slice(0, 10);
    downloadXLSX(`cierre-caja-${fecha}-${ahora}.xlsx`, [
      { nombre: "Resumen", filas: resumen },
      { nombre: "Ventas", filas: ventas },
      { nombre: "Gastos", filas: gastos },
    ]);
  };

  const ejecutarCierre = async () => {
    if (!contadoValido) {
      setCierreError("Ingresa el efectivo que tienes contado (0 si no tienes).");
      return;
    }
    setCerrando(true);
    setCierreError("");
    const { error } = await crearCierre({ efectivoReal: contadoNum });
    setCerrando(false);
    if (error) {
      setCierreError("No se pudo guardar el cierre.");
      return;
    }
    setConfirmando(false);
    setEfectivoContado("");
    descargarExcelCierre();
    onCerrado?.();
  };

  const extender = async () => {
    setExtendiendo(true);
    setCierreError("");
    const { error } = (await onExtender?.()) || {};
    setExtendiendo(false);
    if (error)
      setCierreError(
        error.message === "limite" ? "Ya usaste todas tus extensiones: cierra el turno." : "No se pudo extender el turno."
      );
    else onClose();
  };

  const exportarHistorialCierresXLSX = () => {
    const headers = [
      "Fecha",
      "Hora",
      "Cajero",
      "Recaudado (S/)",
      "Gastos (S/)",
      "Balance Neto (S/)",
      "Ventas Registradas",
      "Ticket General (S/)",
    ];
    const filas = [
      headers,
      ...cierres.map((c) => [
        formatDate(c.created_at),
        formatTime(c.created_at),
        c.cajero_nombre || "",
        Number(c.recaudado_total).toFixed(2),
        Number(c.total_gastos).toFixed(2),
        Number(c.balance_neto).toFixed(2),
        c.ventas_registradas,
        Number(c.ticket_general).toFixed(2),
      ]),
    ];
    downloadXLSX(`historial-cierres-${Date.now()}.xlsx`, [{ nombre: "Cierres", filas }]);
  };

  // Restricción de Recolector: si llega `telefonoDestino` (el propio
  // número del Recolector, ver arriba), el resumen va DIRECTO a su
  // WhatsApp — ya no depende de que elija bien el contacto a mano (el
  // riesgo real que describía el pedido: podía terminar mandándolo a
  // cualquier chat, incluido el del Admin, por error). Sin ese dato
  // (caso Admin), se mantiene el comportamiento de antes: wa.me sin
  // número fijo, elige el contacto/grupo destino a mano.
  const enviarResumenPorWhatsApp = () => {
    const lineas = [
      "RESUMEN DE CIERRE",
      `Fecha/Hora: ${formatDate(Date.now())} ${formatTime(Date.now())}`,
      `Cajero: ${cajeroNombre}`,
      `Recaudado: ${formatSoles(recaudadoHoy)}`,
      `Gastos: ${formatSoles(totalGastosHoy)}`,
      `Balance Neto: ${formatSoles(balanceNeto)}`,
      `Ventas registradas: ${ventasHoy.length}`,
    ];
    const mensaje = lineas.join("\n");
    const link = telefonoDestino ? buildWhatsappLink(telefonoDestino, mensaje) : null;
    window.open(link || `https://wa.me/?text=${encodeURIComponent(mensaje)}`, "_blank", "noopener");
  };

  return (
    <div className={`tz-modal-backdrop ${obligatorio ? "tz-cierre-obligatorio" : ""}`}>
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        {!obligatorio && (
          <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        )}
        <div className="tz-payment-modal">
          <h2>
            <Receipt size={17} /> Cierre de Caja
          </h2>

          {vencido && (
            <div className="tz-cierre-vencido">
              <p className="tz-cierre-warning" style={{ margin: 0 }}>
                <Clock size={14} />{" "}
                {obligatorio
                  ? "Tu turno terminó y ya usaste todas tus extensiones. Cuenta tu efectivo y cierra el turno para seguir."
                  : "Tu turno ya terminó. Cuenta tu efectivo y cierra la caja, o extiende el turno 30 minutos."}
              </p>
              {maxExtensiones > 0 && (
                <p className="tz-cierre-extensiones">
                  Extensiones usadas: {extensiones} de {maxExtensiones}
                </p>
              )}
              {onExtender && !obligatorio && (
                <button type="button" className="tz-camera-cancel" onClick={extender} disabled={extendiendo}>
                  {extendiendo ? <Loader2 size={15} className="tz-spin" /> : <Clock size={15} />} Extender 30 min
                </button>
              )}
            </div>
          )}

          {/* Recibo del turno actual — mismo diseño del cierre de las
             cajas de Caja Tonazo. */}
          <div className="tz-receipt">
            <div className="tz-receipt-header">
              <span className="tz-receipt-title">Turno actual</span>
              <span className="tz-receipt-date">
                {formatDate(Date.now())} · {formatTime(Date.now())}
              </span>
            </div>
            <div className="tz-receipt-row">
              <span>Cajero</span>
              <strong>{cajeroNombre}</strong>
            </div>
            <div className="tz-receipt-divider" />
            <div className="tz-receipt-row">
              <span>Membresías</span>
              <strong>{formatSoles(totalPorTipo(TIPO_ITEM_MEMBRESIA))}</strong>
            </div>
            <div className="tz-receipt-row">
              <span>Créditos</span>
              <strong>{formatSoles(totalPorTipo(TIPO_ITEM_CREDITOS))}</strong>
            </div>
            <div className="tz-receipt-divider" />
            {METODOS_PAGO.map((m) => (
              <div key={m.key} className="tz-receipt-row">
                <span>Ingresos ({m.label})</span>
                <strong>{formatSoles(totalPorMetodo(m.key))}</strong>
              </div>
            ))}
            <div className="tz-receipt-divider" />
            <div className="tz-receipt-row">
              <span>Recaudado</span>
              <strong>{formatSoles(recaudadoHoy)}</strong>
            </div>
            <div className="tz-receipt-row">
              <span>Ventas registradas</span>
              <strong>{ventasHoy.length}</strong>
            </div>
            <div className="tz-receipt-row">
              <span>Gastos operativos</span>
              <strong>{formatSoles(totalGastosHoy)}</strong>
            </div>
            {gastosHoy.map((g) => (
              <div key={g.id} className="tz-receipt-row tz-plan-pagos-nota">
                <span>· {g.concepto}</span>
                <span>{formatSoles(g.monto)}</span>
              </div>
            ))}
            <div className="tz-receipt-row">
              <span>Ticket general</span>
              <strong>{formatSoles(ticketGeneral)}</strong>
            </div>
            <div className="tz-receipt-divider" />
            <div className="tz-receipt-row tz-receipt-total">
              <span>BALANCE NETO DEL TURNO</span>
              <strong>{formatSoles(balanceNeto)}</strong>
            </div>
          </div>

          <div className="tz-export-buttons">
            <button type="button" className="tz-csv-btn" onClick={enviarResumenPorWhatsApp}>
              <MessageCircle size={13} /> Enviar Resumen a WhatsApp
            </button>
            <button type="button" className="tz-csv-btn" onClick={descargarExcelCierre}>
              <FileSpreadsheet size={13} /> Descargar Excel del turno
            </button>
          </div>

          <div className="tz-add-entry" style={{ marginTop: 12 }}>
            <label className="tz-field-label" htmlFor="cierre-efectivo">
              Efectivo contado (S/)
            </label>
            <input
              id="cierre-efectivo"
              className="tz-amount-input"
              inputMode="decimal"
              placeholder="0.00"
              value={efectivoContado}
              onChange={(e) => {
                setEfectivoContado(e.target.value);
                setCierreError("");
              }}
            />
            <div className="tz-receipt-row">
              <span>Efectivo esperado</span>
              <strong>{formatSoles(efectivoEsperado)}</strong>
            </div>
            {diferencia != null && (
              <div className="tz-receipt-row">
                <span>{diferencia < 0 ? "Faltante" : diferencia > 0 ? "Sobrante" : "Cuadra"}</span>
                <strong style={{ color: diferencia < 0 ? "var(--danger)" : diferencia > 0 ? "var(--yellow)" : "var(--green)" }}>
                  {formatSoles(Math.abs(diferencia))}
                </strong>
              </div>
            )}
          </div>

          {!confirmando ? (
            <button
              className="tz-scan-btn tz-add-entry-toggle"
              onClick={() => (contadoValido ? setConfirmando(true) : setCierreError("Ingresa el efectivo que tienes contado (0 si no tienes)."))}
            >
              <Receipt size={16} /> Cerrar turno
            </button>
          ) : (
            <div className="tz-add-entry">
              <p className="tz-cierre-warning">
                <AlertTriangle size={14} /> Esto guarda el cierre con tu efectivo contado, descarga su Excel y
                arranca un turno nuevo. No se puede deshacer.
              </p>
              {cierreError && <p className="tz-error">{cierreError}</p>}
              <div className="tz-add-entry-actions">
                <button className="tz-camera-cancel" onClick={() => setConfirmando(false)} disabled={cerrando}>
                  Cancelar
                </button>
                <button className="tz-pw-submit tz-payment-save" onClick={ejecutarCierre} disabled={cerrando}>
                  {cerrando ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
                  Sí, cerrar turno
                </button>
              </div>
            </div>
          )}
          {!confirmando && cierreError && <p className="tz-error">{cierreError}</p>}

          <div className="tz-method-history" style={{ marginTop: 14 }}>
            <span className="tz-method-history-label">Historial de cierres</span>
            <div className="tz-export-buttons">
              {esAdmin && (
                <button type="button" className="tz-csv-btn" onClick={exportarHistorialCierresXLSX}>
                  <Download size={13} /> Exportar Historial de Cierres
                </button>
              )}
            </div>

            {cierres.length === 0 ? (
              <p className="tz-method-history-empty">Todavía no hay cierres guardados.</p>
            ) : (
              <div className="tz-cierre-list">
                {cierres.map((c) => (
                  <div key={c.id} className="tz-receipt tz-receipt-compact">
                    <div className="tz-receipt-header">
                      <span className="tz-receipt-title">Cierre · {c.cajero_nombre}</span>
                      <span className="tz-receipt-date">
                        {formatDate(c.hasta || c.created_at)} · {formatTime(c.hasta || c.created_at)}
                      </span>
                    </div>
                    <div className="tz-receipt-divider" />
                    <div className="tz-receipt-row">
                      <span>Recaudado</span>
                      <strong>{formatSoles(c.recaudado_total)}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Gastos</span>
                      <strong>{formatSoles(c.total_gastos)}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Balance neto</span>
                      <strong>{formatSoles(c.balance_neto)}</strong>
                    </div>
                    {c.efectivo_real != null && (
                      <div className="tz-receipt-row tz-plan-pagos-nota">
                        <span>Efectivo contado / esperado</span>
                        <span>
                          {formatSoles(c.efectivo_real)} / {formatSoles(c.efectivo_esperado)}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
