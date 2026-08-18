import { formatSoles } from "../utils/format";
import logo from "../assets/logo.png";

/* Plantilla visual de boleta/ticket para enviar por WhatsApp. Su único
   trabajo es existir en el DOM con un tamaño y estilos fijos para que
   html2canvas la capture como imagen. Por eso todo acá va con estilos
   INLINE en vez de las clases 'tz-' del tema oscuro de Styles.jsx:
   este ticket necesita verse como papel térmico (claro, monoespaciado)
   sin importar qué tema tenga el resto de la app ni depender de que
   una hoja de estilos externa haya cargado a tiempo antes de la
   captura.

   OJO: este componente NO se posiciona a sí mismo fuera de pantalla
   (no lleva position:absolute/left negativo). Esa responsabilidad es
   de quien lo monta (ej. el wrapper con 'ticketRef' en App.jsx) — si
   ambos lo hicieran, el wrapper exterior (position:absolute, sin
   ancho propio) colapsaría a tamaño 0x0 porque su único hijo también
   quedaría fuera del flujo normal, y html2canvas capturaría un
   canvas vacío (esto pasó de verdad: 'html2canvas' fallaba con "No se
   pudo generar la boleta" hasta que se sacó la posición absoluta de
   acá). Este div sigue en flujo normal — un ancho fijo (350) alcanza
   para que cualquier contenedor que lo oculte se dimensione bien
   alrededor suyo. */

const COLORS = {
  bg: "#f8fafc", // slate-50
  text: "#0f172a", // slate-900
  dim: "#475569", // slate-600, para subtítulos/etiquetas
  divider: "#9ca3af", // gray-400
};

const FONT_MONO = "'Courier New', Courier, monospace";

const dividerStyle = {
  borderBottom: `1px dashed ${COLORS.divider}`,
  margin: "10px 0",
};

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  fontSize: 12,
  lineHeight: 1.5,
};

export default function TicketBoleta({ orden, cliente, productos, totales }) {
  const nombreCliente = cliente?.nombre?.trim() ? cliente.nombre.trim() : "Público General";
  const items = Array.isArray(productos) ? productos : [];

  return (
    <div
      style={{
        width: 350,
        boxSizing: "border-box",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: FONT_MONO,
        padding: "20px 16px",
      }}
    >
      {/* ---- Encabezado: mismo logo que el header principal ---- */}
      <div style={{ textAlign: "center" }}>
        <img src={logo} alt="TONAZO!" style={{ width: 110, height: "auto", margin: "0 auto" }} />
        <p style={{ margin: "6px 0 0", fontSize: 11, color: COLORS.dim, letterSpacing: 0.4 }}>
          Caja Registradora
        </p>
      </div>

      <div style={dividerStyle} />

      {/* ---- Datos de la orden ---- */}
      <div style={rowStyle}>
        <span>Orden</span>
        <span>#{orden?.id ?? "-"}</span>
      </div>
      <div style={rowStyle}>
        <span>Fecha</span>
        <span>{orden?.fecha ?? "-"}</span>
      </div>
      <div style={rowStyle}>
        <span>Hora</span>
        <span>{orden?.hora ?? "-"}</span>
      </div>
      <div style={rowStyle}>
        <span>Cajero</span>
        <span>{orden?.cajero ?? "-"}</span>
      </div>
      <div style={rowStyle}>
        <span>Cliente</span>
        <span>{nombreCliente}</span>
      </div>

      <div style={dividerStyle} />

      {/* ---- Tabla de productos ---- */}
      <div
        style={{
          display: "flex",
          fontSize: 11,
          fontWeight: 700,
          color: COLORS.dim,
          textTransform: "uppercase",
          letterSpacing: 0.3,
        }}
      >
        <span style={{ width: 28, flexShrink: 0 }}>Cant</span>
        <span style={{ flex: 1, minWidth: 0 }}>Descripción</span>
        <span style={{ width: 64, flexShrink: 0, textAlign: "right" }}>Precio</span>
      </div>

      <div style={{ marginTop: 6 }}>
        {items.map((p, i) => (
          <div key={i} style={{ display: "flex", fontSize: 12.5, padding: "4px 0" }}>
            <span style={{ width: 28, flexShrink: 0 }}>{p.cantidad}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              {p.nombre}
              <br />
              <span style={{ fontSize: 10.5, color: COLORS.dim }}>
                {formatSoles(p.precioUnitario)} c/u
              </span>
            </span>
            <span style={{ width: 64, flexShrink: 0, textAlign: "right", fontWeight: 700 }}>
              {formatSoles(p.subtotal)}
            </span>
          </div>
        ))}
      </div>

      <div style={dividerStyle} />

      {/* ---- Totales ---- */}
      <div style={{ ...rowStyle, fontSize: 12, color: COLORS.dim }}>
        <span>Método de pago</span>
        <span>{totales?.metodoPago ?? "-"}</span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 6,
          fontSize: 16,
          fontWeight: 700,
        }}
      >
        <span>TOTAL</span>
        <span>{formatSoles(totales?.totalPagar ?? 0)}</span>
      </div>

      <div style={dividerStyle} />

      <p style={{ textAlign: "center", fontSize: 11, color: COLORS.dim, margin: 0 }}>
        ¡Gracias por tu compra!
      </p>
    </div>
  );
}
