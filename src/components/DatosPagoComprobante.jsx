import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Copy, Check } from "lucide-react";
import BotonPegarComprobante from "./BotonPegarComprobante";

/* Datos de pago + comprobante, el mismo bloque en todos los modales de pago
   (checkout del cliente, fiado, renovación del plan).

   Apenas se elige el método, se despliega:
     · Yape / Plin → el número y el titular (con botón de copiar),
     · Otros / transferencia → la cuenta y el titular,
   y debajo, una sobre otra y del mismo tamaño, las dos formas de adjuntar
   el comprobante:
     · "Adjuntar comprobante" (el celular ofrece cámara o galería: sin
       `capture`, que obligaba a usar la cámara),
     · "Pegar comprobante".
   Los dos aparecen recién después de copiar el número o la cuenta, tras
   8 segundos (el tiempo de ir a pagar) que se ven como una línea de carga
   en el borde inferior del modal. Sin datos para copiar, aparecen de una.
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

export function BotonCopiar({ etiqueta, valor, onCopiado = null }) {
  const [copiado, setCopiado] = useState(false);
  if (!valor) return null;
  return (
    <button
      type="button"
      className={`tz-renovar-copiar ${copiado ? "tz-renovar-copiar-ok" : ""}`}
      onClick={async () => {
        // La espera del comprobante arranca al tocar "Copiar", aunque el
        // navegador no deje copiar (si no, el cliente quedaba sin botones).
        onCopiado?.();
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

const ESPERA_MS = 8000;

// Línea de carga pegada al borde inferior del modal (fixed, medida sobre
// el modal: el modal hace scroll y una línea "absolute" se iría con él).
function LineaEspera({ ancla }) {
  const [caja, setCaja] = useState(null);
  useEffect(() => {
    const modal = ancla?.closest(".tz-modal");
    if (!modal) return undefined;
    const medir = () => {
      const r = modal.getBoundingClientRect();
      const radio = parseFloat(getComputedStyle(modal).borderBottomLeftRadius) || 0;
      setCaja({ left: r.left + radio, width: Math.max(0, r.width - radio * 2), top: r.bottom - 3 });
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [ancla]);
  if (!caja) return null;
  return createPortal(
    <span className="tz-pagoc-espera" style={{ left: caja.left, width: caja.width, top: caja.top }} aria-hidden="true">
      <span className="tz-pagoc-espera-fill" style={{ animationDuration: `${ESPERA_MS}ms` }} />
    </span>,
    document.body
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
  // Para el modal que pone su propio botón de comprobante (recolector):
  // avisa cuando ya se puede mostrar.
  onListoComprobante = null,
}) {
  const tipo = tipoDePago(metodo);
  const valor = tipo === "cuenta" ? datos?.cuenta : datos?.yape_plin;
  const raiz = useRef(null);
  // "copiar" → (copia) → "contando" 8 s → "listo": recién ahí los botones.
  const [espera, setEspera] = useState("copiar");
  useEffect(() => {
    setEspera(archivo || !valor ? "listo" : "copiar");
    // Al cambiar de método o de datos vuelve a empezar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo, valor]);
  useEffect(() => {
    if (archivo) setEspera("listo");
  }, [archivo]);
  useEffect(() => {
    if (espera !== "contando") return undefined;
    const t = setTimeout(() => setEspera("listo"), ESPERA_MS);
    return () => clearTimeout(t);
  }, [espera]);
  useEffect(() => {
    onListoComprobante?.(espera === "listo");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [espera]);

  if (!tipo) return null;
  const etiqueta = tipo === "cuenta" ? "Transfiere a" : tipo === "plin" ? "Plinea a" : "Yapea a";

  const elegir = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) onArchivo(f);
  };

  return (
    // key = método: al cambiarlo, el bloque vuelve a desplegarse.
    <div className="tz-pagoc" key={tipo} ref={raiz}>
      {valor ? (
        <div className="tz-pagoc-datos">
          <BotonCopiar etiqueta={etiqueta} valor={valor} onCopiado={() => setEspera((e) => (e === "copiar" ? "contando" : e))} />
          {espera === "copiar" && <p className="tz-pagoc-pista">Copia el número, paga y vuelve: aquí adjuntas tu comprobante.</p>}
          {datos?.titular && <p className="tz-pagoc-titular">Titular: {datos.titular}</p>}
        </div>
      ) : (
        <p className="tz-stock-editor-sub tz-pagoc-sin-datos">{sinDatosTexto}</p>
      )}

      {espera === "contando" && <LineaEspera ancla={raiz.current} />}

      {pedirComprobante && espera === "listo" && (
        <div className="tz-pagoc-comprobante">
          <label className="tz-scan-btn tz-pagoc-adjuntar">
            <Camera size={16} /> {archivo ? "Cambiar comprobante" : "Adjuntar comprobante"}
            <input type="file" accept="image/*" hidden onChange={elegir} />
          </label>
          <BotonPegarComprobante onArchivo={onArchivo} />
          {preview && <img src={preview} alt="Comprobante" className="tz-pagoc-preview" />}
        </div>
      )}
    </div>
  );
}
