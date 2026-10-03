import { useState } from "react";
import { X, Receipt, Download, MessageCircle, AlertTriangle, Loader2, Save, FileSpreadsheet } from "lucide-react";
import { formatSoles, formatDate, formatTime } from "../../utils/format";
import { METODOS_PAGO, TIPO_ITEM_CREDITOS, TIPO_ITEM_MEMBRESIA } from "../../lib/taxiEnums";
import { downloadXLSX } from "../../lib/xlsxExport";
import { buildWhatsappLink } from "../../lib/whatsapp";

// Cierre de Caja: cruza lo recaudado hoy (ventas vigentes, sin
// anuladas) contra los Gastos Operativos de hoy — Balance Neto = una
// resta simple, con el desglose por tipo de venta y por método de pago.
//
// "Cerrar turno" (nuevo) guarda una INSTANTÁNEA de estos totales en
// `cierres_caja` — a diferencia de la caja registradora vieja
// (App.jsx: tabla `estado_caja` con apertura/fondo inicial/efectivo
// real/arqueo), acá no hay un ciclo de apertura/cierre de verdad:
// `ventas`/`gastos_operativos` siguen siendo globales, "Hoy" sigue
// calculándose igual después de cerrar. Es solo un registro para
// exportar/compartir, no reinicia ningún contador.
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
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [cierreError, setCierreError] = useState("");

  const recaudadoHoy = ventasHoy.reduce((sum, v) => sum + Number(v.monto || 0), 0);
  const balanceNeto = recaudadoHoy - totalGastosHoy;
  const ticketGeneral = ventasHoy.length > 0 ? recaudadoHoy / ventasHoy.length : 0;

  const totalPorTipo = (tipo) =>
    ventasHoy.filter((v) => v.tipo_item === tipo).reduce((sum, v) => sum + Number(v.monto || 0), 0);

  const totalPorMetodo = (metodo) =>
    ventasHoy.filter((v) => v.metodo_pago === metodo).reduce((sum, v) => sum + Number(v.monto || 0), 0);

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
    setCerrando(true);
    setCierreError("");
    const { error } = await crearCierre({
      cajeroNombre,
      recaudadoTotal: recaudadoHoy,
      totalGastos: totalGastosHoy,
      balanceNeto,
      ventasRegistradas: ventasHoy.length,
      ticketGeneral,
    });
    setCerrando(false);
    if (error) {
      setCierreError("No se pudo guardar el cierre.");
      return;
    }
    setConfirmando(false);
    descargarExcelCierre();
    onCerrado?.();
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
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Receipt size={17} /> Cierre de Caja
          </h2>

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
              <FileSpreadsheet size={13} /> Descargar Excel de hoy
            </button>
          </div>

          {!confirmando ? (
            <button className="tz-scan-btn tz-add-entry-toggle" onClick={() => setConfirmando(true)}>
              <Receipt size={16} /> Cerrar turno
            </button>
          ) : (
            <div className="tz-add-entry">
              <p className="tz-cierre-warning">
                <AlertTriangle size={14} /> Esto guarda una instantánea de estos totales en el historial de
                cierres y descarga su Excel. No reinicia "Hoy" ni se puede deshacer.
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
                        {formatDate(c.created_at)} · {formatTime(c.created_at)}
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
