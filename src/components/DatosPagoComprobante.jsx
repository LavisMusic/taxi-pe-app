import { useState } from "react";
import { Camera, Copy, Check } from "lucide-react";
import BotonPegarComprobante from "./BotonPegarComprobante";

/* Datos de pago + comprobante, el mismo bloque en todos los modales de pago
   (checkout del cliente, fiado, renovación del plan).

   Apenas se elige el método, se despliega:
     · Yape / Plin → el número y el titular (con botón de copiar),
     · Otros / transferencia → la cuenta y el titular,
   y debajo, una sobre otra, las dos formas de adjuntar el comprobante:
     · "Ya pagué, adjuntar comprobante" (el celular ofrece cámara o
       galería: sin `capture`, que obligaba a usar la cámara),
     · "Pegar comprobante".
   El botón de enviar lo pone cada modal (aparece cuando ya hay archivo).

   `datos`: { yape_plin, titular, cuenta } — de la plataforma
   (plataforma_contacto) o del negocio (negocios.pago_*). */

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Fallback (HTTP sin contexto seguro, navegadores viejos).
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function BotonCopiar({ etiqueta, valor }) {
  const [copiado, setCopiado] = useState(false);
  if (!valor) return null;
  return (
    <button
      type="button"
      className={`tz-renovar-copiar ${copiado ? "tz-renovar-copiar-ok" : ""}`}
      onClick={async () => {
        if (await copiarTexto(valor)) {
          setCopiado(true);
          setTimeout(() => setCopiado(false), 1800);
        }
      }}
    >
      <span className="tz-renovar-copiar-etiqueta">{etiqueta}</span>
      <span className="tz-renovar-copiar-valor">{valor}</span>
      <span className="tz-renovar-copiar-accion">
        {copiado ? <Check size={14} /> : <Copy size={14} />} {copiado ? "¡Copiado!" : "Copiar"}
      </span>
    </button>
  );
}

// Qué datos mostrar según el método elegido (cada modal nombra sus
// métodos a su manera: "YAPE", "Yape", "Transferencia", "OTROS"...).
export function tipoDePago(metodo) {
  const m = String(metodo || "").toLowerCase();
  if (m === "yape") return "yape";
  if (m === "plin") return "plin";
  if (m === "otros" || m === "transferencia") return "cuenta";
  return null;
}

export default function DatosPagoComprobante({
  metodo,
  datos,
  archivo,
  preview,
  onArchivo,
  pedirComprobante = true,
  sinDatosTexto = "Todavía no hay datos de pago configurados.",
}) {
  const tipo = tipoDePago(metodo);
  if (!tipo) return null;

  const valor = tipo === "cuenta" ? datos?.cuenta : datos?.yape_plin;
  const etiqueta = tipo === "cuenta" ? "Transfiere a" : tipo === "plin" ? "Plinea a" : "Yapea a";

  const elegir = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) onArchivo(f);
  };

  return (
    // key = método: al cambiarlo, el bloque vuelve a desplegarse.
    <div className="tz-pagoc" key={tipo}>
      {valor ? (
        <div className="tz-pagoc-datos">
          <BotonCopiar etiqueta={etiqueta} valor={valor} />
          {datos?.titular && <p className="tz-pagoc-titular">Titular: {datos.titular}</p>}
        </div>
      ) : (
        <p className="tz-stock-editor-sub tz-pagoc-sin-datos">{sinDatosTexto}</p>
      )}

      {pedirComprobante && (
        <div className="tz-pagoc-comprobante">
          <label className="tz-scan-btn tz-pagoc-adjuntar">
            <Camera size={16} /> {archivo ? "Cambiar comprobante" : "Ya pagué, adjuntar comprobante"}
            <input type="file" accept="image/*" hidden onChange={elegir} />
          </label>
          <BotonPegarComprobante onArchivo={onArchivo} />
          {preview && <img src={preview} alt="Comprobante" className="tz-pagoc-preview" />}
        </div>
      )}
    </div>
  );
}
