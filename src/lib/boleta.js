import html2canvas from "html2canvas";

// Boletas: imagen para WhatsApp (copiar / compartir) e impresión en
// ticketera térmica. Las dos parten del MISMO nodo de TicketBoleta
// montado fuera de pantalla.

// Ticketera estándar de 80 mm: 72 mm de área imprimible = 576 puntos a
// 203 dpi (casi todas las POS). La boleta impresa se dibuja EXACTAMENTE
// a ese ancho en píxeles y se imprime a 72 mm, así cada píxel cae en un
// punto del cabezal: texto nítido, sin el reescalado borroso del
// navegador.
const ANCHO_IMPRESION_PX = 576;
const ANCHO_IMPRESION_MM = 72;

async function dibujar(nodo, anchoDestinoPx) {
  const anchoNodo = nodo.getBoundingClientRect().width || nodo.offsetWidth || 350;
  const scale = anchoDestinoPx ? anchoDestinoPx / anchoNodo : window.innerWidth < 768 ? 1.5 : 2;
  const render = html2canvas(nodo, { scale, useCORS: true, allowTaint: true, backgroundColor: "#ffffff" });
  const limite = new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT_RENDER")), 12000));
  try {
    return await Promise.race([render, limite]);
  } catch (err) {
    if (err?.message === "TIMEOUT_RENDER") {
      throw new Error("No se pudo generar la boleta en este dispositivo (tardó demasiado). Intenta de nuevo.");
    }
    throw err;
  }
}

// Blanco y negro puro: una térmica no imprime grises (los convierte en
// puntos sueltos que se ven sucios). Umbral por luminancia.
function aBlancoYNegro(canvas) {
  const ctx = canvas.getContext("2d");
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = d[i + 3] < 40 || lum > 175 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function nodoDe(nodeRef) {
  const nodo = nodeRef?.current;
  if (!nodo) throw new Error("No se pudo preparar la boleta. Intenta de nuevo.");
  return nodo;
}

async function blobDeBoleta(nodeRef) {
  const canvas = await dibujar(nodoDe(nodeRef));
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No se pudo generar la imagen de la boleta.");
  return blob;
}

function descargar(blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `boleta-${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function compartirArchivo(blob) {
  const archivo = new File([blob], `boleta-${Date.now()}.png`, { type: "image/png" });
  if (!navigator.canShare?.({ files: [archivo] })) return null;
  try {
    await navigator.share({ files: [archivo], title: "Boleta" });
    return { compartido: true };
  } catch (err) {
    if (err?.name === "AbortError") return { cancelado: true };
    return null;
  }
}

// Copiar la boleta para pegarla en WhatsApp. La escritura al
// portapapeles se ARRANCA en el mismo instante del toque, con la imagen
// como promesa (ClipboardItem acepta una Promise<Blob>): Safari/iPhone
// rechaza la copia si antes se espera a dibujar la boleta (pierde el
// "gesto del usuario"), que era el aviso de "no se puede copiar". Si el
// navegador no deja copiar (sin https, o no soporta imágenes), se
// ofrece compartir (solo con { compartir: true } — celular: abre la hoja
// de compartir con la imagen adjunta) y, como último recurso, se
// descarga. Los flujos que abren WhatsApp solos después de copiar no
// piden compartir (si no, se abrirían dos veces).
// Devuelve { copiado } | { compartido } | { cancelado } | { descargado }.
export async function copiarBoletaAlPortapapeles(nodeRef, { compartir = false } = {}) {
  nodoDe(nodeRef);
  const blobPromise = blobDeBoleta(nodeRef);
  if (window.isSecureContext && navigator.clipboard?.write && typeof window.ClipboardItem === "function") {
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blobPromise })]);
      return { copiado: true };
    } catch (err) {
      console.warn("[boleta] no se pudo copiar, se intenta compartir/descargar:", err);
    }
  }
  const blob = await blobPromise;
  if (compartir) {
    const compartido = await compartirArchivo(blob);
    if (compartido) return compartido;
  }
  descargar(blob);
  return { descargado: true };
}

// "Compartir boleta" (celular): abre la hoja de compartir del sistema
// con la imagen adjunta — se elige WhatsApp y el chat, sin copiar/pegar.
// Si el navegador no puede compartir archivos, copia (o descarga).
export async function compartirBoleta(nodeRef) {
  if (!navigator.canShare) return copiarBoletaAlPortapapeles(nodeRef);
  const blob = await blobDeBoleta(nodeRef);
  const r = await compartirArchivo(blob);
  if (r) return r;
  descargar(blob);
  return { descargado: true };
}

export function puedeCompartirArchivos() {
  try {
    const prueba = new File(["x"], "x.png", { type: "image/png" });
    return !!navigator.canShare?.({ files: [prueba] });
  } catch {
    return false;
  }
}

// Imprime SOLO la boleta en la ticketera: se dibuja como imagen a
// 576 px (= 72 mm a 203 dpi) en blanco y negro puro y se manda a imprimir
// desde un iframe aislado con la hoja EXACTA del rollo: 80 mm de ancho y
// el alto justo de la boleta (se calcula de la imagen, antes de escribir
// la página — así el tamaño de hoja va desde el principio). Devuelve una
// promesa; los errores se informan por ella.
export async function imprimirBoleta(nodeRef) {
  const canvas = aBlancoYNegro(await dibujar(nodoDe(nodeRef), ANCHO_IMPRESION_PX));
  const dataUrl = canvas.toDataURL("image/png");
  const altoImagenMm = (ANCHO_IMPRESION_MM * canvas.height) / canvas.width;
  const altoHojaMm = Math.ceil(altoImagenMm + 8);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Boleta</title><style>
    @page { size: 80mm ${altoHojaMm}mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    img { display: block; width: ${ANCHO_IMPRESION_MM}mm; height: auto; margin: 4mm auto 0; image-rendering: pixelated; }
  </style></head><body><img src="${dataUrl}" alt="Boleta"></body></html>`);
  doc.close();

  const img = doc.querySelector("img");
  await new Promise((resolve) => {
    if (img.complete) resolve();
    else {
      img.onload = resolve;
      img.onerror = resolve;
    }
  });
  iframe.contentWindow.focus();
  iframe.contentWindow.print();
  setTimeout(() => iframe.remove(), 1500);
}
