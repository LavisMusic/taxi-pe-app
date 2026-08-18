import { useState } from "react";
import { Calculator, X, Receipt, Download, MessageCircle, AlertTriangle, Loader2, Save } from "lucide-react";
import { formatSoles, formatDate, formatTime } from "../../utils/format";
import { METODOS_PAGO, TIPO_ITEM_CREDITOS, TIPO_ITEM_MEMBRESIA } from "../../lib/taxiEnums";
import { downloadXLSX } from "../../lib/xlsxExport";

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
export default function CierreCajaModal({
  ventasHoy,
  gastosHoy,
  totalGastosHoy,
  cierres = [],
  crearCierre,
  esAdmin = false,
  cajeroNombre = "Admin",
  onClose,
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

  // wa.me SIN número fijo — deja elegir el contacto/grupo destino desde
  // el propio WhatsApp de quien cierra, en vez de forzar un número
  // preconfigurado a mano en el código.
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
    window.open(`https://wa.me/?text=${encodeURIComponent(lineas.join("\n"))}`, "_blank", "noopener");
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Calculator size={17} /> Cierre de Caja (Hoy)
          </h2>

          <div className="tz-method-totals">
            <div className="tz-method-total">
              <span>Recaudado</span>
              <strong className="tz-cyan">{formatSoles(recaudadoHoy)}</strong>
            </div>
            <div className="tz-method-total">
              <span>Gastos operativos</span>
              <strong className="tz-pink">− {formatSoles(totalGastosHoy)}</strong>
            </div>
            <div className="tz-method-total">
              <span>Balance neto</span>
              <strong className={balanceNeto >= 0 ? "tz-green" : undefined} style={balanceNeto < 0 ? { color: "var(--danger)" } : undefined}>
                {formatSoles(balanceNeto)}
              </strong>
            </div>
          </div>

          <div className="tz-method-history">
            <span className="tz-method-history-label">Por tipo de venta</span>
            <ul className="tz-mov-list">
              <li className="tz-mov-row tz-mov-pago">
                <span className="tz-mov-row-desc">Membresías</span>
                <strong>{formatSoles(totalPorTipo(TIPO_ITEM_MEMBRESIA))}</strong>
              </li>
              <li className="tz-mov-row tz-mov-pago">
                <span className="tz-mov-row-desc">Créditos</span>
                <strong>{formatSoles(totalPorTipo(TIPO_ITEM_CREDITOS))}</strong>
              </li>
            </ul>
          </div>

          <div className="tz-method-history">
            <span className="tz-method-history-label">Por método de pago</span>
            <ul className="tz-mov-list">
              {METODOS_PAGO.map((m) => (
                <li key={m.key} className="tz-mov-row tz-mov-pago">
                  <span className="tz-mov-row-desc">{m.label}</span>
                  <strong>{formatSoles(totalPorMetodo(m.key))}</strong>
                </li>
              ))}
            </ul>
          </div>

          {gastosHoy.length > 0 && (
            <div className="tz-method-history">
              <span className="tz-method-history-label">Gastos de hoy</span>
              <ul className="tz-mov-list">
                {gastosHoy.map((g) => (
                  <li key={g.id} className="tz-mov-row tz-mov-deuda">
                    <span className="tz-mov-row-desc">{g.concepto}</span>
                    <strong>{formatSoles(g.monto)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!confirmando ? (
            <button className="tz-scan-btn tz-add-entry-toggle" onClick={() => setConfirmando(true)} style={{ marginTop: 14 }}>
              <Receipt size={16} /> Cerrar turno
            </button>
          ) : (
            <div className="tz-add-entry" style={{ marginTop: 14 }}>
              <p className="tz-cierre-warning">
                <AlertTriangle size={14} /> Esto guarda una instantánea de estos totales en el historial de
                cierres. No reinicia "Hoy" ni se puede deshacer.
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

          <div className="tz-method-history">
            <span className="tz-method-history-label">Historial de cierres</span>
            <div className="tz-export-buttons">
              {esAdmin && (
                <button type="button" className="tz-csv-btn" onClick={exportarHistorialCierresXLSX}>
                  <Download size={13} /> Exportar Historial de Cierres
                </button>
              )}
              <button type="button" className="tz-csv-btn" onClick={enviarResumenPorWhatsApp}>
                <MessageCircle size={13} /> Enviar Resumen a WhatsApp
              </button>
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
