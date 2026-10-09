import { formatSoles, formatDate } from "../utils/format";
import { METODOS_PAGO, TIPO_ITEM_MEMBRESIA } from "./taxiEnums";

// Arma los datos del desplegable de venta registrada (PanelVentaRegistrada)
// para una venta de `ventas`: mensaje, número de WhatsApp del
// destinatario (conductor o cliente), resumen en texto y la boleta.
//   venta: fila de `ventas` (codigo_venta, detalle, monto, metodo_pago…)
//   destinatario: conductor o cliente (nombre, telefono y, si ya se
//     actualizó, su vencimiento/créditos nuevos)
//   extra: { cajero, montoRecibido }
export function ventaParaPanel(venta, destinatario, { cajero = "Admin", montoRecibido = null } = {}) {
  const esCliente = !!venta.cliente_id;
  const nombre = destinatario?.nombre || (esCliente ? "Cliente" : "Conductor");
  const monto = Number(venta.monto) || 0;
  const metodo = METODOS_PAGO.find((m) => m.key === venta.metodo_pago)?.label ?? venta.metodo_pago ?? "-";
  // El detalle puede traer el número de operación del comprobante al
  // final ("… · Op: 123 · fecha hora"): en la boleta solo va el concepto.
  const concepto = String(venta.detalle || (venta.tipo_item === TIPO_ITEM_MEMBRESIA ? "Membresía" : "Créditos")).split(" · Op:")[0];
  const fecha = new Date(venta.created_at || Date.now());
  const vence = esCliente ? destinatario?.membresia_vencimiento : destinatario?.vencimiento_suscripcion;
  const creditos = esCliente ? destinatario?.creditos_disponibles : destinatario?.creditos;
  const recibido = montoRecibido != null && montoRecibido !== "" ? Number(montoRecibido) : null;

  const resumen = [
    `Hola ${nombre}, registramos tu recarga ${venta.codigo_venta || ""}`.trim() + ":",
    `• ${concepto}`,
    `• Total: ${formatSoles(monto)} (${metodo})`,
    venta.tipo_item === TIPO_ITEM_MEMBRESIA && vence ? `• Membresía activa hasta el ${formatDate(vence)}.` : "",
    venta.tipo_item !== TIPO_ITEM_MEMBRESIA && creditos != null ? `• Saldo de créditos: ${creditos}.` : "",
    "¡Gracias por usar Taxi-PE!",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    mensaje: `${venta.codigo_venta ? `Venta ${venta.codigo_venta}` : "Venta"} registrada: ${formatSoles(monto)}`,
    whatsapp: destinatario?.telefono,
    resumen,
    boleta: {
      orden: {
        id: venta.codigo_venta || "-",
        fecha: fecha.toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" }),
        hora: fecha.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" }),
        cajero,
        subtitulo: "Taxi-PE · Recargas",
      },
      cliente: { nombre },
      productos: [{ cantidad: "1", nombre: concepto, precioUnitario: monto, subtotal: monto }],
      totales: {
        totalPagar: monto,
        metodoPago: metodo,
        efectivoRecibido: recibido != null && Number.isFinite(recibido) ? recibido : null,
        vuelto: recibido != null && Number.isFinite(recibido) ? recibido - monto : null,
      },
    },
  };
}
