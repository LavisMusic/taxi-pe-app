import { formatSoles, formatDate } from "../utils/format";

// Bloque de solo-lectura con el detalle de fiado de un cliente:
// productos adeudados (itemizado, desde fiado_items) + cobros ya
// registrados (movimientos_fiado). Reutilizado por la Libreta del
// admin (App.jsx, que además agrega botones de acción alrededor) y por
// la vista propia del cliente (ClienteFiadoView, sin botones de acción).
export default function FiadoDetalle({ info }) {
  const itemsPendientes = info.items.filter((fi) => fi.saldoRestante > 0.009);

  return (
    <>
      <span className="tz-product-history-label">Productos adeudados</span>
      {itemsPendientes.length === 0 ? (
        <p className="tz-method-history-empty">Sin productos pendientes de cobro.</p>
      ) : (
        <ul className="tz-mov-list">
          {itemsPendientes.map((fi) => (
            <li key={fi.id} className="tz-mov-row tz-mov-deuda">
              <span className="tz-mov-row-desc">
                {fi.productoNombre}
                {fi.detalle ? ` · ${fi.detalle}` : ""} × {fi.cantidad}
                <span className="tz-mov-row-date">
                  {formatDate(fi.timestamp)}
                  {fi.saldoRestante < fi.monto - 0.009
                    ? ` · abonado ${formatSoles(fi.monto - fi.saldoRestante)}`
                    : ""}
                </span>
              </span>
              <strong>{formatSoles(fi.saldoRestante)}</strong>
            </li>
          ))}
        </ul>
      )}

      {info.pagos.length > 0 && (
        <>
          <span className="tz-product-history-label">Cobros registrados</span>
          <ul className="tz-mov-list">
            {info.pagos.map((m) => (
              <li
                key={m.id}
                className={`tz-mov-row ${m.rechazado ? "tz-mov-rechazado" : "tz-mov-pago"}`}
              >
                <span className="tz-mov-row-desc">
                  {m.descripcion || "Pago"}
                  {m.rechazado ? " (comprobante rechazado)" : ""}
                  <span className="tz-mov-row-date">
                    {formatDate(m.timestamp)}
                    {m.fotoUrl ? " · con comprobante" : ""}
                  </span>
                </span>
                <strong className={m.rechazado ? "tz-mov-rechazado-monto" : undefined}>
                  {formatSoles(m.monto)}
                </strong>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
