import { useState, useEffect, useMemo, useRef } from "react";
import {
  Pencil,
  X,
  Plus,
  Minus,
  ShoppingCart,
  Check,
  AlertTriangle,
  Loader2,
  Receipt,
  Save,
  ChevronDown,
  ChevronUp,
  Camera,
  Star,
  TrendingUp,
  Wallet,
  CreditCard,
  BookOpen,
  MessageCircle,
  TrendingDown,
  Trash2,
  Building2,
  LogOut,
  Download,
  Users,
  Package,
  ScanLine,
  Lock,
  DollarSign,
  Trophy,
  Percent,
  Upload,
  Wand2,
} from "lucide-react";
import { supabase } from "./supabaseClient";
import { createWorker } from "tesseract.js";
import html2canvas from "html2canvas";
import * as XLSX from "xlsx";
import { formatSoles, formatDate } from "./utils/format";
import { useCatalog } from "./hooks/useCatalog";
import Styles from "./components/Styles";
import CardDetail from "./components/CardDetail";
import ComboIngredients from "./components/ComboIngredients";
import ProductImage from "./components/ProductImage";
import FiadoDetalle from "./components/FiadoDetalle";
import { useAuth } from "./contexts/AuthContext";
import {
  buscarProductoPorCodigo,
  resolveStockKey,
  crearProducto,
  crearCombo,
  safeOrdenValue,
  calcularCostoPromedioPonderado,
  composeProductoNombre,
  composeProductoDescripcion,
} from "./lib/productLookup";
import BarcodeScannerModal from "./components/BarcodeScannerModal";
import CatalogVisibilityAccordion from "./components/CatalogVisibilityAccordion";
import ColorPicker from "./components/ColorPicker";
import LogoEasterEgg from "./components/LogoEasterEgg";
import TicketBoleta from "./components/TicketBoleta";

import logo from "./assets/logo.png";

/* ------------------------------------------------------------------ */
/* CATALOGO DINAMICO: la carga (categorias/productos/stock desde       */
/* Supabase) y sus helpers de armado viven ahora en                    */
/* src/hooks/useCatalog.js, compartido entre este POS y el catalogo    */
/* publico.                                                             */
/* ------------------------------------------------------------------ */

/* Costo asumido por producto para calcular la Ganancia Neta, SOLO
   cuando no hay forma de derivarlo de verdad — ver unitCostFor. */
const DEFAULT_COST_RATIO = 0.55;

/* Costo real de un producto = suma del costo promedio ponderado (ver
   'stock.precio_costo', calcularCostoPromedioPonderado en
   productLookup.js) de cada clave que consume, multiplicado por
   cuánto consume de ella. Esto funciona igual de bien para un
   producto simple (una sola clave, qty 1) que para un combo (varias
   claves) — el costo del combo es naturalmente la suma del costo de
   sus partes, sin necesitar su propio dato de costo independiente.
   Si CUALQUIERA de sus claves todavía no tiene un costo cargado (nunca
   se le hizo un ingreso de stock con costo), no se puede confiar en el
   resultado parcial — cae a 'productos.costo' (override manual, si
   existe) y, en último caso, a la estimación del 55%. */
function unitCostFor(product, stockCostos) {
  if (!product) return 0;

  if (Array.isArray(product.consumes) && product.consumes.length > 0 && stockCostos) {
    let total = 0;
    let allKnown = true;
    for (const { key, qty } of product.consumes) {
      const costoUnitario = stockCostos[key];
      if (costoUnitario == null) {
        allKnown = false;
        break;
      }
      total += costoUnitario * qty;
    }
    if (allKnown) return total;
  }

  return product.cost != null ? product.cost : product.price * DEFAULT_COST_RATIO;
}

const PAYMENT_METHODS = [
  { key: "YAPE", label: "Yape" },
  { key: "PLIN", label: "Plin" },
  { key: "OTROS", label: "Otros" },
];

/* Intenta detectar, a partir del texto que devuelve el OCR, el método
   de pago (Yape / Plin / Otro), el ID / código de operación y el
   monto pagado. */
function detectPaymentInfo(rawText) {
  const text = (rawText || "").toUpperCase();

  let method = "OTROS";
  if (text.includes("YAPE")) method = "YAPE";
  else if (text.includes("PLIN")) method = "PLIN";

  const idPatterns = [
    /N[°ºO.]{0,3}\s*(?:DE\s*)?OPERACI[OÓ]N[:\s]*([A-Z0-9-]{4,20})/,
    /C[OÓ]DIGO\s*(?:DE\s*)?OPERACI[OÓ]N[:\s]*([A-Z0-9-]{4,20})/,
    /N[°ºO.]{0,3}\s*OPERACI[OÓ]N[:\s]*([A-Z0-9-]{4,20})/,
    /ID[:\s]*([A-Z0-9-]{4,20})/,
  ];

  let opId = null;
  for (const re of idPatterns) {
    const m = text.match(re);
    if (m && m[1]) {
      opId = m[1];
      break;
    }
  }
  if (!opId) {
    // Como último recurso, busca la secuencia numérica más larga del texto.
    const numbers = text.match(/\d{6,}/g);
    if (numbers && numbers.length > 0) {
      opId = numbers.sort((a, b) => b.length - a.length)[0];
    }
  }

  // Monto: primero busca una etiqueta explícita ("Monto", "Pago",
  // "Total", "Importe"); si no aparece, cae al primer número junto al
  // símbolo de Soles "S/". El usuario siempre revisa esta cifra antes
  // de guardar, así que un acierto aproximado ya es útil.
  const amountPatterns = [
    /(?:MONTO|PAGO|TOTAL|IMPORTE)[:\s]*S?\s?\/?\.?\s*(\d{1,6}(?:[.,]\d{1,2})?)/,
    /S\s?\/\.?\s*(\d{1,6}(?:[.,]\d{1,2})?)/,
  ];

  let amount = null;
  for (const re of amountPatterns) {
    const m = text.match(re);
    if (m && m[1]) {
      amount = m[1].replace(",", ".");
      break;
    }
  }

  return { method, opId, amount };
}

/* ------------------------------------------------------------------ */
/* HELPERS                                                             */
/* ------------------------------------------------------------------ */

/* Arma el texto del resumen de compra para el CRM básico de WhatsApp. */
function buildSaleWhatsappMessage(sale) {
  const lines = sale.items.map(
    (it) =>
      `• ${it.name}${it.detail ? ` (${it.detail})` : ""} x${it.qty} — ${formatSoles(it.total)}`
  );
  const greeting = sale.nombre ? `Hola ${sale.nombre}, ` : "Hola, ";
  return `${greeting}aquí tienes el resumen de tu compra:\n\n${lines.join(
    "\n"
  )}\n\nTotal: ${formatSoles(sale.total)}\n¡Gracias por tu compra!`;
}

/* Perú: los celulares se anotan localmente con 9 dígitos empezando en
   "9" (ej. 987654321), pero wa.me exige el número en formato
   internacional completo (con código de país, sin '+'). Si el cajero
   escribió el número "tal como lo dicta el cliente" (sin 51 adelante,
   el caso más común), se lo anteponemos acá — si ya viene con código
   de país (u otro formato), se manda tal cual, sin adivinar de más. */
function toPeruWhatsappNumber(whatsapp) {
  const cleaned = (whatsapp || "").replace(/[^\d]/g, "");
  if (!cleaned) return null;
  return cleaned.length === 9 && cleaned.startsWith("9") ? `51${cleaned}` : cleaned;
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* Medianoche (hora local) del día que contiene el timestamp dado.
   Se usa como respaldo del corte de turno cuando todavía no se ha
   hecho ningún Cierre de Caja. */
function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function availabilityFor(product, stock) {
  if (!product.consumes || product.consumes.length === 0) return Infinity;
  return Math.min(
    ...product.consumes.map((c) => Math.floor((stock[c.key] ?? 0) / c.qty))
  );
}

/* Igual que resolveStockKey() de productLookup.js, pero sobre
   'item.consumes' YA parseado (el shape que trae productsById) en vez
   del 'producto.consumos' crudo (string/array) que viene directo de
   Supabase. Un producto solo es "editable" desde Agregar Unidades al
   Stock si consume de UNA sola clave — un combo (varias claves) no
   tiene forma no ambigua de saber a cuál sumarle la mercadería. */
function resolveStockKeyFromConsumes(consumes) {
  const claves = [...new Set((consumes || []).map((c) => c.key).filter(Boolean))];
  return claves.length === 1 ? claves[0] : null;
}

// Umbral de "stock crítico" para la alerta visual roja en las
// tarjetas — tanto en la grilla general como dentro del modal de
// variantes.
const LOW_STOCK_THRESHOLD = 5;

// Tag de stock reutilizado en tarjeta simple, tarjeta maestra y modal
// de variantes, para que la alerta roja de stock crítico (<=5) sea
// siempre igual en los tres lugares.
function StockTag({ avail }) {
  const soldOut = avail <= 0;
  const low = avail > 0 && avail <= LOW_STOCK_THRESHOLD;
  if (soldOut) return <span className="tz-tag tz-tag-danger">AGOTADO</span>;
  if (low)
    return (
      <span className="tz-tag tz-tag-danger">
        <AlertTriangle size={11} strokeWidth={2.5} /> ¡Quedan {avail}!
      </span>
    );
  return <span className="tz-tag tz-tag-ok">Stock: {avail}</span>;
}

/* Fila del ticket/carrito con controles de edición: [-] [input] [+] +
   basurero. El input de cantidad usa estado LOCAL (texto libre) en vez
   de escribir directo en 'selection' en cada tecla — así el cajero
   puede seleccionar todo y escribir "20" sin que cada dígito
   intermedio (ej. el "2" antes de completar "20") dispare un clamp o
   un render raro. Se compromete a 'selection' (vía onQtyChange) recién
   al perder foco o presionar Enter; un valor inválido revierte al
   último válido en vez de dejar el carrito en un estado roto. */
function CartRow({ product, qty, avail, unitPrice, discountPercent, onQtyChange, onRemove }) {
  const [localQty, setLocalQty] = useState(String(qty));
  const hasDiscount = discountPercent > 0;
  const effectiveUnitPrice = unitPrice ?? product.price;

  useEffect(() => {
    setLocalQty(String(qty));
  }, [qty]);

  const commit = (raw) => {
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed)) {
      setLocalQty(String(qty));
      return;
    }
    const clamped = Math.min(Math.max(parsed, 1), Math.max(avail, 1));
    onQtyChange(clamped);
    setLocalQty(String(clamped));
  };

  return (
    <div className="tz-cart-row">
      <div className="tz-cart-row-info">
        <span className="tz-cart-row-name">
          {product.name}
          {product.detail ? ` · ${product.detail}` : ""}
          {hasDiscount && (
            <span className="tz-discount-badge tz-discount-badge-inline">-{discountPercent}%</span>
          )}
        </span>
        <span className="tz-cart-row-amount-group">
          {hasDiscount && (
            <span className="tz-cart-row-original">{formatSoles(product.price * qty)}</span>
          )}
          <span className="tz-cart-row-amount">{formatSoles(effectiveUnitPrice * qty)}</span>
        </span>
      </div>
      <div className="tz-cart-row-controls">
        <div className="tz-qty-stepper tz-cart-qty-stepper">
          <button
            type="button"
            onClick={() => onQtyChange(Math.max(qty - 1, 1))}
            disabled={qty <= 1}
            aria-label={`Disminuir cantidad de ${product.name}`}
          >
            <Minus size={14} />
          </button>
          <input
            type="number"
            min="1"
            max={avail}
            className="tz-cart-qty-input"
            value={localQty}
            onChange={(e) => setLocalQty(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commit(e.currentTarget.value);
                e.currentTarget.blur();
              }
            }}
          />
          <button
            type="button"
            onClick={() => onQtyChange(Math.min(qty + 1, avail))}
            disabled={qty >= avail}
            aria-label={`Aumentar cantidad de ${product.name}`}
          >
            <Plus size={14} />
          </button>
        </div>
        <button
          type="button"
          className="tz-cart-remove-btn"
          onClick={onRemove}
          aria-label={`Quitar ${product.name} del ticket`}
          title="Quitar del ticket"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

/* Fase 2 "Inventario Inteligente" (v3 — agrupación ESTRICTA y GLOBAL a
   la sección): agrupa productos que son variantes (sabor/color) de un
   mismo producto base, para no saturar la grilla con una tarjeta por
   cada una. Agrupa exclusivamente por 'item.baseName' (columna
   'productos.nombre_base', ver useCatalog.js y crearProducto/
   editarProductoNombreDetalle en productLookup.js), que es el dato que
   el admin declara explícitamente al crear o editar un producto.

   IMPORTANTE: la agrupación corre sobre TODOS los productos de la
   sección/categoría de una sola vez (todos sus subgrupos juntos), NUNCA
   subgrupo por subgrupo — si se agrupara subgrupo por subgrupo, dos
   variantes con el mismo nombre_base pero archivadas bajo un subgrupo
   distinto (o una con subgrupo y otra sin él) jamás se verían entre sí
   y quedarían separadas en pantalla pese a compartir nombre_base. Cada
   tarjeta resultante (maestra o simple) se dibuja UNA sola vez, bajo el
   encabezado del subgrupo "más temprano" (menor índice) entre sus
   variantes — así el resto de subgrupos no queda con huecos ni con la
   tarjeta duplicada.

   Un grupo de 1 se renderiza como tarjeta normal de siempre, sin modal.
   El escáner de código de barras NUNCA pasa por esta función (resuelve
   directo por codigo_barras a un producto exacto), así que la
   agrupación no lo afecta — ver handleGlobalScan/handleStockProductScan,
   que llaman a buscarProductoPorCodigo + selectProductForSale/
   toggleProduct sin tocar la grilla agrupada en ningún punto. */
function buildSectionDisplayEntries(sectionGroups) {
  const groups = [];
  const indexByKey = new Map();

  sectionGroups.forEach((sectionGroup, gi) => {
    sectionGroup.items.forEach((item) => {
      const baseName = (item.baseName || item.name).trim();
      const baseKey = baseName.toLowerCase();
      if (!indexByKey.has(baseKey)) {
        const group = { baseName, members: [] };
        indexByKey.set(baseKey, group);
        groups.push(group);
      }
      indexByKey.get(baseKey).members.push({ item, gi });
    });
  });

  const entriesByGi = new Map();
  groups.forEach((g) => {
    const homeGi = Math.min(...g.members.map((m) => m.gi));
    const entry =
      g.members.length > 1
        ? { type: "group", baseName: g.baseName, variants: g.members.map((m) => m.item) }
        : { type: "single", item: g.members[0].item };
    if (!entriesByGi.has(homeGi)) entriesByGi.set(homeGi, []);
    entriesByGi.get(homeGi).push(entry);
  });
  return entriesByGi;
}

function nextPurchaseId(sales) {
  let max = 0;
  sales.forEach((s) => {
    const m = /^V-(\d+)$/.exec(s.purchaseId || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return `V-${String(max + 1).padStart(4, "0")}`;
}

/* Arma un .xlsx de una o más hojas a partir de { nombre, filas }[] —
   cada 'filas' es un array de arrays (primera fila = encabezados) — y
   dispara la descarga. Reemplaza al viejo downloadCSV: xlsx soporta
   múltiples hojas por archivo (CSV no), que es lo que necesitan los
   reportes nuevos (datos + resumen mensual en el mismo archivo). */
function downloadXLSX(filename, sheets) {
  const workbook = XLSX.utils.book_new();
  sheets.forEach(({ nombre, filas }) => {
    const worksheet = XLSX.utils.aoa_to_sheet(filas);
    // Autoancho: SheetJS no lo calcula solo — se estima el ancho de
    // cada columna a partir del texto más largo que tenga (encabezado
    // incluido), con un piso y un techo para que ni una columna vacía
    // quede microscópica ni un texto larguísimo se coma toda la hoja.
    if (filas.length > 0) {
      worksheet["!cols"] = filas[0].map((_, colIdx) => {
        const maxLen = filas.reduce((max, row) => {
          const cell = row[colIdx];
          const text = cell == null ? "" : String(cell);
          return Math.max(max, text.length);
        }, 0);
        return { wch: Math.min(Math.max(maxLen + 2, 8), 45) };
      });
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, nombre.slice(0, 31));
  });
  XLSX.writeFile(workbook, filename);
}

const MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
// "2026-08" -> "Agosto 2026"
function formatMesEs(yearMonthKey) {
  const [year, month] = yearMonthKey.split("-").map(Number);
  return `${MESES_ES[month - 1]} ${year}`;
}

/* ------------------------------------------------------------------ */
/* APP                                                                  */
/* ------------------------------------------------------------------ */

export default function App() {
  const { signOut, session, isAdmin, isCajero, nombre: cajeroNombre } = useAuth();
  // Nombre a mostrar para "quién está operando" (p.ej. Cierre de Caja):
  // el nombre real del perfil autenticado si existe, y solo si no hay
  // uno cargado cae al rol genérico.
  const currentUserLabel = cajeroNombre || (isAdmin ? "Admin" : "Cajero");

  /* ---- catálogo dinámico: cargado por el hook compartido useCatalog ---- */
  const {
    sections,
    productsById,
    stock,
    setStock,
    stockLabels,
    stockCostos,
    setStockCostos,
    stockUltimoCosto,
    setStockUltimoCosto,
    loading: catalogLoading,
    error: catalogError,
    setProductVisibility,
    reorderCategorias,
    refetch: refetchCatalog,
  } = useCatalog();
  const [restLoading, setRestLoading] = useState(true);
  const loading = catalogLoading || restLoading;
  const loadError = catalogError;

  const [sales, setSales] = useState([]);
  const [activeTab, setActiveTab] = useState(""); // se define al cargar 'sections'
  const [selection, setSelection] = useState({}); // { productId: qty }

  /* ---- Motor de descuentos: SOLO vive acá, en memoria de la sesión de
     venta actual — nunca toca 'productos.price' (el catálogo). Es la
     "Blindaje Contable" pedida: 'historial'/'fiado_items' ya guardan el
     precio de cada línea al momento de vender (mismo patrón que el
     costo congelado), así que aplicar el descuento acá, antes de armar
     esas filas, alcanza para que Cierre de Caja/todayStats — que solo
     leen esas filas, nunca 'productos.price' — cuadren solos sin
     ningún cambio adicional en sus fórmulas. Se reinicia junto con
     'selection' después de cada venta (ver submitVenta). ---- */
  const [discounts, setDiscounts] = useState({}); // { productId: { type: 'percent'|'monto', value: number } }
  const [discountModalProduct, setDiscountModalProduct] = useState(null);
  const [discountModalType, setDiscountModalType] = useState("percent");
  const [discountModalValue, setDiscountModalValue] = useState("");

  const discountedUnitPrice = (product) => {
    const d = discounts[product.id];
    if (!d || !(d.value > 0)) return product.price;
    const raw =
      d.type === "percent" ? product.price * (1 - d.value / 100) : product.price - d.value;
    return Math.max(0, Math.round(raw * 100) / 100);
  };

  const discountPercentOf = (product) => {
    const finalPrice = discountedUnitPrice(product);
    if (finalPrice >= product.price || product.price <= 0) return 0;
    return Math.round((1 - finalPrice / product.price) * 100);
  };

  const openDiscountModal = (product) => {
    const existing = discounts[product.id];
    setDiscountModalType(existing?.type ?? "percent");
    setDiscountModalValue(existing ? String(existing.value) : "");
    setDiscountModalProduct(product);
  };

  const closeDiscountModal = () => {
    setDiscountModalProduct(null);
    setDiscountModalValue("");
  };

  const saveDiscountModal = () => {
    const value = parseFloat(discountModalValue);
    if (!discountModalProduct || isNaN(value) || value <= 0) {
      closeDiscountModal();
      return;
    }
    const clamped =
      discountModalType === "percent" ? Math.min(value, 100) : Math.min(value, discountModalProduct.price);
    setDiscounts((prev) => ({
      ...prev,
      [discountModalProduct.id]: { type: discountModalType, value: clamped },
    }));
    closeDiscountModal();
  };

  const removeDiscount = (productId) => {
    setDiscounts((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  };

  const [submitError, setSubmitError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [ventaSubmitting, setVentaSubmitting] = useState(false);
  const successTimer = useRef(null);

  /* ---- buscador global + escáner rápido de la pantalla principal:
     agilizan encontrar/vender un producto sin navegar entre pestañas
     de categoría a mano. Viven separados de 'stockSearchTerm' (que es
     el buscador del modal "Agregar Unidades al Stock") — son
     buscadores distintos con propósitos distintos. ---- */
  const [globalSearchTerm, setGlobalSearchTerm] = useState("");
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalScannerOpen, setGlobalScannerOpen] = useState(false);
  const [globalScanBusy, setGlobalScanBusy] = useState(false);
  const [globalScanError, setGlobalScanError] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [stockEdits, setStockEdits] = useState({});
  // Costo TOTAL (no unitario) de la compra que entra a cada clave —
  // junto con stockEdits[key] (unidades) alimenta el Costo Promedio
  // Ponderado al guardar (ver saveStockEdits).
  const [stockCostEdits, setStockCostEdits] = useState({});
  const [savingStock, setSavingStock] = useState(false);

  /* ---- edición rápida de precio de venta desde la tarjeta del
     producto (solo admin) ---- */
  const [editingPriceProduct, setEditingPriceProduct] = useState(null);
  const [editingPriceValue, setEditingPriceValue] = useState("");
  const [editingPriceSaving, setEditingPriceSaving] = useState(false);
  const [editingPriceError, setEditingPriceError] = useState("");
  const [stockSavedMsg, setStockSavedMsg] = useState("");
  const [visibilityError, setVisibilityError] = useState("");

  /* ---- Fase 2 "Inventario Inteligente": modal rápido de selección
     de variante, abierto al tocar una tarjeta maestra agrupada ---- */
  const [variantModalGroup, setVariantModalGroup] = useState(null);

  /* ---- "Agregar unidades al stock": búsqueda manual por texto +
     escáner de producto (mismo html5-qrcode/productLookup.js que ya
     usa Gastos) para filtrar la lista a un solo producto. ---- */
  const [stockSearchTerm, setStockSearchTerm] = useState("");
  const [scannedStockKey, setScannedStockKey] = useState(null);
  const [stockScannerOpen, setStockScannerOpen] = useState(false);
  const [stockScanBusy, setStockScanBusy] = useState(false);
  const [stockScanError, setStockScanError] = useState("");

  /* ---- alta rápida de producto: se abre cuando el escáner lee un
     código que no existe todavía en 'productos' ---- */
  const [newProductoOpen, setNewProductoOpen] = useState(false);
  const [newProductoCodigo, setNewProductoCodigo] = useState("");
  const [newProductoNombre, setNewProductoNombre] = useState("");
  const [newProductoVariante, setNewProductoVariante] = useState("");
  const [newProductoPresentacion, setNewProductoPresentacion] = useState("");
  const [newProductoColor, setNewProductoColor] = useState(null);
  const [newProductoPrecio, setNewProductoPrecio] = useState("");
  const [newProductoCategoria, setNewProductoCategoria] = useState("");
  const [newProductoSubgrupo, setNewProductoSubgrupo] = useState("");
  // Stock inicial + costo, capturados en el MISMO formulario de alta
  // (unificación con "Agregar Unidades al Stock" — ver saveNewProducto)
  // para que el costo promedio ponderado exista desde el primer día,
  // no recién cuando alguien pase por Agregar Unidades después.
  const [newProductoUnidades, setNewProductoUnidades] = useState("");
  const [newProductoCostoTotal, setNewProductoCostoTotal] = useState("");
  const [newProductoSaving, setNewProductoSaving] = useState(false);
  const [newProductoError, setNewProductoError] = useState("");

  /* ---- "+ Nueva variedad" (Agregar Unidades al Stock): alta rápida
     de una variante del mismo producto base sin salir de la pantalla
     de ingreso de mercadería — reusa agregarVariante(), la misma
     función que ya usa "+ Añadir Variante" en Visibilidad. ---- */
  const [nuevaVariedadOpen, setNuevaVariedadOpen] = useState(false);
  const [nuevaVariedadSabor, setNuevaVariedadSabor] = useState("");
  const [nuevaVariedadPresentacion, setNuevaVariedadPresentacion] = useState("");
  const [nuevaVariedadColor, setNuevaVariedadColor] = useState(null);
  const [nuevaVariedadSaving, setNuevaVariedadSaving] = useState(false);
  const [nuevaVariedadError, setNuevaVariedadError] = useState("");

  /* ---- "+ Nuevo Combo" (Editar Stock, solo admin): arma un producto
     sin stock propio a partir de N ingredientes existentes + cantidad
     cada uno — ver crearCombo() en productLookup.js. 'comboItems' es
     la receta en construcción: [{ productId, name, qty }]. */
  const [comboModalOpen, setComboModalOpen] = useState(false);
  const [comboNombre, setComboNombre] = useState("");
  const [comboCategoria, setComboCategoria] = useState("Combos");
  const [comboSubgrupo, setComboSubgrupo] = useState("");
  const [comboPrecio, setComboPrecio] = useState("");
  const [comboItems, setComboItems] = useState([]);
  const [comboSearchTerm, setComboSearchTerm] = useState("");
  const [comboSaving, setComboSaving] = useState(false);
  const [comboError, setComboError] = useState("");

  /* ---- Módulo de Imágenes (solo admin): 'imageManagerProduct' es el
     producto cuyo modal está abierto (null = cerrado). Subir/Tomar
     Foto van al bucket 'productos-imagenes' (Supabase Storage) y
     actualizan 'productos.imagen_url'.

     "Mejorar con IA" (@imgly/background-removal, 100% en el navegador
     del admin — no hay backend propio de por medio) quita el fondo de
     'lastUploadedImage' (el File/Blob de la última foto elegida en
     ESTA sesión del modal, o si no hay uno, se descarga 'imagen_url')
     y deja el resultado en 'aiPreviewBlob' como una previsualización
     PENDIENTE — recién se sube/reemplaza en Storage cuando el admin
     confirma con "Guardar recorte", nunca antes. ---- */
  const [imageManagerProduct, setImageManagerProduct] = useState(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState("");
  const [lastUploadedImage, setLastUploadedImage] = useState(null);
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiPreviewBlob, setAiPreviewBlob] = useState(null);
  const [aiPreviewUrl, setAiPreviewUrl] = useState("");

  /* ---- módulo global de "Métodos de Pago" (header) ---- */
  const [comprobantes, setComprobantes] = useState([]);
  const [paymentMenuOpen, setPaymentMenuOpen] = useState(false); // menú Yape/Plin/Otros del header
  const [activeMethodModal, setActiveMethodModal] = useState(null); // 'YAPE' | 'PLIN' | 'OTROS' | null
  const [expandedEntryId, setExpandedEntryId] = useState(null); // acordeón de boleta expandido
  // Historial de Ventas: colapsado por defecto (solo últimas 5) para
  // no empujar el resto del dashboard hacia abajo.
  const [historialExpanded, setHistorialExpanded] = useState(false);

  const [modalView, setModalView] = useState("manual"); // 'manual' | 'camera' | 'processing' | 'review'
  const [manualAmount, setManualAmount] = useState("");

  /* ---- calculadora de vuelto (checkout, solo método Efectivo) ---- */
  const [montoRecibido, setMontoRecibido] = useState("");
  const MONTOS_RAPIDOS = [20, 50, 100, 200];

  const [scanDetected, setScanDetected] = useState({ method: "", opId: "", photoUrl: "" });
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState("");
  const [scanError, setScanError] = useState("");
  const [cameraSupported, setCameraSupported] = useState(true);

  /* ---- módulo de Libreta (Fiados / cuentas por cobrar) ---- */
  const [libretaOpen, setLibretaOpen] = useState(false);
  const [clientes, setClientes] = useState([]);
  const [movimientos, setMovimientos] = useState([]);

  /* ---- pagos pendientes de aprobación (comprobantes subidos por
     clientes desde su propia vista) ---- */
  const [pagosPendientes, setPagosPendientes] = useState([]);
  const [resolvingPagoId, setResolvingPagoId] = useState(null);
  const [pagosPendientesError, setPagosPendientesError] = useState("");

  const [addClienteOpen, setAddClienteOpen] = useState(false);
  const [newClienteName, setNewClienteName] = useState("");
  const [newClienteWhatsapp, setNewClienteWhatsapp] = useState("");
  const [newClientePin, setNewClientePin] = useState("");
  const [clienteSaving, setClienteSaving] = useState(false);
  const [clienteError, setClienteError] = useState("");

  const [selectedClienteId, setSelectedClienteId] = useState(null);

  /* ---- módulo de Gastos + Proveedores ---- */
  const [proveedores, setProveedores] = useState([]);
  const [gastos, setGastos] = useState([]);

  const [gastosOpen, setGastosOpen] = useState(false);
  const [gastoTipoComprobante, setGastoTipoComprobante] = useState("Boleta");
  const [gastoNumeroComprobante, setGastoNumeroComprobante] = useState("");
  const [gastoFecha, setGastoFecha] = useState("");
  const [gastoHora, setGastoHora] = useState("");
  const [gastoOrigen, setGastoOrigen] = useState("CAJA"); // 'CAJA' | 'EXTERNO'
  // Método de pago del gasto: ya no es excluyente — el usuario puede
  // prender Efectivo, Digital, o ambos (pago mixto). Solo aplica si
  // origen === 'CAJA'.
  const [gastoPagoEfectivo, setGastoPagoEfectivo] = useState(false);
  const [gastoPagoDigital, setGastoPagoDigital] = useState(false);
  const [gastoMontoEfectivo, setGastoMontoEfectivo] = useState("");
  const [gastoMontoDigital, setGastoMontoDigital] = useState("");
  const [gastoRuc, setGastoRuc] = useState("");
  const [gastoRazonSocial, setGastoRazonSocial] = useState("");
  const [rucLookupStatus, setRucLookupStatus] = useState("idle"); // idle | found | not_found
  const [razonSocialSuggestOpen, setRazonSocialSuggestOpen] = useState(false);
  const [gastoItems, setGastoItems] = useState([
    { id: "item-0", descripcion: "", cantidad: "1", costoTotal: "", productoId: null, stockKey: null },
  ]);
  const [gastoSaving, setGastoSaving] = useState(false);
  const [gastoError, setGastoError] = useState("");
  // Aviso de "el gasto se guardó pero el stock no" — vive fuera del
  // formulario porque closeGastoForm() lo cierra apenas se guarda, y
  // este aviso tiene que seguir visible después de eso.
  const [gastoStockWarning, setGastoStockWarning] = useState("");
  const [gastoFormOpen, setGastoFormOpen] = useState(false);
  const [expandedGastoId, setExpandedGastoId] = useState(null);

  /* ---- Ingreso de Mercadería: escaneo de código de barras/QR de
     producto en Gastos (html5-qrcode) para autocompletar el ítem y
     vincularlo al stock que hay que sumar al guardar. ---- */
  const [productScannerOpen, setProductScannerOpen] = useState(false);
  const [productScanBusy, setProductScanBusy] = useState(false);

  /* ---- Mis Ventas (Hoy): historial compacto del turno actual, con
     Anular Venta para corregir errores de tipeo inmediatos ---- */
  const [misVentasOpen, setMisVentasOpen] = useState(false);
  const [anulandoVentaId, setAnulandoVentaId] = useState(null);
  const [anularError, setAnularError] = useState("");

  /* ---- Usuarios (solo admin): alta de cajeros + gestión (cambiar PIN,
     eliminar) de cajeros Y clientes. 'cajeros' guarda ambos roles pese
     al nombre de la variable (viene del panel original "Cajeros",
     ampliado después a "Usuarios" sin renombrar todo el estado) — cada
     fila trae { id, nombre, role }. ---- */
  const [cajerosOpen, setCajerosOpen] = useState(false);
  const [cajeros, setCajeros] = useState([]);
  const [cajerosLoading, setCajerosLoading] = useState(false);
  const [addCajeroOpen, setAddCajeroOpen] = useState(false);
  const [newCajeroNombre, setNewCajeroNombre] = useState("");
  const [newCajeroUsuario, setNewCajeroUsuario] = useState("");
  const [newCajeroPin, setNewCajeroPin] = useState("");
  const [cajeroSaving, setCajeroSaving] = useState(false);
  const [cajeroError, setCajeroError] = useState("");
  const [usuarioActionError, setUsuarioActionError] = useState("");
  const [deletingUsuarioId, setDeletingUsuarioId] = useState(null);

  /* ---- modal "Cambiar PIN" (dentro del panel de Usuarios) ---- */
  const [pinModalUser, setPinModalUser] = useState(null); // { id, nombre, role } | null
  const [pinModalValue, setPinModalValue] = useState("");
  const [pinModalSaving, setPinModalSaving] = useState(false);
  const [pinModalError, setPinModalError] = useState("");

  /* ---- Fase 1 "Control de Dinero": estado global de la caja
     (abierta/cerrada + fondo inicial) — fila única en 'estado_caja'.
     null mientras carga; después siempre {estado, fondoInicial,
     abiertaPor, abiertaEn, cerradaEn}. ---- */
  const [estadoCaja, setEstadoCaja] = useState(null);
  const [fondoInicialInput, setFondoInicialInput] = useState("");
  const [aperturaSaving, setAperturaSaving] = useState(false);
  const [aperturaError, setAperturaError] = useState("");
  // Confirmación de turno del cajero: NO vive en la base — es "ya vi
  // el fondo inicial de ESTE turno puntual" y se guarda en
  // localStorage (sobrevive a un F5, a cerrar la pestaña y a volver a
  // loguearse el mismo día; una apertura nueva con otro 'abiertaEn'
  // siempre vuelve a pedir confirmación, y Cerrar Caja invalida el
  // valor guardado al cambiar 'abiertaEn' en la próxima apertura).
  const [turnoConfirmadoEn, setTurnoConfirmadoEn] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("tz_turno_confirmado_en") : null
  );

  /* ---- módulo de Cierre de Caja (snapshot + recibo) ---- */
  const [cierres, setCierres] = useState([]);
  const [cierreModalOpen, setCierreModalOpen] = useState(false);
  const [confirmCierreOpen, setConfirmCierreOpen] = useState(false);
  const [cierreSaving, setCierreSaving] = useState(false);
  const [cierreError, setCierreError] = useState("");
  const [efectivoReal, setEfectivoReal] = useState(""); // arqueo de caja

  /* ---- CRM básico (WhatsApp) en el proceso de cobro ---- */
  const [checkoutNombre, setCheckoutNombre] = useState("");
  const [checkoutWhatsapp, setCheckoutWhatsapp] = useState("");
  const [checkoutNombreSuggestOpen, setCheckoutNombreSuggestOpen] = useState(false);
  const [checkoutWhatsappSuggestOpen, setCheckoutWhatsappSuggestOpen] = useState(false);
  const [lastSale, setLastSale] = useState(null); // resumen de la última venta enviada

  /* ---- boleta digital por WhatsApp: captura (html2canvas) del
     TicketBoleta oculto -> imagen -> portapapeles -> abre wa.me para
     que el cajero solo tenga que pegar (Ctrl+V) la imagen. ---- */
  const ticketRef = useRef(null);
  const [boletaSending, setBoletaSending] = useState(false);
  const [boletaError, setBoletaError] = useState("");

  /* ---- checkout: método de pago obligatorio antes de "Enviar Venta" ---- */
  const [checkoutMetodo, setCheckoutMetodo] = useState(null); // 'YAPE'|'PLIN'|'OTROS'|'FIADO'|null
  const [checkoutFiadoClienteId, setCheckoutFiadoClienteId] = useState(null);
  const [checkoutFiadoAddingNew, setCheckoutFiadoAddingNew] = useState(false);
  const [checkoutFiadoNewName, setCheckoutFiadoNewName] = useState("");
  const [checkoutFiadoNewWhatsapp, setCheckoutFiadoNewWhatsapp] = useState("");
  const [checkoutFiadoNewPin, setCheckoutFiadoNewPin] = useState("");
  const [checkoutFiadoSaving, setCheckoutFiadoSaving] = useState(false);

  /* ---- fiado_items: deuda por producto individual (permite el
     descuento LIFO en "Restar Crédito") ---- */
  const [fiadoItems, setFiadoItems] = useState([]);
  const [cobroFormFor, setCobroFormFor] = useState(null); // { clienteId, tipo: 'RESTAR'|'CANCELAR' } | null
  const [cobroMonto, setCobroMonto] = useState("");
  const [cobroMetodo, setCobroMetodo] = useState(""); // 'EFECTIVO' | 'DIGITAL' | ""
  const [cobroSaving, setCobroSaving] = useState(false);
  const [cobroError, setCobroError] = useState("");

  /* ---- vista de Pagos: historial de cobros de fiado (solo lectura) ---- */
  const [fiadosViewOpen, setFiadosViewOpen] = useState(false);
  const [expandedFiadoPagoId, setExpandedFiadoPagoId] = useState(null);

  /* ---- Top Clientes (ranking de fidelidad) ---- */
  const [topClientesOpen, setTopClientesOpen] = useState(false);
  const [expandedTopClienteId, setExpandedTopClienteId] = useState(null);
  const [vipExportMsg, setVipExportMsg] = useState("");

  const paymentMenuRef = useRef(null);
  const globalSearchRef = useRef(null);
  const checkoutNombreRef = useRef(null);
  const checkoutWhatsappRef = useRef(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const fileInputRef = useRef(null);
  const submitBarRef = useRef(null);

  /* ---- la barra de "Enviar Venta" (footer) es fixed y de altura
     variable (crece con la lista de productos seleccionados, o
     desaparece por completo si no hay nada seleccionado). Medimos su
     altura real para que el contenido nunca quede tapado detrás de
     ella. El header, en cambio, usa un padding-top fijo y generoso en
     el CSS (no depende de medición por JS) para eliminar cualquier
     posibilidad de que quede tapando los medidores. ---- */
  useEffect(() => {
    const updateFooterOffset = () => {
      const footerH = submitBarRef.current?.offsetHeight || 0;
      document.documentElement.style.setProperty("--tz-footer-h", `${footerH}px`);
    };

    updateFooterOffset();
    if (!submitBarRef.current) return undefined;

    const ro = new ResizeObserver(updateFooterOffset);
    ro.observe(submitBarRef.current);
    window.addEventListener("resize", updateFooterOffset);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateFooterOffset);
    };
  }, [loading, selection, submitError, successMsg]);

  /* ---- cierra el menú "Métodos de Pago" del header al hacer clic afuera ---- */
  useEffect(() => {
    if (!paymentMenuOpen) return undefined;
    const handleClickOutside = (e) => {
      if (paymentMenuRef.current && !paymentMenuRef.current.contains(e.target)) {
        setPaymentMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [paymentMenuOpen]);

  /* ---- cierra el dropdown de sugerencias del buscador global al hacer clic afuera ---- */
  useEffect(() => {
    if (!globalSearchOpen) return undefined;
    const handleClickOutside = (e) => {
      if (globalSearchRef.current && !globalSearchRef.current.contains(e.target)) {
        setGlobalSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [globalSearchOpen]);

  /* ---- cierra los dropdowns de autocompletado de Nombre/WhatsApp del
     checkout al hacer clic afuera (mismo patrón que el resto de la
     app) ---- */
  useEffect(() => {
    if (!checkoutNombreSuggestOpen) return undefined;
    const handleClickOutside = (e) => {
      if (checkoutNombreRef.current && !checkoutNombreRef.current.contains(e.target)) {
        setCheckoutNombreSuggestOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [checkoutNombreSuggestOpen]);

  useEffect(() => {
    if (!checkoutWhatsappSuggestOpen) return undefined;
    const handleClickOutside = (e) => {
      if (checkoutWhatsappRef.current && !checkoutWhatsappRef.current.contains(e.target)) {
        setCheckoutWhatsappSuggestOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [checkoutWhatsappSuggestOpen]);

  /* ---- proveedor inteligente: si el RUC (11 dígitos, formato Perú)
     ya existe en la tabla 'proveedores', autocompleta la Razón Social;
     si no, deja el campo libre para que el usuario la escriba. ---- */
  useEffect(() => {
    const ruc = gastoRuc.trim();
    if (ruc.length !== 11) {
      setRucLookupStatus("idle");
      return;
    }
    const match = proveedores.find((p) => p.ruc === ruc);
    if (match) {
      setGastoRazonSocial(match.razonSocial);
      setRucLookupStatus("found");
    } else {
      setRucLookupStatus("not_found");
    }
  }, [gastoRuc, proveedores]);

  // Sugerencias de Razón Social mientras se tipea (autocompletado
  // cruzado: elegir una acá rellena el RUC). Solo busca a partir de 2
  // caracteres para no mostrar la lista completa de proveedores apenas
  // se hace foco en el campo.
  const razonSocialMatches =
    gastoRazonSocial.trim().length >= 2
      ? proveedores
          .filter((p) =>
            p.razonSocial.toLowerCase().includes(gastoRazonSocial.trim().toLowerCase())
          )
          .slice(0, 6)
      : [];

  const selectProveedorSuggestion = (proveedor) => {
    setGastoRazonSocial(proveedor.razonSocial);
    setGastoRuc(proveedor.ruc);
    setRazonSocialSuggestOpen(false);
  };

  /* ---- autocompletado de "Descripción" en los ítems de Gastos: a
     diferencia del vínculo por escaneo (handleProductScan, que enlaza
     por 'productos' vía código de barras), este busca directo en
     'stock' por nombre — permite marcar como "Ingreso de Mercadería"
     un ítem sin tener el código de barras a mano. Un único id de fila
     abierto a la vez (mismo patrón que razonSocialSuggestOpen). ---- */
  const [gastoItemSuggestOpenId, setGastoItemSuggestOpenId] = useState(null);

  const gastoItemStockSuggestions = (query) => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return Object.keys(stock)
      .filter((key) => (stockLabels[key] ?? key).toLowerCase().includes(q))
      .sort((a, b) => (stockLabels[a] ?? a).localeCompare(stockLabels[b] ?? b))
      .slice(0, 6);
  };

  const selectGastoItemStock = (itemId, key) => {
    setGastoItems((prev) =>
      prev.map((it) =>
        it.id === itemId
          ? { ...it, descripcion: stockLabels[key] ?? key, stockKey: key, productoId: null }
          : it
      )
    );
    setGastoItemSuggestOpenId(null);
  };

  /* ---- resuelve a qué clave de 'stock' corresponde un ítem del gasto
     al momento de guardar: si ya viene vinculado (escaneo o
     autocompletado) se usa ese vínculo tal cual; si no, se intenta un
     match EXACTO (no parcial, para no cruzar "Coca Cola" con "Coca
     Cola 1.5L" por accidente) contra las etiquetas de 'stock', por si
     el usuario tipeó el nombre completo a mano sin pasar por la
     sugerencia. Un gasto genérico ("Pago de luz") simplemente no
     matchea nada y queda fuera de la actualización de stock. ---- */
  const resolveGastoItemStockKey = (it) => {
    if (it.stockKey) return it.stockKey;
    const desc = it.descripcion.trim().toLowerCase();
    if (!desc) return null;
    return (
      Object.keys(stock).find((key) => (stockLabels[key] ?? key).trim().toLowerCase() === desc) ||
      null
    );
  };

  /* ---- carga inicial: SELECT a Supabase (historial, comprobantes, libreta,
     proveedores, gastos, cierres). El catálogo/stock los trae useCatalog. ---- */
  useEffect(() => {
    let cancelled = false;

    async function load() {
      // 3) HISTORIAL
      const { data: historialRows, error: historialError } = await supabase
        .from("historial")
        .select("*")
        .order("fecha", { ascending: false });

      if (historialError) {
        console.error("Error cargando historial desde Supabase:", historialError);
      }

      const loadedSales = (historialRows || []).map((row) => ({
        saleId: row.id ?? `${row.purchase_id}-${row.producto}-${row.fecha}`,
        purchaseId: row.purchase_id,
        name: row.producto,
        detail: row.detalle,
        qty: row.cantidad,
        price: row.precio,
        total: row.total,
        // Costo congelado al momento de la venta — null en filas
        // anteriores a la migración 0026 (no se puede reconstruir
        // retroactivamente). costOf() en todayStats trata null como 0.
        costoUnitario: row.costo_unitario != null ? Number(row.costo_unitario) : null,
        costoTotal: row.costo_total != null ? Number(row.costo_total) : null,
        montoRecibido: row.monto_recibido != null ? Number(row.monto_recibido) : null,
        vuelto: row.vuelto != null ? Number(row.vuelto) : null,
        metodoPago: row.metodo_pago || null,
        // Auditoría: null en filas anteriores a la migración 0032.
        vendedor: row.vendedor || null,
        timestamp: Number(row.fecha),
      }));

      // 3) COMPROBANTES (ingresos manuales / detectados por OCR)
      const { data: comprobRows, error: comprobError } = await supabase
        .from("comprobantes")
        .select("*")
        .order("fecha", { ascending: false });

      if (comprobError) {
        console.error("Error cargando comprobantes desde Supabase:", comprobError);
      }

      const loadedComprobantes = (comprobRows || []).map((row) => ({
        id: row.id ?? `${row.product_id}-${row.fecha}`,
        productId: row.product_id,
        productName: row.product_name,
        method: row.metodo,
        amount: Number(row.monto),
        opId: row.comprobante_id || null,
        fotoUrl: row.foto_url || null,
        purchaseId: row.purchase_id || null,
        timestamp: Number(row.fecha),
      }));

      // 4) LIBRETA: clientes fiado + fiado_items (deuda por producto) + movimientos (cobros)
      const { data: clienteRows, error: clienteLoadError } = await supabase
        .from("clientes_fiado")
        .select("*")
        .order("fecha", { ascending: false });

      if (clienteLoadError) {
        console.error("Error cargando clientes_fiado desde Supabase:", clienteLoadError);
      }

      const loadedClientes = (clienteRows || []).map((row) => ({
        id: row.id,
        nombre: row.nombre,
        whatsapp: row.whatsapp || "",
        // Solo las filas con auth_user_id tienen una cuenta REAL de
        // Cliente (PIN + login, creada vía la Edge Function) — las
        // usa el ranking de Top Clientes para excluir fiados viejos
        // cargados a mano sin cuenta asociada.
        authUserId: row.auth_user_id || null,
        timestamp: Number(row.fecha),
      }));

      const { data: fiadoItemRows, error: fiadoItemLoadError } = await supabase
        .from("fiado_items")
        .select("*")
        .order("fecha", { ascending: false });

      if (fiadoItemLoadError) {
        console.error("Error cargando fiado_items desde Supabase:", fiadoItemLoadError);
      }

      const loadedFiadoItems = (fiadoItemRows || []).map((row) => ({
        id: row.id,
        clienteId: row.cliente_id,
        purchaseId: row.purchase_id || null,
        productoNombre: row.producto_nombre,
        detalle: row.detalle || "",
        cantidad: Number(row.cantidad),
        precioUnitario: Number(row.precio_unitario),
        monto: Number(row.monto),
        saldoRestante: Number(row.saldo_restante),
        timestamp: Number(row.fecha),
      }));

      const { data: movRows, error: movLoadError } = await supabase
        .from("movimientos_fiado")
        .select("*")
        .order("fecha", { ascending: false });

      if (movLoadError) {
        console.error("Error cargando movimientos_fiado desde Supabase:", movLoadError);
      }

      const loadedMovimientos = (movRows || []).map((row) => ({
        id: row.id,
        clienteId: row.cliente_id,
        tipo: row.tipo,
        monto: Number(row.monto),
        descripcion: row.descripcion || "",
        fotoUrl: row.foto_url || null,
        metodoPago: row.metodo_pago || null,
        timestamp: Number(row.fecha),
      }));

      // 5) GASTOS + PROVEEDORES
      const { data: proveedorRows, error: proveedorLoadError } = await supabase
        .from("proveedores")
        .select("*");

      if (proveedorLoadError) {
        console.error("Error cargando proveedores desde Supabase:", proveedorLoadError);
      }

      const loadedProveedores = (proveedorRows || []).map((row) => ({
        id: row.id,
        ruc: row.ruc,
        razonSocial: row.razon_social,
      }));

      // Se piden los items de cada gasto en la misma consulta (embedding
      // de Supabase vía la FK gasto_items.gasto_id -> gastos.id).
      const { data: gastoRows, error: gastoLoadError } = await supabase
        .from("gastos")
        .select("*, gasto_items(*)")
        .order("fecha", { ascending: false });

      if (gastoLoadError) {
        console.error("Error cargando gastos desde Supabase:", gastoLoadError);
      }

      const loadedGastos = (gastoRows || []).map((row) => ({
        id: row.id,
        proveedorId: row.proveedor_id,
        tipoComprobante: row.tipo_comprobante,
        numeroComprobante: row.numero_comprobante || "",
        origen: row.origen,
        metodoPago: row.metodo_pago || null,
        montoEfectivo: row.monto_efectivo != null ? Number(row.monto_efectivo) : null,
        montoDigital: row.monto_digital != null ? Number(row.monto_digital) : null,
        total: Number(row.total),
        timestamp: Number(row.fecha),
        items: (row.gasto_items || []).map((it) => ({
          id: it.id,
          descripcion: it.descripcion,
          cantidad: Number(it.cantidad),
          precioUnitario: Number(it.precio_unitario),
          subtotal: Number(it.subtotal),
        })),
      }));

      // 6) CIERRES DE CAJA (snapshots de cada corte de turno)
      const { data: cierreRows, error: cierreLoadError } = await supabase
        .from("cierres_caja")
        .select("*")
        .order("fecha", { ascending: false });

      if (cierreLoadError) {
        console.error("Error cargando cierres_caja desde Supabase:", cierreLoadError);
      }

      const loadedCierres = (cierreRows || []).map((row) => ({
        id: row.id,
        turnoInicio: Number(row.turno_inicio),
        recaudadoTotal: Number(row.recaudado_total),
        productosVendidos: Number(row.productos_vendidos),
        ventasRegistradas: Number(row.ventas_registradas),
        gastosTotal: Number(row.gastos_total),
        gananciaNeta: Number(row.ganancia_neta),
        gananciaVentas: row.ganancia_ventas != null ? Number(row.ganancia_ventas) : null,
        gananciaFiados: row.ganancia_fiados != null ? Number(row.ganancia_fiados) : null,
        ticketGeneral: Number(row.ticket_general),
        efectivoReal: row.efectivo_real != null ? Number(row.efectivo_real) : null,
        diferencia: row.diferencia != null ? Number(row.diferencia) : null,
        ingresoEfectivo: row.ingreso_efectivo != null ? Number(row.ingreso_efectivo) : null,
        ingresoDigital: row.ingreso_digital != null ? Number(row.ingreso_digital) : null,
        cajeroNombre: row.cajero_nombre || null,
        fondoInicial: row.fondo_inicial != null ? Number(row.fondo_inicial) : null,
        abiertaEn: row.abierta_en != null ? Number(row.abierta_en) : null,
        timestamp: Number(row.fecha),
      }));

      // 6.5) ESTADO DE CAJA (fila única — abierta/cerrada + fondo inicial)
      const { data: estadoCajaRow, error: estadoCajaLoadError } = await supabase
        .from("estado_caja")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

      if (estadoCajaLoadError) {
        console.error("Error cargando estado_caja desde Supabase:", estadoCajaLoadError);
      }

      const loadedEstadoCaja = estadoCajaRow
        ? {
            estado: estadoCajaRow.estado,
            fondoInicial:
              estadoCajaRow.fondo_inicial != null ? Number(estadoCajaRow.fondo_inicial) : null,
            abiertaPor: estadoCajaRow.abierta_por || null,
            abiertaEn: estadoCajaRow.abierta_en != null ? Number(estadoCajaRow.abierta_en) : null,
            cerradaEn: estadoCajaRow.cerrada_en != null ? Number(estadoCajaRow.cerrada_en) : null,
          }
        : { estado: "cerrada", fondoInicial: null, abiertaPor: null, abiertaEn: null, cerradaEn: null };

      // 7) PAGOS PENDIENTES (comprobantes de clientes por aprobar)
      const { data: pagoRows, error: pagoLoadError } = await supabase
        .from("pagos_pendientes")
        .select("*")
        .eq("estado", "pendiente")
        .order("created_at", { ascending: false });

      if (pagoLoadError) {
        console.error("Error cargando pagos_pendientes desde Supabase:", pagoLoadError);
      }

      const loadedPagosPendientes = (pagoRows || []).map((row) => ({
        id: row.id,
        clienteId: row.cliente_id,
        monto: Number(row.monto),
        tipo: row.tipo,
        urlComprobante: row.url_comprobante,
        timestamp: new Date(row.created_at).getTime(),
      }));

      if (!cancelled) {
        setSales(loadedSales);
        setComprobantes(loadedComprobantes);
        setClientes(loadedClientes);
        setFiadoItems(loadedFiadoItems);
        setMovimientos(loadedMovimientos);
        setProveedores(loadedProveedores);
        setGastos(loadedGastos);
        setCierres(loadedCierres);
        setEstadoCaja(loadedEstadoCaja);
        setPagosPendientes(loadedPagosPendientes);
        setRestLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- activa la primera pestaña del catálogo apenas useCatalog la trae ---- */
  useEffect(() => {
    setActiveTab((prev) => prev || sections[0]?.key || "");
  }, [sections]);

  /* ---- selección de productos ---- */
  const toggleProduct = (product) => {
    const avail = availabilityFor(product, stock);
    if (avail <= 0) return;
    setSubmitError("");
    // Arrancar una venta nueva limpia al toque el aviso de éxito de la
    // anterior — así el carrito se muestra de inmediato en vez de
    // quedar tapado por el mensaje mientras corre su propio timeout.
    if (successMsg) {
      if (successTimer.current) clearTimeout(successTimer.current);
      setSuccessMsg("");
      setLastSale(null);
    }
    setSelection((prev) => {
      const next = { ...prev };
      if (next[product.id] != null) {
        delete next[product.id];
      } else {
        next[product.id] = 1;
      }
      return next;
    });
  };

  /* ---- selección "modo caja registradora" para el buscador global y
     el escáner rápido de la pantalla principal: a diferencia de
     toggleProduct (que DESELECCIONA si el producto ya estaba en el
     carrito), acá siempre queremos SUMAR — la primera vez agrega el
     producto con cantidad 1, y si ya estaba en el carrito (típico al
     escanear la misma unidad dos veces, ej. dos gaseosas iguales) le
     suma +1 en vez de dejarlo igual, igual que un POS real. Clampa al
     stock disponible (mismo límite que ya aplica changeQty) para no
     vender de más. Devuelve false si no hay stock, para que el
     llamador pueda avisar. ---- */
  const selectProductForSale = (product) => {
    const avail = availabilityFor(product, stock);
    if (avail <= 0) return false;
    setSubmitError("");
    if (successMsg) {
      if (successTimer.current) clearTimeout(successTimer.current);
      setSuccessMsg("");
      setLastSale(null);
    }
    setSelection((prev) => {
      const current = prev[product.id] ?? 0;
      return { ...prev, [product.id]: Math.min(current + 1, avail) };
    });
    return true;
  };

  const changeQty = (product, delta) => {
    const avail = availabilityFor(product, stock);
    setSelection((prev) => {
      const current = prev[product.id] ?? 1;
      const next = Math.min(Math.max(current + delta, 1), avail);
      return { ...prev, [product.id]: next };
    });
  };

  // Quita un ítem del ticket por completo (botón de basurero en
  // CartRow) — a diferencia de toggleProduct(), sin chequeo de stock:
  // sacar algo del carrito siempre debe poder hacerse, incluso si ese
  // producto quedó agotado mientras estaba seleccionado.
  const removeFromCart = (id) => {
    setSelection((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const selectedIds = Object.keys(selection);
  const selectedCount = selectedIds.length;
  const totalItems = selectedIds.reduce((sum, id) => sum + selection[id], 0);
  const totalPrice = selectedIds.reduce(
    (sum, id) => sum + discountedUnitPrice(productsById[id]) * selection[id],
    0
  );

  /* ---- envío de venta: INSERT a 'historial' + UPDATE/upsert a 'stock' ---- */
  const handleSubmit = async () => {
    // Blindaje contra doble clic: si ya hay un envío en curso, ignora
    // cualquier clic extra en vez de disparar la venta dos veces.
    if (ventaSubmitting) return;

    setSubmitError("");
    if (selectedIds.length === 0) {
      setSubmitError("Selecciona al menos un producto para continuar.");
      return;
    }
    if (!checkoutMetodo) {
      setSubmitError("Elige un método de pago para continuar.");
      return;
    }
    if (checkoutMetodo === "FIADO" && !checkoutFiadoClienteId) {
      setSubmitError("Elige (o crea) un cliente para fiar esta venta.");
      return;
    }
    let comprobanteMonto = null;
    if (checkoutMetodo !== "FIADO" && checkoutMetodo !== "EFECTIVO") {
      comprobanteMonto = parseFloat(manualAmount);
      if (!manualAmount || isNaN(comprobanteMonto) || comprobanteMonto <= 0) {
        setSubmitError("Ingresa el monto recibido antes de enviar la venta.");
        return;
      }
      // El monto capturado (manual o por OCR) DEBE coincidir exacto con
      // el total de la venta — si no, no se permite enviar. Esto evita
      // registrar, por error, un monto distinto al que realmente
      // corresponde por los productos seleccionados.
      if (Math.abs(comprobanteMonto - totalPrice) > 0.009) {
        setSubmitError(
          `El monto (${formatSoles(comprobanteMonto)}) no coincide con el total de la venta (${formatSoles(
            totalPrice
          )}). Corrígelo antes de enviar.`
        );
        return;
      }
      // Comprobante OBLIGATORIO para métodos digitales, validado ANTES
      // de tocar la base de datos — así la venta y su comprobante son
      // atómicos: o se registran los dos, o no se registra ninguno.
      // Antes esta foto se pedía "opcional" y la venta se guardaba
      // igual sin ella, dejando comprobantes fantasma con foto_url
      // NULL en Supabase.
      if (!scanDetected.photoUrl) {
        setSubmitError("Adjunta el comprobante (foto) antes de enviar la venta.");
        return;
      }
    } else if (checkoutMetodo === "EFECTIVO") {
      // A diferencia de Yape/Plin/Otros, acá el monto NO tiene que
      // coincidir exacto con el total — el cajero anota cuánto billete
      // le dieron (puede ser mayor) para calcular el vuelto. Solo se
      // exige que alcance para cubrir la venta.
      const recibido = parseFloat(montoRecibido);
      if (!montoRecibido || isNaN(recibido) || recibido < totalPrice - 0.009) {
        setSubmitError("Ingresa el monto recibido (debe alcanzar para cubrir el total).");
        return;
      }
    } else {
      // FIADO: el monto sale directo de 'newEntries' (price * qty), la
      // MISMA fuente que 'totalPrice'. No hay forma de que difieran —
      // no existe un número que un cajero pueda escribir mal acá.
    }

    // consumo total agregado por clave de stock
    const needed = {};
    selectedIds.forEach((id) => {
      const product = productsById[id];
      const qty = selection[id];
      product.consumes.forEach((c) => {
        needed[c.key] = (needed[c.key] || 0) + c.qty * qty;
      });
    });

    const faltantes = [];
    Object.keys(needed).forEach((key) => {
      const disponible = stock[key] ?? 0;
      if (needed[key] > disponible) {
        faltantes.push(
          `${stockLabels[key] ?? key} (disponible: ${disponible}, necesita: ${needed[key]})`
        );
      }
    });

    if (faltantes.length > 0) {
      setSubmitError(`Stock insuficiente — ${faltantes.join(" · ")}`);
      return;
    }

    // A partir de acá ya vamos a escribir en Supabase — recién ahora se
    // bloquea el botón. El try/finally garantiza que se reactive pase
    // lo que pase (éxito o error), sin necesidad de repetirlo en cada
    // punto de salida.
    setVentaSubmitting(true);
    try {
      await submitVenta({ comprobanteMonto, needed });
    } finally {
      setVentaSubmitting(false);
    }
  };

  const submitVenta = async ({ comprobanteMonto, needed }) => {
    const newStock = { ...stock };
    Object.keys(needed).forEach((key) => {
      newStock[key] = (newStock[key] ?? 0) - needed[key];
    });

    const purchaseId = nextPurchaseId(sales);
    const timestamp = Date.now();
    // Vuelto: solo tiene sentido para Efectivo (billetes físicos) —
    // el resto de métodos no maneja "cambio". Se congela junto con el
    // resto de la venta, duplicado en cada línea del purchase_id
    // (mismo criterio ya usado acá para 'metodo_pago').
    const montoRecibidoNum = checkoutMetodo === "EFECTIVO" ? parseFloat(montoRecibido) : null;
    const vueltoNum =
      checkoutMetodo === "EFECTIVO" && montoRecibidoNum != null
        ? montoRecibidoNum - totalPrice
        : null;
    // Auditoría: quién procesó la venta. Admin siempre se guarda como
    // "Admin" (no hay múltiples cuentas admin que distinguir); un
    // cajero se guarda con su nombre real para poder rastrear ventas
    // por persona. Texto libre congelado en cada fila — ver migración
    // 0032.
    const vendedorLabel = isAdmin ? "Admin" : cajeroNombre || "Cajero";
    const newEntries = selectedIds.map((id) => {
      const product = productsById[id];
      const qty = selection[id];
      // Fotografía del costo: el costo promedio ponderado ACTUAL
      // (unitCostFor/stockCostos) se calcula una única vez, ACÁ, y
      // queda congelado en 'historial' — el Dashboard de hoy nunca
      // vuelve a preguntarle a 'stock' cuál es el costo, así que un
      // ingreso de mercadería mañana no altera las ventas de hoy.
      const costoUnitario = unitCostFor(product, stockCostos);
      // Precio ya con el descuento aplicado (si lo hay) — esto es lo
      // único que hace falta para que el descuento quede "congelado"
      // en la venta, igual que el costo: 'price'/'total' de acá son
      // los que terminan en 'historial'/'fiado_items'.
      const unitPrice = discountedUnitPrice(product);
      return {
        productId: id,
        name: product.name,
        detail: product.detail,
        qty,
        price: unitPrice,
        total: unitPrice * qty,
        costoUnitario,
        costoTotal: costoUnitario * qty,
      };
    });

    // 1) INSERT múltiple a 'historial' (incluye metodo_pago: se descuenta
    //    stock igual sin importar el método — el fiado también sale del
    //    inventario en el momento de la venta).
    const { data: insertedRows, error: insertError } = await supabase
      .from("historial")
      .insert(
        newEntries.map((e) => ({
          purchase_id: purchaseId,
          producto: e.name,
          detalle: e.detail,
          cantidad: e.qty,
          precio: e.price,
          total: e.total,
          costo_unitario: e.costoUnitario,
          costo_total: e.costoTotal,
          monto_recibido: montoRecibidoNum,
          vuelto: vueltoNum,
          metodo_pago: checkoutMetodo,
          vendedor: vendedorLabel,
          fecha: timestamp,
        }))
      )
      .select();

    if (insertError) {
      console.error("Error detallado:", insertError);
      setSubmitError(
        insertError.message
          ? `No se pudo registrar la venta: ${insertError.message}`
          : "No se pudo registrar la venta en Supabase. Intenta de nuevo."
      );
      return;
    }

    // 2) UPDATE/upsert de 'stock' con las cantidades ya descontadas
    //    (requiere que 'nombre' sea una columna única / clave en la tabla 'stock')
    const stockUpdates = Object.keys(needed).map((key) => ({
      nombre: key,
      cantidad: newStock[key],
    }));

    const { error: stockError } = await supabase
      .from("stock")
      .upsert(stockUpdates, { onConflict: "nombre" });

    if (stockError) {
      console.error("Error al actualizar stock:", stockError);
      setSubmitError(
        "La venta se registró, pero el stock no se pudo actualizar en Supabase."
      );
      // seguimos: el historial ya quedó guardado, no revertimos la venta
    }

    // 2.5) Efecto según método de pago: FIADO crea fiado_items (deuda
    //    por producto, saldo_restante = monto); EFECTIVO no crea nada
    //    más (no hay foto/comprobante que verificar, ya quedó
    //    registrada la venta en 'historial'); Yape/Plin/Otros crean UN
    //    comprobante enlazado a esta venta (purchase_id).
    if (checkoutMetodo === "FIADO") {
      const fiadoItemsPayload = newEntries.map((e) => ({
        cliente_id: checkoutFiadoClienteId,
        purchase_id: purchaseId,
        producto_nombre: e.name,
        detalle: e.detail,
        cantidad: e.qty,
        precio_unitario: e.price,
        monto: e.total,
        saldo_restante: e.total,
        fecha: timestamp,
      }));

      const { data: insertedFiadoItems, error: fiadoItemsError } = await supabase
        .from("fiado_items")
        .insert(fiadoItemsPayload)
        .select();

      if (fiadoItemsError) {
        console.error("Error al registrar fiado_items:", fiadoItemsError);
        setSubmitError(
          "La venta se registró, pero no se pudo asignar la deuda en la Libreta."
        );
      } else {
        const newFiadoItems = (insertedFiadoItems || fiadoItemsPayload).map((row, idx) => ({
          id: row.id ?? `${purchaseId}-fi-${idx}`,
          clienteId: checkoutFiadoClienteId,
          purchaseId,
          productoNombre: fiadoItemsPayload[idx].producto_nombre,
          detalle: fiadoItemsPayload[idx].detalle,
          cantidad: fiadoItemsPayload[idx].cantidad,
          precioUnitario: fiadoItemsPayload[idx].precio_unitario,
          monto: fiadoItemsPayload[idx].monto,
          saldoRestante: fiadoItemsPayload[idx].saldo_restante,
          timestamp: Number(row.fecha ?? timestamp),
        }));
        setFiadoItems((prev) => [...newFiadoItems, ...prev]);
      }
    } else if (checkoutMetodo === "EFECTIVO") {
      // Efectivo no genera comprobante: no hay foto ni operación que
      // verificar, la venta ya quedó completa en 'historial'.
    } else {
      const { data: insertedComprobante, error: comprobanteError } = await supabase
        .from("comprobantes")
        .insert([
          {
            product_id: null,
            product_name: null,
            metodo: checkoutMetodo,
            monto: comprobanteMonto,
            comprobante_id: scanDetected.opId || null,
            foto_url: scanDetected.photoUrl || null,
            purchase_id: purchaseId,
            fecha: timestamp,
          },
        ])
        .select();

      if (comprobanteError) {
        console.error("Error al registrar el comprobante:", comprobanteError);
        setSubmitError("La venta se registró, pero no se pudo guardar el comprobante.");
      } else {
        const row = insertedComprobante && insertedComprobante[0];
        const newComprobante = {
          id: row?.id ?? `${purchaseId}-comp`,
          productId: null,
          productName: null,
          method: checkoutMetodo,
          amount: comprobanteMonto,
          opId: scanDetected.opId || null,
          fotoUrl: scanDetected.photoUrl || null,
          purchaseId,
          timestamp: Number(row?.fecha ?? timestamp),
        };
        setComprobantes((prev) => [newComprobante, ...prev]);
      }
    }

    // 3) Reflejar los cambios en el estado local
    const localEntries = (insertedRows && insertedRows.length
      ? insertedRows
      : newEntries
    ).map((row, idx) => ({
      saleId: row.id ?? `${purchaseId}-${newEntries[idx].productId}`,
      purchaseId: row.purchase_id ?? purchaseId,
      name: row.producto ?? newEntries[idx].name,
      detail: row.detalle ?? newEntries[idx].detail,
      qty: row.cantidad ?? newEntries[idx].qty,
      price: row.precio ?? newEntries[idx].price,
      total: row.total ?? newEntries[idx].total,
      costoUnitario: row.costo_unitario ?? newEntries[idx].costoUnitario,
      costoTotal: row.costo_total ?? newEntries[idx].costoTotal,
      montoRecibido: row.monto_recibido ?? montoRecibidoNum,
      vuelto: row.vuelto ?? vueltoNum,
      metodoPago: row.metodo_pago ?? checkoutMetodo,
      vendedor: row.vendedor ?? vendedorLabel,
      timestamp: Number(row.fecha ?? timestamp),
    }));

    setStock(newStock);
    setSales((prev) => [...localEntries, ...prev]);
    setSelection({});
    setDiscounts({});
    if (!stockError) setSubmitError("");
    setSuccessMsg(`Venta registrada — ID ${purchaseId}`);

    // CRM básico: si se ingresó un WhatsApp, guardamos el resumen de la
    // compra para poder enviarlo por wa.me apenas termine la venta.
    const whatsapp = checkoutWhatsapp.trim();
    const nombre = checkoutNombre.trim();
    const saleTotal = newEntries.reduce((sum, e) => sum + e.total, 0);
    if (whatsapp) {
      setLastSale({
        purchaseId,
        nombre,
        whatsapp,
        items: newEntries,
        total: saleTotal,
        metodoPago: checkoutMetodo,
        timestamp,
      });
    } else {
      setLastSale(null);
    }
    setCheckoutNombre("");
    setCheckoutWhatsapp("");
    setCheckoutMetodo(null);
    setCheckoutFiadoClienteId(null);
    setCheckoutFiadoAddingNew(false);
    setCheckoutFiadoNewName("");
    resetEntryForm();

    if (successTimer.current) clearTimeout(successTimer.current);
    // Si hay un resumen para WhatsApp, dejamos más tiempo visible el
    // botón de envío; si no, el aviso normal de 4s.
    successTimer.current = setTimeout(
      () => {
        setSuccessMsg("");
        setLastSale(null);
      },
      whatsapp ? 20000 : 4000
    );
  };

  /* ---- checkout: elegir método de pago ---- */
  const chooseMetodo = (m) => {
    setCheckoutMetodo(m);
    setCheckoutFiadoClienteId(null);
    setCheckoutFiadoAddingNew(false);
    setCheckoutFiadoNewName("");
    resetEntryForm();
    setSubmitError("");
    if (m === "FIADO" || m === "EFECTIVO") return;
    // Yape/Plin/Otros: saltamos directo al paso de cámara. OJO: NO
    // precargamos el monto acá — así "Enviar Venta" se mantiene oculto
    // (isPaymentStepComplete depende de manualAmount) hasta que el
    // escaneo realmente termine o el usuario cancele a modo manual.
    startCamera();
  };

  /* ---- checkout: volver a elegir método (sin disparar la cámara) ---- */
  const resetMetodo = () => {
    stopCamera();
    setCheckoutMetodo(null);
    setCheckoutFiadoClienteId(null);
    setCheckoutFiadoAddingNew(false);
    setCheckoutFiadoNewName("");
    resetEntryForm();
  };

  /* ---- checkout: crear un cliente nuevo al vuelo (sin salir del cobro) ---- */
  /* ---- alta de cliente desde el checkout (sub-flujo Fiado): usa la
     MISMA Edge Function 'create-cliente' que ya usa la Libreta
     (saveCliente) en vez de un INSERT directo — el PIN es una
     credencial real (password de la cuenta de Supabase Auth del
     cliente, celular@tonazo.app), así que necesita pasar por el
     service_role del servidor para quedar hasheado, nunca guardarse
     en texto plano en una tabla normal. Por esto mismo el celular acá
     es obligatorio (es el usuario de login), no opcional. ---- */
  const saveCheckoutFiadoCliente = async () => {
    const nombre = checkoutFiadoNewName.trim();
    const celular = checkoutFiadoNewWhatsapp.trim();
    const pin = checkoutFiadoNewPin.trim();

    if (!nombre) {
      setSubmitError("Ingresa el nombre del cliente.");
      return;
    }
    if (!/^\d{6,15}$/.test(celular)) {
      setSubmitError("Ingresa un celular válido (solo números, 6 a 15 dígitos).");
      return;
    }
    if (!/^\d{4,10}$/.test(pin)) {
      setSubmitError("El PIN debe tener entre 4 y 10 dígitos.");
      return;
    }

    setCheckoutFiadoSaving(true);
    setSubmitError("");

    const { data, error } = await supabase.functions.invoke("create-cliente", {
      body: { nombre, celular, pin },
    });

    setCheckoutFiadoSaving(false);

    if (error) {
      console.error("Error al crear cliente desde el checkout:", error);
      const body = await error.context?.json?.().catch(() => null);
      setSubmitError(body?.error || "No se pudo crear el cliente. Intenta de nuevo.");
      return;
    }

    const newCliente = {
      id: data.id,
      nombre: data.nombre,
      whatsapp: data.whatsapp,
      timestamp: Number(data.fecha),
    };

    setClientes((prev) => [newCliente, ...prev]);
    setCheckoutFiadoClienteId(newCliente.id);
    setCheckoutFiadoAddingNew(false);
    setCheckoutFiadoNewName("");
    setCheckoutFiadoNewWhatsapp("");
    setCheckoutFiadoNewPin("");
  };

  /* ---- autocompletado de Nombre/WhatsApp en el checkout: sugiere
     clientes ya registrados en 'clientes_fiado' mientras se escribe, y
     vincula ambos campos entre sí — elegir una sugerencia por nombre
     también completa su WhatsApp (si lo tiene), y viceversa. Puramente
     un atajo de tipeo: no obliga a que el cliente exista, el checkout
     normal (no-Fiado) sigue aceptando cualquier nombre/número nuevo. ---- */
  const checkoutNombreSuggestions = useMemo(() => {
    const q = checkoutNombre.trim().toLowerCase();
    if (!q) return [];
    return clientes.filter((c) => c.nombre?.toLowerCase().includes(q)).slice(0, 6);
  }, [checkoutNombre, clientes]);

  const checkoutWhatsappSuggestions = useMemo(() => {
    const q = checkoutWhatsapp.replace(/[^\d]/g, "");
    if (!q) return [];
    return clientes
      .filter((c) => c.whatsapp && c.whatsapp.replace(/[^\d]/g, "").includes(q))
      .slice(0, 6);
  }, [checkoutWhatsapp, clientes]);

  const selectCheckoutClienteByNombre = (c) => {
    setCheckoutNombre(c.nombre || "");
    if (c.whatsapp) setCheckoutWhatsapp(c.whatsapp);
    setCheckoutNombreSuggestOpen(false);
  };

  const selectCheckoutClienteByWhatsapp = (c) => {
    setCheckoutWhatsapp(c.whatsapp || "");
    if (c.nombre) setCheckoutNombre(c.nombre);
    setCheckoutWhatsappSuggestOpen(false);
  };

  /* ---- checkout: ¿ya se puede mostrar "Enviar Venta"? ---- */
  const isPaymentStepComplete = (() => {
    if (!checkoutMetodo) return false;
    if (checkoutMetodo === "FIADO") return !!checkoutFiadoClienteId;
    // Efectivo: exige 'Monto Recibido' >= total (si no, el vuelto
    // saldría negativo) — el total de la venta sale de 'totalPrice',
    // no de este monto (a diferencia de Yape/Plin/Otros, acá el monto
    // recibido puede ser MAYOR al total a propósito, para calcular
    // vuelto).
    if (checkoutMetodo === "EFECTIVO") {
      const recibido = parseFloat(montoRecibido);
      return !isNaN(recibido) && recibido >= totalPrice - 0.009;
    }
    const amt = parseFloat(manualAmount);
    const amountOk = !isNaN(amt) && amt > 0 && Math.abs(amt - totalPrice) <= 0.009;
    // Yape/Plin/Otros: además del monto, exige el comprobante — mismo
    // criterio que valida handleSubmit antes de tocar la base de datos.
    return amountOk && !!scanDetected.photoUrl;
  })();

  /* ---- edición de stock: ya no pide contraseña propia, /admin (vía
     RequireAdmin) exige sesión de admin real para llegar hasta acá ---- */
  const resetNewProductoForm = () => {
    setNewProductoOpen(false);
    setNewProductoCodigo("");
    setNewProductoNombre("");
    setNewProductoVariante("");
    setNewProductoPresentacion("");
    setNewProductoColor(null);
    setNewProductoPrecio("");
    setNewProductoUnidades("");
    setNewProductoCostoTotal("");
    setNewProductoCategoria("");
    setNewProductoSubgrupo("");
    setNewProductoError("");
  };

  const resetNuevaVariedadForm = () => {
    setNuevaVariedadOpen(false);
    setNuevaVariedadSabor("");
    setNuevaVariedadPresentacion("");
    setNuevaVariedadColor(null);
    setNuevaVariedadError("");
  };

  const openEdit = () => {
    setEditOpen(true);
    setStockEdits({});
    setStockCostEdits({});
    setStockSavedMsg("");
    setStockSearchTerm("");
    setScannedStockKey(null);
    setStockScanError("");
    resetNewProductoForm();
    resetNuevaVariedadForm();
  };

  const closeEdit = () => {
    setEditOpen(false);
    setStockEdits({});
    setStockCostEdits({});
    setStockSavedMsg("");
    setStockSearchTerm("");
    setScannedStockKey(null);
    setStockScanError("");
    resetNewProductoForm();
    resetNuevaVariedadForm();
  };

  const handleStockEditChange = (key, value) => {
    if (value === "" || /^[0-9]+$/.test(value)) {
      setStockEdits((prev) => ({ ...prev, [key]: value }));
    }
  };

  const handleStockCostEditChange = (key, value) => {
    if (value === "" || /^\d*\.?\d{0,2}$/.test(value)) {
      setStockCostEdits((prev) => ({ ...prev, [key]: value }));
    }
  };

  /* ---- "Escanear Producto" en Editar Stock: reutiliza el mismo
     buscarProductoPorCodigo/resolveStockKey que ya usa el "Ingreso de
     Mercadería" de Gastos. El escáner (BarcodeScannerModal) ya se
     cierra solo apenas detecta un código — acá solo queda procesar el
     resultado. "Modo Hormiga" (sumar +1) sigue funcionando igual que
     antes, pero ahora entre aperturas/cierres del escáner en vez de
     cámara continua: cada escaneo exitoso del MISMO producto suma +1
     sobre lo que ya había en stockEdits, así que escanear la misma
     unidad varias veces (abriendo la cámara de nuevo cada vez) sigue
     acumulando el conteo. Si el código no existe todavía en
     'productos', se abre el alta rápida (newProductoOpen) con el
     código ya cargado. ---- */
  const handleStockProductScan = async (codigoEscaneado) => {
    setStockScannerOpen(false);
    setStockScanBusy(true);
    setStockScanError("");
    try {
      const producto = await buscarProductoPorCodigo(codigoEscaneado);
      if (!producto) {
        resetNewProductoForm();
        setNewProductoCodigo(codigoEscaneado);
        setNewProductoOpen(true);
        return;
      }
      const stockKey = resolveStockKey(producto);
      if (!stockKey) {
        setStockScanError(
          `"${producto.nombre}" no tiene una única clave de stock asociada (combo, o sin 'consumos') — búscalo manualmente abajo.`
        );
        return;
      }
      setScannedStockKey(stockKey);
      setStockSearchTerm("");
      setStockEdits((prev) => ({
        ...prev,
        [stockKey]: String((parseInt(prev[stockKey], 10) || 0) + 1),
      }));
    } catch (err) {
      console.error("Error buscando producto escaneado (stock):", err);
      setStockScanError("Error al buscar el producto en Supabase. Intenta de nuevo.");
    } finally {
      setStockScanBusy(false);
    }
  };

  /* ---- alta de producto (código escaneado no encontrado, o manual
     desde el buscador): INSERT en 'productos' (+ 'categorias' si la
     categoría es nueva) Y su stock inicial YA con costo, en la misma
     operación — unificado con "Agregar Unidades al Stock" para que el
     costo promedio ponderado exista desde el primer día (ver
     crearProducto() en productLookup.js). Al terminar, refresca el
     catálogo y deja el producto recién creado filtrado en la pantalla
     de "Agregar unidades al stock" (ya con su stock/costo cargados,
     sin nada pendiente de guardar). ---- */
  const saveNewProducto = async () => {
    const nombreBase = newProductoNombre.trim();
    const precioNum = parseFloat(newProductoPrecio);
    const unidadesNum = parseInt(newProductoUnidades, 10);
    const costoTotalNum = parseFloat(newProductoCostoTotal);

    if (!nombreBase) {
      setNewProductoError("Ingresa el nombre base del producto.");
      return;
    }
    if (!newProductoCategoria.trim()) {
      setNewProductoError("Elige o escribe una categoría.");
      return;
    }
    if (isNaN(precioNum) || precioNum <= 0) {
      setNewProductoError("Ingresa un precio de venta válido.");
      return;
    }
    // Mismo criterio que Agregar Unidades al Stock: sin unidades +
    // costo total no hay forma de calcular el costo promedio
    // ponderado, y crear el producto sin costo dejaría la Ganancia
    // Neta desactualizada desde el día 1.
    if (isNaN(unidadesNum) || unidadesNum <= 0) {
      setNewProductoError("Ingresa las unidades que ingresan al stock inicial.");
      return;
    }
    if (isNaN(costoTotalNum) || costoTotalNum < 0) {
      setNewProductoError("Ingresa el costo TOTAL de esta compra.");
      return;
    }

    setNewProductoSaving(true);
    setNewProductoError("");

    try {
      await crearProducto({
        codigoBarras: newProductoCodigo,
        nombreBase,
        variante: newProductoVariante,
        presentacion: newProductoPresentacion,
        color: newProductoColor,
        precio: precioNum,
        categoria: newProductoCategoria,
        subgrupo: newProductoSubgrupo,
        stockExistente: stock,
        unidadesIniciales: unidadesNum,
        costoTotalInicial: costoTotalNum,
      });
      await refetchCatalog();
      const nombreCreado = composeProductoNombre({
        nombreBase,
        variante: newProductoVariante,
        presentacion: newProductoPresentacion,
      });
      resetNewProductoForm();
      setScannedStockKey(null);
      setStockSearchTerm(nombreCreado);
      setStockSavedMsg(`"${nombreCreado}" creado con ${unidadesNum} unidades en stock.`);
    } catch (err) {
      console.error("Error creando producto:", err);
      setNewProductoError(
        err?.message
          ? `No se pudo crear el producto: ${err.message}`
          : "No se pudo crear el producto. Intenta de nuevo."
      );
    } finally {
      setNewProductoSaving(false);
    }
  };

  /* ---- eliminar/desactivar producto desde "Visibilidad en catálogo
     público". El cliente de Supabase-js NO lanza una excepción JS por
     un rechazo de la base de datos (ej. FK violation) — la resuelve
     como { error }, así que el chequeo real va ahí, no en el catch
     (que solo cubre fallos de red/fetch). Código 23503 = Postgres
     "foreign_key_violation": el producto tiene ventas u otras filas
     que lo referencian, así que en vez de forzar el borrado se ofrece
     desactivarlo (soft delete vía 'productos.activo', que ya usa el
     resto del catálogo para filtrar). ---- */
  const eliminarProductoDefinitivo = async (producto) => {
    try {
      const { error } = await supabase.from("productos").delete().eq("id", producto.id);
      if (error) {
        return { error, fkConflict: error.code === "23503" };
      }
      await refetchCatalog();
      return { error: null };
    } catch (err) {
      console.error("Error eliminando producto:", err);
      return { error: err, fkConflict: false };
    }
  };

  const desactivarProductoCatalogo = async (producto) => {
    try {
      const { error } = await supabase
        .from("productos")
        .update({ activo: false })
        .eq("id", producto.id);
      if (error) return { error };
      await refetchCatalog();
      return { error: null };
    } catch (err) {
      console.error("Error desactivando producto:", err);
      return { error: err };
    }
  };

  /* ---- edición al vuelo desde "Visibilidad en catálogo público"
     (botones de lápiz). nombre_base/variante/presentacion/color son
     campos propios de UNA fila de 'productos' (UPDATE simple por id);
     nombre/descripcion se RECOMPONEN a partir de ellos (mismo criterio
     que crearProducto, para no dejar esos dos campos desincronizados
     de la agrupación estricta del POS). Categoría y Subgrupo, en
     cambio, no tienen tabla/id propios en este modelo — 'categoria' es
     un string repetido en cada producto (más su propia fila espejo en
     'categorias', usada solo para armar las secciones del catálogo) y
     'subgrupo' es un string libre sin tabla — así que renombrarlos es
     necesariamente un UPDATE masivo sobre todos los productos que
     comparten ese valor, no una edición de una sola fila. ---- */
  const editarProductoNombreDetalle = async (producto, { nombreBase, variante, presentacion, color }) => {
    try {
      const { error } = await supabase
        .from("productos")
        .update({
          nombre: composeProductoNombre({ nombreBase, variante, presentacion }),
          descripcion: composeProductoDescripcion({ variante, presentacion }),
          nombre_base: (nombreBase || "").trim(),
          variante: (variante || "").trim() || null,
          presentacion: (presentacion || "").trim() || null,
          color_variante: color || null,
        })
        .eq("id", producto.id);
      if (error) return { error };
      await refetchCatalog();
      return { error: null };
    } catch (err) {
      console.error("Error editando producto:", err);
      return { error: err };
    }
  };

  /* ---- edición rápida de precio de venta (lápiz en la tarjeta del
     producto, solo admin — el botón mismo ya está gateado por isAdmin
     en el render, esto es la lógica de guardado). ---- */
  const openPriceEdit = (item) => {
    setEditingPriceProduct(item);
    setEditingPriceValue(String(item.price));
    setEditingPriceError("");
  };

  const closePriceEdit = () => {
    setEditingPriceProduct(null);
    setEditingPriceValue("");
    setEditingPriceError("");
  };

  const savePriceEdit = async () => {
    if (!editingPriceProduct) return;
    const nuevoPrecio = parseFloat(editingPriceValue);
    if (isNaN(nuevoPrecio) || nuevoPrecio <= 0) {
      setEditingPriceError("Ingresa un precio válido, mayor a 0.");
      return;
    }

    setEditingPriceSaving(true);
    setEditingPriceError("");

    const { data, error } = await supabase
      .from("productos")
      .update({ precio: nuevoPrecio })
      .eq("id", editingPriceProduct.id)
      .select("id");

    setEditingPriceSaving(false);

    if (error) {
      console.error("Error actualizando precio:", error);
      setEditingPriceError(
        error.message ? `No se pudo guardar: ${error.message}` : "No se pudo guardar el precio."
      );
      return;
    }
    // Mismo blindaje que el resto de la app: RLS puede dejar pasar un
    // UPDATE sin afectar filas, sin devolver error.
    if (!data || data.length === 0) {
      setEditingPriceError(
        "No se pudo guardar (0 filas afectadas) — revisa los permisos de UPDATE en 'productos'."
      );
      return;
    }

    await refetchCatalog();
    closePriceEdit();
  };

  /* ---- Renombrar categoría SIN tocar el esquema SQL (la FK
     productos_categoria_fkey no tiene ON UPDATE CASCADE, así que un
     UPDATE directo a categorias.nombre queda bloqueado mientras haya
     productos apuntando al nombre viejo). Se hace "a mano" en 3 pasos
     secuenciales, cada uno dejando la base en un estado válido para la
     FK antes de seguir con el siguiente:
       1) INSERT del padre nuevo (con el nombre nuevo) — recién ahí
          los productos van a poder apuntarle sin violar la FK.
       2) UPDATE de todos los productos que tenían el nombre viejo, al
          nuevo — ya existe como fila padre desde el paso 1.
       3) DELETE del padre viejo — ya no lo referencia ningún producto,
          así que se puede borrar sin violar la FK.
     Si el paso 2 falla, se deshace el paso 1 (el padre nuevo no debe
     quedar huérfano/sin usar). Si falla el paso 3, los productos ya
     quedaron migrados correctamente — solo queda una fila vieja sin
     productos, que se puede limpiar a mano después. ---- */
  const renombrarCategoria = async (categoriaActual, nombreNuevoRaw) => {
    const nombreNuevo = (nombreNuevoRaw || "").trim();
    if (!nombreNuevo || nombreNuevo === categoriaActual) return { error: null };
    try {
      const { data: catViejaRow, error: lookupError } = await supabase
        .from("categorias")
        .select("activo, orden")
        .eq("nombre", categoriaActual)
        .maybeSingle();
      if (lookupError) return { error: lookupError };

      // Paso 1: crear el padre nuevo (mismo activo/orden que el viejo,
      // para que no "salte" de posición en las pestañas del catálogo
      // por el simple hecho de haberse renombrado).
      const { error: insertError } = await supabase.from("categorias").insert([
        {
          nombre: nombreNuevo,
          activo: catViejaRow?.activo ?? true,
          orden: catViejaRow?.orden ?? Date.now(),
        },
      ]);
      if (insertError) return { error: insertError };

      // Paso 2: migrar los productos hijos al nombre nuevo.
      const { error: updateError } = await supabase
        .from("productos")
        .update({ categoria: nombreNuevo })
        .eq("categoria", categoriaActual);
      if (updateError) {
        // Deshace el paso 1 — no dejar un padre nuevo sin productos
        // por una migración que no se completó.
        await supabase.from("categorias").delete().eq("nombre", nombreNuevo);
        return { error: updateError };
      }

      // Paso 3: eliminar el padre viejo, ya sin productos que lo
      // referencien. Con .select() encima para poder distinguir "se
      // borró de verdad" de "RLS lo dejó pasar sin error pero afectó 0
      // filas" (fantasma). A diferencia de antes: si este paso 3 no
      // afecta filas (RLS bloqueando en silencio, o la fila ya no
      // estaba), YA NO se reporta como error duro — los pasos 1 y 2
      // (lo que realmente importa: los productos migrados al nombre
      // nuevo) sí funcionaron, así que el rename se considera exitoso
      // y se le avisa al llamador (ghostCategoria) para que oculte
      // "categoriaActual" del lado del cliente aunque siga viva en la
      // base. Solo un choque real de FK (23503 — algo sigue
      // referenciándola) se sigue tratando como error duro.
      const { data: deletedRows, error: deleteError } = await supabase
        .from("categorias")
        .delete()
        .eq("nombre", categoriaActual)
        .select("id");

      if (deleteError) {
        console.error("No se pudo borrar la categoría vieja tras migrar los productos:", deleteError);
        if (deleteError.code === "23503") {
          return {
            error: new Error(
              `Los productos ya se migraron a "${nombreNuevo}", pero "${categoriaActual}" todavía tiene algo vinculado y no se pudo borrar.`
            ),
            fkConflict: true,
            ghostCategoria: null,
          };
        }
        await refetchCatalog();
        return { error: null, fkConflict: false, ghostCategoria: categoriaActual };
      }

      if (!deletedRows || deletedRows.length === 0) {
        await refetchCatalog();
        return { error: null, fkConflict: false, ghostCategoria: categoriaActual };
      }

      // Refresca sections/productsById/stock desde Supabase — es el
      // "setCategorias/setProductos" de este proyecto (viven dentro
      // del hook useCatalog, no como estado suelto en App.jsx), así
      // que las pestañas del catálogo reflejan el nombre nuevo sin
      // recargar la página.
      await refetchCatalog();
      return { error: null, fkConflict: false, ghostCategoria: null };
    } catch (err) {
      console.error("Error renombrando categoría:", err);
      return { error: err };
    }
  };

  const renombrarSubgrupo = async (categoriaLabel, subgrupoActual, nombreNuevoRaw) => {
    const nombreNuevo = (nombreNuevoRaw || "").trim();
    if (!nombreNuevo || nombreNuevo === subgrupoActual) return { error: null };
    try {
      const { data, error } = await supabase
        .from("productos")
        .update({ subgrupo: nombreNuevo })
        .eq("categoria", categoriaLabel)
        .eq("subgrupo", subgrupoActual)
        .select("id");
      if (error) return { error };
      if (!data || data.length === 0) {
        // Nadie se actualizó — o ya no había productos con ese
        // subgrupo, o RLS bloqueó el UPDATE en silencio. No es un
        // conflicto de datos real (no hay FK acá), así que no se
        // reporta como error duro: se avisa al llamador para que
        // oculte "subgrupoActual" del lado del cliente.
        return { error: null, ghostSubgrupo: subgrupoActual };
      }
      await refetchCatalog();
      return { error: null, ghostSubgrupo: null };
    } catch (err) {
      console.error("Error renombrando subgrupo:", err);
      return { error: err };
    }
  };

  /* ---- eliminar Categoría (botón de papelera junto al lápiz): DELETE
     directo en 'categorias'. Si todavía tiene productos apuntándole,
     'productos_categoria_fkey' lo rechaza con foreign_key_violation
     (23503) — se detecta para poder mostrar el mensaje específico que
     pide el negocio en vez de un error genérico de Supabase.
     Si en cambio no afecta ninguna fila (RLS bloqueando en silencio,
     o la categoría ya no existía), NO se trata como error: se asume
     que ya no está en la base y se le avisa al llamador (zeroRows)
     para que la oculte del lado del cliente igual, sin depender de que
     el backend coopere. ---- */
  const eliminarCategoria = async (categoriaLabel) => {
    try {
      const { data, error } = await supabase
        .from("categorias")
        .delete()
        .eq("nombre", categoriaLabel)
        .select("id");
      if (error) {
        return { error, fkConflict: error.code === "23503", zeroRows: false };
      }
      if (!data || data.length === 0) {
        return { error: null, fkConflict: false, zeroRows: true };
      }
      await refetchCatalog();
      return { error: null, fkConflict: false, zeroRows: false };
    } catch (err) {
      console.error("Error eliminando categoría:", err);
      return { error: err, fkConflict: false, zeroRows: false };
    }
  };

  /* ---- eliminar Subgrupo: a diferencia de Categoría, 'subgrupo' no
     tiene tabla maestra propia (es un string libre en cada fila de
     'productos', sin FK) — así que no hay una fila que borrar. "Borrar
     el subgrupo" acá significa soltarlo de todos los productos que lo
     tienen (subgrupo -> null), que pasan a verse como "Sin subgrupo"
     dentro de la misma categoría, SIN borrar ningún producto. ---- */
  const eliminarSubgrupo = async (categoriaLabel, subgrupoActual) => {
    try {
      const { data, error } = await supabase
        .from("productos")
        .update({ subgrupo: null })
        .eq("categoria", categoriaLabel)
        .eq("subgrupo", subgrupoActual)
        .select("id");
      if (error) return { error };
      if (!data || data.length === 0) {
        return { error: null, zeroRows: true };
      }
      await refetchCatalog();
      return { error: null, zeroRows: false };
    } catch (err) {
      console.error("Error eliminando subgrupo:", err);
      return { error: err };
    }
  };

  /* ---- alta directa de una categoría vacía desde "Visibilidad en
     catálogo público" — a diferencia de crearProducto() (que crea la
     categoría solo como efecto secundario de dar de alta un producto),
     acá el usuario solo quiere la fila nueva en 'categorias' para que
     aparezca de inmediato como sección propia, sin ningún producto
     todavía. Los subgrupos siguen sin tabla maestra propia y se siguen
     creando solo al escribir uno nuevo en el formulario de producto. ---- */
  const crearCategoria = async (nombreRaw) => {
    const nombre = (nombreRaw || "").trim();
    if (!nombre) return { error: new Error("Ingresa un nombre para la categoría.") };
    try {
      const { error } = await supabase
        .from("categorias")
        .insert([{ nombre, activo: true, orden: safeOrdenValue() }]);
      if (error) return { error };
      await refetchCatalog();
      return { error: null };
    } catch (err) {
      console.error("Error creando categoría:", err);
      return { error: err };
    }
  };

  /* ---- + Añadir Variante (Visibilidad en Catálogo y Agregar
     Unidades): alta rápida de un producto "hermano" del de referencia
     — mismo NOMBRE BASE, categoría, subgrupo y precio base, pero con
     su PROPIA clave de stock (una variante de color/sabor es
     mercadería físicamente distinta, no debe compartir inventario con
     la original). Reusa crearProducto(), la misma función del alta al
     escanear un código no encontrado — acá solo cambia de dónde salen
     nombreBase/categoría/precio (de un producto existente, no de un
     formulario en blanco). 'productoBase.baseName' (no '.name') es la
     fuente correcta: si productoBase YA es en sí mismo una variante
     (ej. se pidió "+ variante" desde una fila que es "Hey FIT - Fresa"),
     igual hereda el mismo nombre_base compartido, no el nombre
     completo con el sabor viejo pegado. ---- */
  const agregarVariante = async (productoBase, categoriaLabel, subgrupoRaw, { variante, presentacion, color }) => {
    try {
      await crearProducto({
        nombreBase: productoBase.baseName || productoBase.name,
        variante,
        presentacion,
        color,
        precio: productoBase.price,
        categoria: categoriaLabel,
        subgrupo: subgrupoRaw,
        stockExistente: stock,
      });
      await refetchCatalog();
      return { error: null };
    } catch (err) {
      console.error("Error creando variante:", err);
      return { error: err };
    }
  };

  /* ---- "+ Nueva variedad" en Agregar Unidades al Stock: mismo
     agregarVariante() de arriba, pero disparado desde el buscador de
     ingreso de mercadería en vez de Visibilidad — 'referenceItem' es
     cualquier variante ya existente de esa base (para heredar
     categoría/subgrupo/precio). ---- */
  const saveNuevaVariedad = async (referenceItem) => {
    const sabor = nuevaVariedadSabor.trim();
    if (!sabor) {
      setNuevaVariedadError("Escribe el sabor o variedad nueva.");
      return;
    }
    setNuevaVariedadSaving(true);
    setNuevaVariedadError("");
    const { error } = await agregarVariante(
      referenceItem,
      referenceItem.sectionLabel,
      referenceItem.subgrupoRaw,
      { variante: sabor, presentacion: nuevaVariedadPresentacion, color: nuevaVariedadColor }
    );
    setNuevaVariedadSaving(false);
    if (error) {
      setNuevaVariedadError(error.message ? `No se pudo crear: ${error.message}` : "No se pudo crear la variedad.");
      return;
    }
    resetNuevaVariedadForm();
  };

  /* ---- "+ Nuevo Combo": arma un producto sin stock propio a partir de
     N ingredientes ya existentes (productos o variantes puntuales) más
     la cantidad de cada uno — ver crearCombo() en productLookup.js. La
     disponibilidad y el descuento de stock al vender salen gratis:
     'consumos' del combo ya queda aplanado a claves de stock reales,
     así que availabilityFor()/la resta de stock al confirmar una venta
     lo tratan exactamente igual que cualquier producto normal. ---- */
  const resetComboForm = () => {
    setComboNombre("");
    setComboCategoria("Combos");
    setComboSubgrupo("");
    setComboPrecio("");
    setComboItems([]);
    setComboSearchTerm("");
    setComboError("");
  };

  const openComboModal = () => {
    resetComboForm();
    setComboModalOpen(true);
  };

  const addComboItem = (product) => {
    setComboItems((prev) =>
      prev.some((it) => it.productId === product.id)
        ? prev
        : [...prev, { productId: product.id, name: product.name, qty: 1 }]
    );
    setComboSearchTerm("");
  };

  const removeComboItem = (productId) => {
    setComboItems((prev) => prev.filter((it) => it.productId !== productId));
  };

  const setComboItemQty = (productId, qty) => {
    setComboItems((prev) => prev.map((it) => (it.productId === productId ? { ...it, qty } : it)));
  };

  const saveCombo = async () => {
    const nombre = comboNombre.trim();
    const categoria = comboCategoria.trim();
    const precio = parseFloat(comboPrecio);

    if (!nombre) {
      setComboError("Ponle un nombre al combo.");
      return;
    }
    if (!categoria) {
      setComboError("Elige o escribe una categoría.");
      return;
    }
    if (isNaN(precio) || precio <= 0) {
      setComboError("Ingresa un precio de venta válido.");
      return;
    }
    if (comboItems.length === 0) {
      setComboError("Agrega al menos un producto al combo.");
      return;
    }
    if (comboItems.some((it) => !(Number(it.qty) > 0))) {
      setComboError("Todas las cantidades deben ser mayores a 0.");
      return;
    }

    setComboSaving(true);
    setComboError("");

    try {
      const items = comboItems.map((it) => ({
        productId: it.productId,
        qty: Number(it.qty),
        consumes: productsById[it.productId]?.consumes || [],
      }));
      await crearCombo({ nombre, categoria, subgrupo: comboSubgrupo, precio, items });
      await refetchCatalog();
      setComboModalOpen(false);
      resetComboForm();
    } catch (err) {
      console.error("Error creando combo:", err);
      setComboError(err.message ? `No se pudo crear el combo: ${err.message}` : "No se pudo crear el combo.");
    } finally {
      setComboSaving(false);
    }
  };

  /* ---- Módulo de Imágenes (solo admin) ---- */
  const discardAiPreview = () => {
    if (aiPreviewUrl) URL.revokeObjectURL(aiPreviewUrl);
    setAiPreviewBlob(null);
    setAiPreviewUrl("");
    setAiError("");
  };

  const openImageManager = (product) => {
    setImageManagerProduct(product);
    setImageUploadError("");
    setLastUploadedImage(null);
    setAiError("");
    discardAiPreview();
  };

  const closeImageManager = () => {
    setImageManagerProduct(null);
    setImageUploadError("");
    setLastUploadedImage(null);
    discardAiPreview();
  };

  // 'forcedExt'/'forcedType' existen porque el resultado de la IA es un
  // Blob puro (sin '.name', a diferencia de un File elegido en el
  // input) — sin esto, 'file.name.split(".")' explotaría al guardar el
  // recorte con fondo removido.
  const uploadProductImage = async (file, forcedExt, forcedType) => {
    if (!imageManagerProduct || !file) return;
    setImageUploading(true);
    setImageUploadError("");
    try {
      const ext = forcedExt || (file.name ? (file.name.split(".").pop() || "jpg").toLowerCase() : "jpg");
      const fileName = `${imageManagerProduct.id}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("productos-imagenes")
        .upload(fileName, file, {
          contentType: forcedType || file.type || "image/jpeg",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("productos-imagenes").getPublicUrl(fileName);
      const url = data?.publicUrl;
      if (!url) throw new Error("No se pudo obtener la URL pública de la imagen.");

      const { error: updateError } = await supabase
        .from("productos")
        .update({ imagen_url: url })
        .eq("id", imageManagerProduct.id);
      if (updateError) throw updateError;

      await refetchCatalog();
      // Refleja la nueva foto al toque en el modal ya abierto, sin
      // esperar a que 'productsById' se reconstruya del refetch.
      setImageManagerProduct((prev) => (prev ? { ...prev, imagenUrl: url } : prev));
    } catch (err) {
      console.error("Error subiendo imagen del producto:", err);
      // "Bucket not found" es un error de CONFIGURACIÓN del backend
      // (falta crear 'productos-imagenes' en Supabase Storage — ver
      // migración 0035), no un bug del código: se distingue para no
      // hacerle pensar al admin que algo se rompió, sino que falta un
      // paso de setup puntual.
      const rawMessage = err?.message || String(err || "");
      const isBucketMissing = /bucket not found/i.test(rawMessage);
      setImageUploadError(
        isBucketMissing
          ? "No se pudo subir la imagen: el bucket de almacenamiento \"productos-imagenes\" todavía no existe en Supabase. Créalo en Storage → New bucket (público) o corre la migración 0035_producto_imagenes.sql — ver instrucciones del equipo."
          : rawMessage
            ? `No se pudo subir la imagen: ${rawMessage}`
            : "No se pudo subir la imagen. Intenta de nuevo."
      );
    } finally {
      setImageUploading(false);
    }
  };

  const handleUploadFromInput = (file) => {
    if (!file) return;
    setLastUploadedImage(file);
    discardAiPreview();
    uploadProductImage(file);
  };

  /* ---- "Mejorar con IA": quita el fondo 100% en el navegador del
     admin con @imgly/background-removal (import dinámico — el modelo
     ONNX/WASM pesa varios MB y NO tiene sentido bajarlo para Cliente o
     Cajero, que nunca ven este botón). Fuente: la foto recién elegida
     en esta sesión del modal si existe, si no se descarga la ya
     guardada ('imagen_url') para poder reprocesar una foto vieja.
     Nunca pisa nada solo — deja el resultado en 'aiPreviewBlob' para
     que el admin decida "Guardar recorte" o "Descartar". ---- */
  const handleAiEnhance = async () => {
    if (!imageManagerProduct) return;
    setAiProcessing(true);
    setAiError("");
    try {
      let source = lastUploadedImage;
      if (!source) {
        if (!imageManagerProduct.imagenUrl) {
          throw new Error("Primero sube o toma una foto para poder mejorarla.");
        }
        const res = await fetch(imageManagerProduct.imagenUrl);
        if (!res.ok) throw new Error("No se pudo cargar la imagen actual para procesarla.");
        source = await res.blob();
      }

      const { removeBackground } = await import("@imgly/background-removal");
      const resultBlob = await removeBackground(source);

      setAiPreviewBlob(resultBlob);
      setAiPreviewUrl(URL.createObjectURL(resultBlob));
    } catch (err) {
      console.error("Error quitando el fondo con IA:", err);
      setAiError(
        err.message
          ? `No se pudo procesar la imagen: ${err.message}`
          : "No se pudo procesar la imagen con IA."
      );
    } finally {
      setAiProcessing(false);
    }
  };

  const confirmAiResult = async () => {
    if (!aiPreviewBlob) return;
    await uploadProductImage(aiPreviewBlob, "png", "image/png");
    discardAiPreview();
  };

  /* ---- guardar unidades extra: UPDATE/upsert a 'stock' ---- */
  const saveStockEdits = async () => {
    const additions = Object.keys(stockEdits).filter(
      (k) => stockEdits[k] && parseInt(stockEdits[k], 10) > 0
    );
    if (additions.length === 0) {
      setStockSavedMsg("Ingresa al menos una cantidad para agregar.");
      return;
    }

    // El costo TOTAL de la compra es obligatorio para cada clave con
    // unidades cargadas — sin él no hay forma de calcular el Costo
    // Promedio Ponderado, y guardar cantidad sin costo dejaría el
    // costo de esa clave desactualizado en silencio.
    const sinCosto = additions.filter((k) => {
      const c = parseFloat(stockCostEdits[k]);
      return stockCostEdits[k] === undefined || stockCostEdits[k] === "" || isNaN(c) || c < 0;
    });
    if (sinCosto.length > 0) {
      setStockSavedMsg(
        `Ingresa el costo TOTAL de la compra para: ${sinCosto
          .map((k) => stockLabels[k] ?? k)
          .join(", ")}.`
      );
      return;
    }

    setSavingStock(true);

    const newStock = { ...stock };
    const newStockCostos = { ...stockCostos };
    const newStockUltimoCosto = { ...stockUltimoCosto };
    additions.forEach((key) => {
      const unidadesIngresan = parseInt(stockEdits[key], 10);
      const costoTotalCompra = parseFloat(stockCostEdits[key]);
      newStock[key] = (newStock[key] ?? 0) + unidadesIngresan;
      newStockCostos[key] = calcularCostoPromedioPonderado({
        stockActual: stock[key] ?? 0,
        costoActualUnitario: stockCostos[key],
        unidadesIngresan,
        costoTotalCompra,
      });
      // 'último costo' NO se promedia — se SOBRESCRIBE con el costo
      // unitario de este lote específico (a diferencia de
      // precio_costo, que sí acumula).
      newStockUltimoCosto[key] = costoTotalCompra / unidadesIngresan;
    });

    // 'etiqueta' va siempre incluida (no solo cantidad/precio_costo):
    // si esta clave todavía no tiene fila propia en 'stock' (ej. una
    // key referenciada por 'consumos' que useCatalog solo mostraba en
    // 0 localmente, sin fila real en la base — ver el warning en
    // useCatalog.js), el upsert hace un INSERT nuevo ahí mismo, y sin
    // 'etiqueta' esa fila nueva podría chocar con un NOT NULL en
    // Supabase. Para una fila que YA existe, esto solo la reescribe
    // con el mismo valor que ya tenía (stockLabels[key] se cargó
    // originalmente desde esa misma columna) — no rompe nada.
    const stockUpdates = additions.map((key) => ({
      nombre: key,
      cantidad: newStock[key],
      precio_costo: newStockCostos[key],
      ultimo_costo_compra: newStockUltimoCosto[key],
      etiqueta: stockLabels[key] ?? key,
    }));

    const { error } = await supabase
      .from("stock")
      .upsert(stockUpdates, { onConflict: "nombre" });

    setSavingStock(false);

    if (error) {
      // Log completo (message/details/hint/code) — los errores de
      // PostgREST traen la razón real acá (ej. columna inexistente si
      // falta correr la migración de 'precio_costo', o violación de
      // constraint), y el mensaje de la UI ahora la muestra también
      // para no depender de abrir la consola del navegador.
      console.error("Error al actualizar stock en Supabase:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        error,
      });
      setStockSavedMsg(
        error.message
          ? `No se pudo actualizar el stock: ${error.message}`
          : "No se pudo actualizar el stock en Supabase."
      );
      return;
    }

    setStock(newStock);
    setStockCostos(newStockCostos);
    setStockUltimoCosto(newStockUltimoCosto);
    setStockEdits({});
    setStockCostEdits({});
    setStockSavedMsg("Stock actualizado correctamente.");
  };

  /* ---- menú global "Métodos de Pago" (header): ahora es solo lectura,
     los comprobantes nacen del checkout ---- */
  const openMethodModal = (method) => {
    setActiveMethodModal(method);
    setPaymentMenuOpen(false);
    setExpandedEntryId(null);
  };

  const closeMethodModal = () => {
    setActiveMethodModal(null);
    setExpandedEntryId(null);
  };

  const toggleEntryRow = (comprobanteId) => {
    setExpandedEntryId((prev) => (prev === comprobanteId ? null : comprobanteId));
  };

  /* ---- formulario de escaneo (checkout / cobro de fiado) ---- */
  const resetEntryForm = () => {
    setModalView("manual");
    setManualAmount("");
    setMontoRecibido("");
    setScanDetected({ method: "", opId: "", photoUrl: "" });
    setScanError("");
    setPhotoUploading(false);
    setPhotoUploadError("");
  };

  const handleManualAmountChange = (value) => {
    if (value === "" || /^\d*\.?\d{0,2}$/.test(value)) {
      setManualAmount(value);
    }
  };

  const handleMontoRecibidoChange = (value) => {
    if (value === "" || /^\d*\.?\d{0,2}$/.test(value)) {
      setMontoRecibido(value);
    }
  };

  /* ---- escaneo de comprobante con cámara + Tesseract.js OCR ---- */
  const startCamera = async () => {
    setScanError("");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // Navegador sin soporte para getUserMedia (o contexto no seguro):
      // usamos directamente el input de archivo con captura nativa.
      setCameraSupported(false);
      setModalView("manual");
      if (fileInputRef.current) fileInputRef.current.click();
      return;
    }

    setModalView("camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setCameraSupported(true);
      // El <video> se monta en este mismo render; conectamos el stream
      // apenas esté disponible la referencia.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });
    } catch (err) {
      console.error("No se pudo acceder a la cámara:", err);
      setCameraSupported(false);
      setModalView("manual");
      // Fallback: input de archivo con captura de cámara nativa (móvil)
      if (fileInputRef.current) fileInputRef.current.click();
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  /* ---- sube la foto del comprobante a Supabase Storage (bucket
     'comprobantes-fotos') y devuelve la URL pública. No bloquea el
     registro del pago si falla: solo se pierde la foto, no los datos.
     Devuelve también el error crudo de Supabase para poder mostrarlo
     (ej. "bucket not found" si falta correr el SQL de la Fase 2, o un
     error de policy si falta la política de INSERT para 'anon'). ---- */
  const uploadReceiptImage = async (blob, method) => {
    const fileName = `${method}-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("comprobantes-fotos")
      .upload(fileName, blob, { contentType: "image/jpeg", upsert: false });

    if (uploadError) {
      console.error("Error al subir la foto del comprobante:", uploadError);
      return { url: null, error: uploadError.message || String(uploadError) };
    }

    const { data } = supabase.storage.from("comprobantes-fotos").getPublicUrl(fileName);
    return { url: data?.publicUrl || null, error: null };
  };

  /* ---- procesa la imagen capturada (cámara o archivo): OCR con
     Tesseract.js para extraer método/ID/monto, y en paralelo sube la
     foto a Storage. El monto detectado se autocompleta en el campo
     de "Monto (S/)" ya existente para que el usuario solo lo revise. ---- */
  const processReceiptImage = async (blob) => {
    setModalView("processing");
    setPhotoUploading(true);
    setPhotoUploadError("");
    try {
      const [ocrResult, uploadResult] = await Promise.all([
        (async () => {
          const worker = await createWorker("spa");
          const {
            data: { text },
          } = await worker.recognize(blob);
          await worker.terminate();
          return detectPaymentInfo(text);
        })(),
        uploadReceiptImage(blob, activeMethodModal || checkoutMetodo || "OTROS").catch((e) => ({
          url: null,
          error: e?.message || String(e),
        })),
      ]);

      const { method, opId, amount } = ocrResult;
      setScanDetected({ method, opId: opId || "", photoUrl: uploadResult.url || "" });
      if (uploadResult.error) setPhotoUploadError(uploadResult.error);
      if (amount) {
        setManualAmount(amount);
      }
      setModalView("review");
    } catch (err) {
      console.error("Error al procesar OCR:", err);
      setScanError(
        "No se pudo leer el comprobante. Intenta escanear de nuevo o ingresa los datos manualmente."
      );
      setModalView("manual");
    } finally {
      setPhotoUploading(false);
    }
  };

  const captureFromCamera = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 1280;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    stopCamera();
    canvas.toBlob(
      (blob) => {
        if (blob) processReceiptImage(blob);
      },
      "image/jpeg",
      0.85
    );
  };

  const handleFileCapture = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    processReceiptImage(file);
    e.target.value = "";
  };

  /* ---- módulo de Libreta (Fiados) ---- */
  const resetClienteForm = () => {
    setAddClienteOpen(false);
    setNewClienteName("");
    setNewClienteWhatsapp("");
    setNewClientePin("");
    setClienteError("");
  };

  const resetCobroForm = () => {
    stopCamera();
    setCobroFormFor(null);
    setCobroMonto("");
    setCobroMetodo("");
    setCobroError("");
    setScanDetected({ method: "", opId: "", photoUrl: "" });
    setScanError("");
    setModalView("manual");
  };

  const closeLibreta = () => {
    setLibretaOpen(false);
    setSelectedClienteId(null);
    resetClienteForm();
    resetCobroForm();
  };

  const toggleCliente = (clienteId) => {
    setSelectedClienteId((prev) => (prev === clienteId ? null : clienteId));
    resetCobroForm();
  };

  /* ---- eliminar cliente + su historial de fiado (Libreta): borra
     primero las tablas hijas (fiado_items, movimientos_fiado) — que
     tienen FK a clientes_fiado.id — y recién al final la fila del
     cliente, en ese orden, para no chocar con la FK. Nota: esto NO
     borra su cuenta de Supabase Auth (auth_user_id) — un cliente
     eliminado acá simplemente deja de poder loguearse a ver un fiado
     que ya no existe, pero su acceso no queda revocado explícitamente;
     revocarlo requeriría otra Edge Function con service_role. ---- */
  const eliminarClienteFiado = async (cliente) => {
    if (
      !window.confirm(
        `¿Estás seguro de eliminar el registro de "${cliente.nombre}"? Esto borra también todo su historial de fiados y pagos.`
      )
    ) {
      return;
    }

    try {
      const { error: itemsError } = await supabase
        .from("fiado_items")
        .delete()
        .eq("cliente_id", cliente.id);
      if (itemsError) {
        console.error("Error eliminando fiado_items del cliente:", itemsError);
        alert("No se pudo eliminar el historial de deuda de este cliente.");
        return;
      }

      const { error: movError } = await supabase
        .from("movimientos_fiado")
        .delete()
        .eq("cliente_id", cliente.id);
      if (movError) {
        console.error("Error eliminando movimientos_fiado del cliente:", movError);
        alert("No se pudo eliminar el historial de pagos de este cliente.");
        return;
      }

      const { error: clienteError } = await supabase
        .from("clientes_fiado")
        .delete()
        .eq("id", cliente.id);
      if (clienteError) {
        console.error("Error eliminando cliente:", clienteError);
        alert("No se pudo eliminar el cliente.");
        return;
      }

      setClientes((prev) => prev.filter((c) => c.id !== cliente.id));
      setFiadoItems((prev) => prev.filter((it) => it.clienteId !== cliente.id));
      setMovimientos((prev) => prev.filter((m) => m.clienteId !== cliente.id));
      if (selectedClienteId === cliente.id) setSelectedClienteId(null);
      if (checkoutFiadoClienteId === cliente.id) setCheckoutFiadoClienteId(null);
    } catch (err) {
      console.error("Error eliminando cliente:", err);
      alert("No se pudo eliminar el cliente. Intenta de nuevo.");
    }
  };

  const handleCobroMontoChange = (value) => {
    if (value === "" || /^\d*\.?\d{0,2}$/.test(value)) {
      setCobroMonto(value);
    }
  };

  /* ---- guardar nuevo cliente: crea su cuenta real de Supabase Auth
     (celular+PIN, vía dummy email) y su fila en 'clientes_fiado' a
     través de la Edge Function create-cliente (usa service_role del
     lado del servidor; la sesión del admin en este navegador no se
     toca). El celular ahora es obligatorio: es el identificador de
     login del cliente, ya no un dato opcional. ---- */
  const saveCliente = async () => {
    const nombre = newClienteName.trim();
    const celular = newClienteWhatsapp.trim();
    const pin = newClientePin.trim();

    if (!nombre) {
      setClienteError("Ingresa el nombre del cliente.");
      return;
    }
    if (!/^\d{6,15}$/.test(celular)) {
      setClienteError("Ingresa un celular válido (solo números).");
      return;
    }
    if (!/^\d{4,10}$/.test(pin)) {
      setClienteError("El PIN debe tener entre 4 y 10 dígitos.");
      return;
    }

    setClienteSaving(true);
    setClienteError("");

    const { data, error } = await supabase.functions.invoke("create-cliente", {
      body: { nombre, celular, pin },
    });

    setClienteSaving(false);

    if (error) {
      console.error("Error al crear cliente vía Edge Function:", error);
      const body = await error.context?.json?.().catch(() => null);
      setClienteError(body?.error || "No se pudo crear el cliente. Intenta de nuevo.");
      return;
    }

    const newCliente = {
      id: data.id,
      nombre: data.nombre,
      whatsapp: data.whatsapp,
      timestamp: Number(data.fecha),
    };

    setClientes((prev) => [newCliente, ...prev]);
    resetClienteForm();
  };

  /* ---- cobrar fiado (Restar Crédito / Cancelar Cuenta): descuenta el
     monto de los fiado_items del cliente de forma LIFO (el registro
     más reciente se cancela primero), y guarda el cobro en
     'movimientos_fiado'. "Cancelar Cuenta" exige que el monto sea
     EXACTAMENTE igual al saldo total del cliente. ---- */
  const cobrarFiado = async () => {
    if (!cobroFormFor) return;
    const { clienteId, tipo } = cobroFormFor;
    const amountNum = parseFloat(cobroMonto);
    if (!cobroMonto || isNaN(amountNum) || amountNum <= 0) {
      setCobroError("Ingresa un monto válido en Soles.");
      return;
    }
    if (cobroMetodo !== "EFECTIVO" && cobroMetodo !== "DIGITAL") {
      setCobroError("Elige si el cobro fue en Efectivo o Digital (Yape/Plin/Otros).");
      return;
    }
    // Repetido acá (además del disabled del botón) porque este es el
    // guardado real: un cobro Digital sin comprobante adjunto no se
    // puede confirmar.
    if (cobroMetodo === "DIGITAL" && !scanDetected.photoUrl) {
      setCobroError("Adjunta el comprobante antes de confirmar un cobro Digital.");
      return;
    }

    const saldoCliente = clienteSaldos[clienteId]?.saldo ?? 0;

    // Regla estricta por tipo (validada también en vivo en el input,
    // pero se repite acá porque este es el guardado real): "Cancelar
    // Cuenta" exige el monto EXACTO de la deuda; "Restar Crédito"
    // (abono parcial) exige un monto ESTRICTAMENTE menor a la deuda —
    // igual o mayor debería haberse hecho como "Cancelar Cuenta".
    if (tipo === "CANCELAR") {
      if (Math.abs(amountNum - saldoCliente) > 0.009) {
        setCobroError(
          `Para cancelar la cuenta, el monto debe ser exactamente ${formatSoles(saldoCliente)}.`
        );
        return;
      }
    } else if (saldoCliente - amountNum <= 0.009) {
      setCobroError(
        `El abono debe ser menor a la deuda total (${formatSoles(
          saldoCliente
        )}). Para pagar todo, usa "Cancelar Cuenta".`
      );
      return;
    }

    setCobroSaving(true);
    setCobroError("");

    // Descuento LIFO: los fiado_items más recientes se cancelan primero.
    const itemsDelCliente = (clienteSaldos[clienteId]?.items || [])
      .filter((fi) => fi.saldoRestante > 0)
      .sort((a, b) => b.timestamp - a.timestamp);

    let restante = amountNum;
    const updates = [];
    for (const item of itemsDelCliente) {
      if (restante <= 0.009) break;
      const descuento = Math.min(item.saldoRestante, restante);
      updates.push({ id: item.id, nuevoSaldo: Math.max(0, item.saldoRestante - descuento) });
      restante -= descuento;
    }

    try {
      for (const u of updates) {
        const { error: updError } = await supabase
          .from("fiado_items")
          .update({ saldo_restante: u.nuevoSaldo })
          .eq("id", u.id);
        if (updError) throw updError;
      }

      const timestamp = Date.now();
      const { data: inserted, error: movError2 } = await supabase
        .from("movimientos_fiado")
        .insert([
          {
            cliente_id: clienteId,
            tipo: "PAGO",
            monto: amountNum,
            descripcion: tipo === "CANCELAR" ? "Cancelar cuenta" : "Restar crédito",
            foto_url: scanDetected.photoUrl || null,
            metodo_pago: cobroMetodo,
            fecha: timestamp,
          },
        ])
        .select();

      if (movError2) throw movError2;

      const row = inserted && inserted[0];
      const newMov = {
        id: row?.id ?? `mov-${timestamp}`,
        clienteId,
        tipo: "PAGO",
        monto: amountNum,
        descripcion: tipo === "CANCELAR" ? "Cancelar cuenta" : "Restar crédito",
        fotoUrl: scanDetected.photoUrl || null,
        metodoPago: cobroMetodo,
        timestamp: Number(row?.fecha ?? timestamp),
      };

      setFiadoItems((prev) =>
        prev.map((fi) => {
          const u = updates.find((x) => x.id === fi.id);
          return u ? { ...fi, saldoRestante: u.nuevoSaldo } : fi;
        })
      );
      setMovimientos((prev) => [newMov, ...prev]);
      setCobroSaving(false);
      resetCobroForm();
    } catch (err) {
      console.error("Error al registrar el cobro de fiado:", err);
      setCobroSaving(false);
      setCobroError("No se pudo guardar en Supabase. Intenta de nuevo.");
    }
  };

  /* ---- abre en una pestaña nueva el comprobante que subió el cliente
     (bucket privado: hace falta una signed URL, no hay URL pública) ---- */
  const verComprobante = async (pago) => {
    setPagosPendientesError("");
    const { data, error } = await supabase.storage
      .from("comprobantes")
      .createSignedUrl(pago.urlComprobante, 60);

    if (error || !data?.signedUrl) {
      console.error("Error al generar la URL del comprobante:", error);
      setPagosPendientesError("No se pudo abrir el comprobante.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  /* ---- aprobar/rechazar un pago pendiente subido por un cliente. Al
     aprobar, recién ahí se aplica el MISMO descuento LIFO que
     cobrarFiado (así entra también a "Recaudado hoy", que ya lee de
     'movimientos'); rechazar solo cierra el pago sin tocar la deuda. ---- */
  const resolverPagoPendiente = async (pago, decision) => {
    setResolvingPagoId(pago.id);
    setPagosPendientesError("");

    try {
      if (decision === "aprobado") {
        const itemsDelCliente = fiadoItems
          .filter((fi) => fi.clienteId === pago.clienteId && fi.saldoRestante > 0)
          .sort((a, b) => b.timestamp - a.timestamp);

        let restante = pago.monto;
        const updates = [];
        for (const item of itemsDelCliente) {
          if (restante <= 0.009) break;
          const descuento = Math.min(item.saldoRestante, restante);
          updates.push({ id: item.id, nuevoSaldo: Math.max(0, item.saldoRestante - descuento) });
          restante -= descuento;
        }

        for (const u of updates) {
          const { error: updError } = await supabase
            .from("fiado_items")
            .update({ saldo_restante: u.nuevoSaldo })
            .eq("id", u.id);
          if (updError) throw updError;
        }

        const timestamp = Date.now();
        const descripcion =
          (pago.tipo === "cancelar" ? "Cancelar cuenta" : "Restar crédito") +
          " (comprobante aprobado)";
        const { data: inserted, error: movError } = await supabase
          .from("movimientos_fiado")
          .insert([
            {
              cliente_id: pago.clienteId,
              tipo: "PAGO",
              monto: pago.monto,
              descripcion,
              // Siempre DIGITAL: este flujo exige que el cliente adjunte
              // un comprobante con foto (Yape/Plin/transferencia) — no
              // existe un camino de aprobación para pagos en efectivo acá.
              metodo_pago: "DIGITAL",
              fecha: timestamp,
            },
          ])
          .select();
        if (movError) throw movError;

        const row = inserted && inserted[0];
        const newMov = {
          id: row?.id ?? `mov-${timestamp}`,
          clienteId: pago.clienteId,
          tipo: "PAGO",
          monto: pago.monto,
          descripcion,
          fotoUrl: null,
          metodoPago: "DIGITAL",
          timestamp: Number(row?.fecha ?? timestamp),
        };

        setFiadoItems((prev) =>
          prev.map((fi) => {
            const u = updates.find((x) => x.id === fi.id);
            return u ? { ...fi, saldoRestante: u.nuevoSaldo } : fi;
          })
        );
        setMovimientos((prev) => [newMov, ...prev]);
      }

      const { error: resolveError } = await supabase
        .from("pagos_pendientes")
        .update({
          estado: decision,
          resolved_at: new Date().toISOString(),
          resolved_by: session?.user?.id ?? null,
        })
        .eq("id", pago.id);
      if (resolveError) throw resolveError;

      setPagosPendientes((prev) => prev.filter((p) => p.id !== pago.id));
    } catch (err) {
      console.error("Error al resolver el pago pendiente:", err);
      setPagosPendientesError("No se pudo procesar el pago. Intenta de nuevo.");
    } finally {
      setResolvingPagoId(null);
    }
  };

  /* ---- genera un link de WhatsApp con el recordatorio de saldo ---- */
  const buildWhatsappLink = (whatsapp, message) => {
    const numero = toPeruWhatsappNumber(whatsapp);
    if (!numero) return null;
    return `https://wa.me/${numero}?text=${encodeURIComponent(message)}`;
  };

  /* ---- boleta digital: captura el TicketBoleta oculto (ticketRef) con
     html2canvas, copia esa imagen al portapapeles del sistema y abre
     WhatsApp con un mensaje que le indica al cajero que pegue (Ctrl+V)
     la imagen — WhatsApp Web/App no tiene una API pública para adjuntar
     una imagen directamente desde un link wa.me, así que el
     portapapeles es el atajo real para no tener que descargar y volver
     a subir la boleta a mano. ---- */
  const enviarBoletaPorWhatsApp = async () => {
    if (!lastSale) return;
    const numero = toPeruWhatsappNumber(lastSale.whatsapp);
    if (!numero) {
      setBoletaError("Ese número de WhatsApp no es válido.");
      return;
    }
    if (!ticketRef.current) {
      setBoletaError("No se pudo preparar la boleta. Intenta de nuevo.");
      return;
    }

    setBoletaError("");
    setBoletaSending(true);
    try {
      const canvas = await html2canvas(ticketRef.current, { scale: 2, useCORS: true });
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("No se pudo generar la imagen de la boleta.");

      // El portapapeles es la parte más frágil de este flujo (permisos
      // del navegador, contexto no seguro, etc.) — si falla, avisamos
      // puntualmente y NO abrimos WhatsApp: sin nada copiado, el aviso
      // de "presiona Ctrl+V" solo confundiría al cajero.
      try {
        await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
      } catch (clipboardErr) {
        console.error("Error al copiar la boleta al portapapeles:", clipboardErr);
        setBoletaError(
          "No se pudo copiar la imagen al portapapeles (revisa los permisos del navegador para este sitio) — intenta de nuevo."
        );
        return;
      }

      // Mismo texto que el botón "Enviar resumen por WhatsApp" (un solo
      // formato de mensaje, sin mención a la empresa ni emojis, ya
      // definido en buildSaleWhatsappMessage) — acá además viaja
      // codificado con encodeURIComponent para que espacios/símbolos
      // lleguen bien al link wa.me.
      const texto = buildSaleWhatsappMessage(lastSale);
      window.open(`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`, "_blank");
    } catch (err) {
      console.error("Error generando la boleta para WhatsApp:", err);
      setBoletaError("No se pudo generar la boleta. Intenta de nuevo.");
    } finally {
      setBoletaSending(false);
    }
  };

  /* ---- módulo de Gastos + Proveedores ---- */
  const pad2 = (n) => String(n).padStart(2, "0");

  const openGastoForm = () => {
    const now = new Date();
    setGastoFecha(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`);
    setGastoHora(`${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
    setGastoTipoComprobante("Boleta");
    setGastoNumeroComprobante("");
    setGastoOrigen("CAJA");
    setGastoPagoEfectivo(false);
    setGastoPagoDigital(false);
    setGastoMontoEfectivo("");
    setGastoMontoDigital("");
    setGastoRuc("");
    setGastoRazonSocial("");
    setRucLookupStatus("idle");
    setGastoItems([
      {
        id: `item-${Date.now()}`,
        descripcion: "",
        cantidad: "1",
        costoTotal: "",
        productoId: null,
        stockKey: null,
      },
    ]);
    setGastoError("");
    setGastoFormOpen(true);
  };

  const closeGastoForm = () => {
    setGastoFormOpen(false);
    setGastoPagoEfectivo(false);
    setGastoPagoDigital(false);
    setGastoMontoEfectivo("");
    setGastoMontoDigital("");
    setGastoError("");
  };

  const closeGastosModal = () => {
    setGastosOpen(false);
    setGastoFormOpen(false);
    setGastoError("");
    setGastoStockWarning("");
  };

  /* ---- Ingreso de Mercadería: al escanear un código, busca el
     producto en Supabase y agrega/rellena una fila de ítem con la
     descripción autocompletada — el usuario solo tiene que ingresar
     Cantidad y Costo Unitario. Si el producto consume de una única
     clave de stock, la fila queda "vinculada" (productoId/stockKey) y
     al guardar el gasto ese stock se suma automáticamente; si no se
     pudo determinar una clave única (combo, o sin 'consumos'), la
     fila igual se autocompleta pero NO suma stock — se avisa en la UI. ---- */
  const handleProductScan = async (codigoEscaneado) => {
    setProductScannerOpen(false);
    setProductScanBusy(true);
    setGastoError("");
    try {
      const producto = await buscarProductoPorCodigo(codigoEscaneado);
      if (!producto) {
        setGastoError(
          `No se encontró ningún producto con el código "${codigoEscaneado}". Agrega el ítem manualmente.`
        );
        return;
      }

      const stockKey = resolveStockKey(producto);
      const descripcion =
        producto.nombre + (producto.descripcion ? ` (${producto.descripcion})` : "");

      setGastoItems((prev) => {
        const nuevaFila = {
          id: `item-barcode-${Date.now()}`,
          descripcion,
          cantidad: "1",
          costoTotal: "",
          productoId: producto.id,
          stockKey,
        };
        // Si la última fila está vacía (el caso típico: recién se abrió
        // el formulario), la reutiliza en vez de amontonar filas vacías.
        const last = prev[prev.length - 1];
        const lastIsEmpty = last && !last.descripcion.trim() && !last.costoTotal;
        return lastIsEmpty ? [...prev.slice(0, -1), nuevaFila] : [...prev, nuevaFila];
      });

      if (!stockKey) {
        setGastoError(
          `"${producto.nombre}" se agregó al detalle, pero no se pudo determinar a qué stock sumarle la mercadería (producto sin 'consumos' único) — el gasto se guardará igual, solo no se actualizará el stock de este ítem.`
        );
      }
    } catch (err) {
      console.error("Error buscando producto escaneado:", err);
      setGastoError("Error al buscar el producto en Supabase. Intenta de nuevo.");
    } finally {
      setProductScanBusy(false);
    }
  };

  const addGastoItemRow = () => {
    setGastoItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-${prev.length}`,
        descripcion: "",
        cantidad: "1",
        costoTotal: "",
        productoId: null,
        stockKey: null,
      },
    ]);
  };

  const removeGastoItemRow = (id) => {
    setGastoItems((prev) => (prev.length > 1 ? prev.filter((it) => it.id !== id) : prev));
  };

  const updateGastoItem = (id, field, value) => {
    setGastoItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        // Si el usuario reescribe la descripción de una fila que vino
        // de un escaneo o de elegir una sugerencia de 'stock', el
        // vínculo ya no es confiable — se suelta para no sumarle stock
        // al producto equivocado. (resolveGastoItemStockKey igual lo
        // re-vincula al guardar si el texto final vuelve a matchear
        // exacto con algo de 'stock'.)
        if (field === "descripcion" && (it.productoId || it.stockKey)) {
          return { ...it, descripcion: value, productoId: null, stockKey: null };
        }
        return { ...it, [field]: value };
      })
    );
  };

  // El total general = suma de los Costos Totales de cada ítem — ya no
  // hace falta multiplicar por cantidad, 'costoTotal' YA es el monto
  // completo pagado por ese ítem (no un precio unitario).
  const gastoItemsTotal = gastoItems.reduce((sum, it) => sum + (parseFloat(it.costoTotal) || 0), 0);

  // Mixto = ambos métodos prendidos a la vez. Con solo uno prendido se
  // comporta como antes (EFECTIVO o DIGITAL exclusivo).
  const gastoEsMixto = gastoPagoEfectivo && gastoPagoDigital;
  const gastoMontoEfectivoNum = parseFloat(gastoMontoEfectivo) || 0;
  const gastoMontoDigitalNum = parseFloat(gastoMontoDigital) || 0;
  const gastoMixtoDiferencia = gastoItemsTotal - (gastoMontoEfectivoNum + gastoMontoDigitalNum);

  /* ---- Reporte de Precios y Márgenes (solo admin): cruza 'productos'
     (vía productsById, ya armado por useCatalog) con 'stock' — costo
     promedio ponderado (stockCostos) y último costo ingresado
     (stockUltimoCosto) se derivan de las claves que cada producto
     consume, igual que unitCostFor. Para un combo (varias claves), el
     costo es la suma del costo de sus partes — no existe un "costo
     propio" independiente para un combo. Si alguna clave todavía no
     tiene 'último costo' cargado, esa celda queda vacía (no en 0 —
     0 significaría "gratis", que sería un dato falso, no ausente). ---- */
  const exportReportePreciosXLSX = () => {
    const headers = [
      "Producto",
      "Stock Actual",
      "Costo Promedio (S/)",
      "Último Costo Ingresado (S/)",
      "Precio de Venta (S/)",
      "Ganancia Neta (S/)",
      "Margen (%)",
    ];
    const productos = Object.values(productsById).sort((a, b) => a.name.localeCompare(b.name));
    const filas = [
      headers,
      ...productos.map((p) => {
        const stockActual = availabilityFor(p, stock);
        const costoPromedio = unitCostFor(p, stockCostos);

        let ultimoCosto = null;
        if (Array.isArray(p.consumes) && p.consumes.length > 0) {
          let total = 0;
          let allKnown = true;
          for (const { key, qty } of p.consumes) {
            const u = stockUltimoCosto[key];
            if (u == null) {
              allKnown = false;
              break;
            }
            total += u * qty;
          }
          if (allKnown) ultimoCosto = total;
        }

        const gananciaNeta = p.price - costoPromedio;
        const margen = p.price > 0 ? (gananciaNeta / p.price) * 100 : null;

        return [
          p.detail ? `${p.name} (${p.detail})` : p.name,
          stockActual === Infinity ? "" : stockActual,
          Number(costoPromedio.toFixed(2)),
          ultimoCosto != null ? Number(ultimoCosto.toFixed(2)) : "",
          Number(p.price.toFixed(2)),
          Number(gananciaNeta.toFixed(2)),
          margen != null ? Number(margen.toFixed(1)) : "",
        ];
      }),
    ];

    downloadXLSX(`precios-margenes-${Date.now()}.xlsx`, [
      { nombre: "Precios y Márgenes", filas },
    ]);
  };

  /* ---- guardar gasto: si el RUC es nuevo, primero crea el proveedor
     en la BD; luego INSERT a 'gastos' y a 'gasto_items'. ---- */
  const saveGasto = async () => {
    const validItems = gastoItems.filter(
      (it) =>
        it.descripcion.trim() && parseFloat(it.cantidad) > 0 && parseFloat(it.costoTotal) >= 0
    );
    if (validItems.length === 0) {
      setGastoError("Agrega al menos un ítem con descripción, cantidad y precio.");
      return;
    }

    let metodoPago = null;
    let montoEfectivo = null;
    let montoDigital = null;

    if (gastoOrigen === "CAJA") {
      if (!gastoPagoEfectivo && !gastoPagoDigital) {
        setGastoError("Elige el método de pago del gasto (Efectivo, Digital, o ambos).");
        return;
      }
      if (gastoEsMixto) {
        if (Math.abs(gastoMixtoDiferencia) > 0.01) {
          setGastoError(
            `La suma de Efectivo + Digital (${formatSoles(
              gastoMontoEfectivoNum + gastoMontoDigitalNum
            )}) debe ser igual al Total (${formatSoles(gastoItemsTotal)}).`
          );
          return;
        }
        metodoPago = "MIXTO";
        montoEfectivo = gastoMontoEfectivoNum;
        montoDigital = gastoMontoDigitalNum;
      } else {
        metodoPago = gastoPagoEfectivo ? "EFECTIVO" : "DIGITAL";
      }
    }

    setGastoSaving(true);
    setGastoError("");
    setGastoStockWarning("");

    const ruc = gastoRuc.trim();
    const razonSocial = gastoRazonSocial.trim();
    let proveedorId = null;

    try {
      if (ruc) {
        const existing = proveedores.find((p) => p.ruc === ruc);
        if (existing) {
          proveedorId = existing.id;
        } else if (razonSocial) {
          const { data: insertedProv, error: provError } = await supabase
            .from("proveedores")
            .insert([{ ruc, razon_social: razonSocial }])
            .select();
          if (provError) throw provError;
          const provRow = insertedProv && insertedProv[0];
          proveedorId = provRow?.id ?? null;
          if (provRow) {
            setProveedores((prev) => [...prev, { id: provRow.id, ruc, razonSocial }]);
          }
        }
      }

      const [year, month, day] = gastoFecha.split("-").map(Number);
      const [hour, minute] = gastoHora.split(":").map(Number);
      const timestamp =
        gastoFecha && gastoHora
          ? new Date(year, month - 1, day, hour, minute).getTime()
          : Date.now();

      const total = gastoItemsTotal;

      const { data: insertedGasto, error: gastoErr } = await supabase
        .from("gastos")
        .insert([
          {
            proveedor_id: proveedorId,
            tipo_comprobante: gastoTipoComprobante,
            numero_comprobante: gastoNumeroComprobante.trim() || null,
            origen: gastoOrigen,
            metodo_pago: metodoPago,
            monto_efectivo: montoEfectivo,
            monto_digital: montoDigital,
            total,
            fecha: timestamp,
          },
        ])
        .select();

      if (gastoErr) throw gastoErr;
      const gastoRow = insertedGasto && insertedGasto[0];
      const gastoId = gastoRow?.id;

      // 'gasto_items' sigue guardando precio_unitario/subtotal (así lo
      // lee el resto de la app: historial expandido, CSV) — pero el
      // formulario ya no pide precio unitario, pide el Costo Total del
      // ítem directamente. precio_unitario queda como dato DERIVADO
      // (costoTotal / cantidad) solo para mantener ese esquema; el
      // subtotal es el costoTotal tal cual lo escribió el cajero, sin
      // volver a multiplicar (evita arrastrar redondeos de más).
      const itemsToInsert = validItems.map((it) => {
        const cantidad = parseFloat(it.cantidad);
        const costoTotal = parseFloat(it.costoTotal);
        return {
          gasto_id: gastoId,
          descripcion: it.descripcion.trim(),
          cantidad,
          precio_unitario: costoTotal / cantidad,
          subtotal: costoTotal,
        };
      });

      const { data: insertedItems, error: itemsErr } = await supabase
        .from("gasto_items")
        .insert(itemsToInsert)
        .select();

      if (itemsErr) throw itemsErr;

      // ---- Transacción dual (paso B): "Ingreso de Mercadería" — todo
      // ítem que matchea una clave de 'stock' (vinculado por escaneo,
      // por la sugerencia de autocompletado, o porque su descripción
      // final coincide exacto con una etiqueta de stock — ver
      // resolveGastoItemStockKey) suma su cantidad al stock actual Y
      // recalcula 'precio_costo' con Costo Promedio Ponderado, igual
      // que "Agregar Unidades al Stock" (calcularCostoPromedioPonderado).
      // Si DOS ítems del mismo gasto apuntan a la misma clave (ej. la
      // misma bebida en dos líneas), se agregan ANTES de aplicar la
      // fórmula una sola vez por clave — aplicarla dos veces seguidas
      // partiendo del mismo "stock actual" para cada línea daría un
      // promedio incorrecto. No es una transacción real de Postgres
      // (el cliente de Supabase no soporta eso desde el navegador) —
      // si esto falla, el gasto YA quedó guardado (correcto: la plata
      // sí salió de caja), así que solo se avisa para que el admin
      // corrija el stock a mano en vez de fingir que todo el guardado
      // falló.
      const stockDeltas = {}; // { key: { unidades, costoTotal } }
      validItems.forEach((it) => {
        const key = resolveGastoItemStockKey(it);
        if (!key) return;
        const qty = parseFloat(it.cantidad) || 0;
        // 'costoTotal' ya ES el monto pagado por este ítem — no hace
        // falta multiplicar por cantidad (a diferencia de antes, que
        // lo derivaba de un precio unitario tipeado aparte).
        const costoTotalItem = parseFloat(it.costoTotal) || 0;
        if (!stockDeltas[key]) stockDeltas[key] = { unidades: 0, costoTotal: 0 };
        stockDeltas[key].unidades += qty;
        stockDeltas[key].costoTotal += costoTotalItem;
      });
      const stockKeysToUpdate = Object.keys(stockDeltas);
      let stockWarning = "";
      if (stockKeysToUpdate.length > 0) {
        const newStock = { ...stock };
        const newStockCostos = { ...stockCostos };
        const newStockUltimoCosto = { ...stockUltimoCosto };
        stockKeysToUpdate.forEach((key) => {
          const { unidades, costoTotal } = stockDeltas[key];
          newStockCostos[key] = calcularCostoPromedioPonderado({
            stockActual: stock[key] ?? 0,
            costoActualUnitario: stockCostos[key],
            unidadesIngresan: unidades,
            costoTotalCompra: costoTotal,
          });
          // Igual que en "Agregar Unidades al Stock": el último costo
          // se sobreescribe con el de ESTE lote, no se promedia.
          newStockUltimoCosto[key] = costoTotal / unidades;
          newStock[key] = (newStock[key] ?? 0) + unidades;
        });
        const stockUpdates = stockKeysToUpdate.map((key) => ({
          nombre: key,
          cantidad: newStock[key],
          precio_costo: newStockCostos[key],
          ultimo_costo_compra: newStockUltimoCosto[key],
          etiqueta: stockLabels[key] ?? key,
        }));
        const { error: stockErr } = await supabase
          .from("stock")
          .upsert(stockUpdates, { onConflict: "nombre" });
        if (stockErr) {
          console.error("Error al actualizar stock/costo desde Ingreso de Mercadería:", {
            message: stockErr.message,
            details: stockErr.details,
            hint: stockErr.hint,
            code: stockErr.code,
            error: stockErr,
          });
          stockWarning =
            "El gasto se guardó, pero no se pudo sumar el stock/costo automáticamente. Corrígelo en 'Editar Stock'.";
        } else {
          setStock(newStock);
          setStockCostos(newStockCostos);
          setStockUltimoCosto(newStockUltimoCosto);
        }
      }

      const newGasto = {
        id: gastoId ?? `gasto-${timestamp}`,
        proveedorId,
        tipoComprobante: gastoTipoComprobante,
        numeroComprobante: gastoNumeroComprobante.trim(),
        origen: gastoOrigen,
        metodoPago,
        montoEfectivo,
        montoDigital,
        total,
        timestamp: Number(gastoRow?.fecha ?? timestamp),
        items: (insertedItems || itemsToInsert).map((it, idx) => ({
          id: it.id ?? `item-${idx}`,
          descripcion: it.descripcion,
          cantidad: Number(it.cantidad),
          precioUnitario: Number(it.precio_unitario),
          subtotal: Number(it.subtotal),
        })),
      };

      setGastos((prev) => [newGasto, ...prev]);
      setGastoSaving(false);
      closeGastoForm();
      if (stockWarning) setGastoStockWarning(stockWarning);
    } catch (err) {
      console.error("Error detallado:", err);
      setGastoSaving(false);
      setGastoError(
        err?.message
          ? `No se pudo guardar en Supabase: ${err.message}`
          : "No se pudo guardar en Supabase. Intenta de nuevo."
      );
    }
  };

  /* ---- corte del "turno actual": desde el último Cierre de Caja, o
     desde la medianoche de hoy si todavía no se ha cerrado ningún
     turno. Todos los medidores de "Hoy" (Recaudado, Ganancia Neta,
     Ticket General, etc.) usan este corte en vez de la medianoche
     fija, para que un turno que cruza la medianoche (ej. cierra a las
     2am) siga sumando correctamente hasta que se presione "Cerrar
     Caja". */
  const turnoCutoff = useMemo(() => {
    if (cierres.length === 0) return startOfDay(Date.now());
    return Math.max(...cierres.map((c) => c.timestamp));
  }, [cierres]);

  /* ---- Mis Ventas (Hoy): agrupa 'sales' (una fila por producto) en
     una fila por venta (purchaseId), solo del turno actual. ---- */
  const ventasHoyAgrupadas = useMemo(() => {
    const porId = {};
    sales
      .filter((s) => s.timestamp > turnoCutoff)
      .forEach((s) => {
        if (!porId[s.purchaseId]) {
          porId[s.purchaseId] = {
            purchaseId: s.purchaseId,
            timestamp: s.timestamp,
            metodoPago: s.metodoPago,
            items: [],
            total: 0,
          };
        }
        porId[s.purchaseId].items.push(s);
        porId[s.purchaseId].total += s.total;
      });
    return Object.values(porId).sort((a, b) => b.timestamp - a.timestamp);
  }, [sales, turnoCutoff]);

  /* ---- Anula una venta del turno actual: repone el stock consumido,
     borra sus filas de 'historial' y revierte el efecto de su método
     (fiado_items si fue FIADO, comprobante si fue digital). Pensada
     para corregir un error de tipeo inmediato, no para editar ventas
     viejas — por eso solo se ofrece dentro de "Mis Ventas (Hoy)". Si
     el fiado de esa venta ya tiene abonos, se niega: revertir ahí
     desarmaría un pago que el cliente ya hizo. ---- */
  const anularVenta = async (purchaseId) => {
    const itemsDeVenta = sales.filter((s) => s.purchaseId === purchaseId);
    if (itemsDeVenta.length === 0) return;

    const metodo = itemsDeVenta[0]?.metodoPago;

    if (metodo === "FIADO") {
      const itemsFiado = fiadoItems.filter((fi) => fi.purchaseId === purchaseId);
      const yaAbonado = itemsFiado.some((fi) => fi.saldoRestante < fi.monto - 0.009);
      if (yaAbonado) {
        setAnularError(
          "Esta venta fiada ya tiene abonos registrados — no se puede anular sola. Ajusta la deuda manualmente desde Fiados."
        );
        return;
      }
    }

    setAnulandoVentaId(purchaseId);
    setAnularError("");

    try {
      // 1) Reponer el stock que esta venta había descontado.
      const devolver = {};
      itemsDeVenta.forEach((item) => {
        const product = Object.values(productsById).find(
          (p) => p.name === item.name && (p.detail || "") === (item.detail || "")
        );
        (product?.consumes || []).forEach((c) => {
          devolver[c.key] = (devolver[c.key] || 0) + c.qty * item.qty;
        });
      });

      const newStock = { ...stock };
      Object.keys(devolver).forEach((key) => {
        newStock[key] = (newStock[key] ?? 0) + devolver[key];
      });

      if (Object.keys(devolver).length > 0) {
        const stockUpdates = Object.keys(devolver).map((key) => ({
          nombre: key,
          cantidad: newStock[key],
        }));
        const { error: stockError } = await supabase
          .from("stock")
          .upsert(stockUpdates, { onConflict: "nombre" });
        if (stockError) throw stockError;
      }

      // 2) Borrar la venta de 'historial'.
      const { error: historialError } = await supabase
        .from("historial")
        .delete()
        .eq("purchase_id", purchaseId);
      if (historialError) throw historialError;

      // 3) Revertir el efecto según el método de pago.
      if (metodo === "FIADO") {
        const { error: fiadoError } = await supabase
          .from("fiado_items")
          .delete()
          .eq("purchase_id", purchaseId);
        if (fiadoError) throw fiadoError;
        setFiadoItems((prev) => prev.filter((fi) => fi.purchaseId !== purchaseId));
      } else if (metodo && metodo !== "EFECTIVO") {
        const { error: compError } = await supabase
          .from("comprobantes")
          .delete()
          .eq("purchase_id", purchaseId);
        if (compError) throw compError;
        setComprobantes((prev) => prev.filter((c) => c.purchaseId !== purchaseId));
      }

      // 4) Reflejar en el estado local.
      setStock(newStock);
      setSales((prev) => prev.filter((s) => s.purchaseId !== purchaseId));
    } catch (err) {
      console.error("Error al anular venta:", err);
      setAnularError("No se pudo anular la venta. Intenta de nuevo.");
    } finally {
      setAnulandoVentaId(null);
    }
  };

  /* ---- Usuarios: se cargan solo cuando el admin abre el modal (no en
     el efecto grande de arranque) — es una pantalla de gestión, no
     algo que haga falta tener listo apenas carga el POS. Trae cajeros
     Y clientes en una sola consulta (profiles ya tiene 'nombre' para
     ambos — ver create-cliente/migración 0033), ordenados por rol para
     que la lista salga agrupada visualmente. ---- */
  useEffect(() => {
    if (!cajerosOpen) return;
    let active = true;
    setCajerosLoading(true);

    supabase
      .from("profiles")
      .select("id, nombre, role")
      .in("role", ["cajero", "cliente"])
      .order("role", { ascending: true })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          console.error("Error cargando usuarios:", error);
        } else {
          setCajeros(data || []);
        }
        setCajerosLoading(false);
      });

    return () => {
      active = false;
    };
  }, [cajerosOpen]);

  const openPinModal = (usuario) => {
    setPinModalUser(usuario);
    setPinModalValue("");
    setPinModalError("");
  };

  const closePinModal = () => {
    setPinModalUser(null);
    setPinModalValue("");
    setPinModalError("");
  };

  const savePinModal = async () => {
    if (!pinModalUser) return;
    const pin = pinModalValue.trim();
    if (!/^\d{4,10}$/.test(pin)) {
      setPinModalError("La clave debe tener entre 4 y 10 dígitos.");
      return;
    }
    setPinModalSaving(true);
    setPinModalError("");

    const { error } = await supabase.functions.invoke("manage-usuario", {
      body: { action: "reset-pin", userId: pinModalUser.id, pin },
    });

    setPinModalSaving(false);

    if (error) {
      console.error("Error al cambiar PIN vía Edge Function:", error);
      const body = await error.context?.json?.().catch(() => null);
      setPinModalError(body?.error || "No se pudo cambiar el PIN. Intenta de nuevo.");
      return;
    }

    closePinModal();
  };

  const eliminarUsuarioAuth = async (usuario) => {
    const tipoLabel = usuario.role === "cajero" ? "cajero" : "cliente";
    if (!window.confirm(`¿Seguro que deseas eliminar a este ${tipoLabel}?`)) return;

    setUsuarioActionError("");
    setDeletingUsuarioId(usuario.id);

    const { error } = await supabase.functions.invoke("manage-usuario", {
      body: { action: "delete", userId: usuario.id },
    });

    setDeletingUsuarioId(null);

    if (error) {
      console.error("Error al eliminar usuario vía Edge Function:", error);
      const body = await error.context?.json?.().catch(() => null);
      setUsuarioActionError(body?.error || "No se pudo eliminar el usuario. Intenta de nuevo.");
      return;
    }

    setCajeros((prev) => prev.filter((c) => c.id !== usuario.id));
  };

  const resetCajeroForm = () => {
    setAddCajeroOpen(false);
    setNewCajeroNombre("");
    setNewCajeroUsuario("");
    setNewCajeroPin("");
    setCajeroError("");
  };

  const saveCajero = async () => {
    const nombre = newCajeroNombre.trim();
    const usuario = newCajeroUsuario.trim();
    const pin = newCajeroPin.trim();

    if (!nombre) {
      setCajeroError("Ingresa el nombre del cajero.");
      return;
    }
    if (!/^[a-zA-Z0-9._-]{3,20}$/.test(usuario)) {
      setCajeroError("El usuario debe tener 3 a 20 caracteres (letras, números, . _ -).");
      return;
    }
    if (!/^\d{4,10}$/.test(pin)) {
      setCajeroError("La clave debe tener entre 4 y 10 dígitos.");
      return;
    }

    setCajeroSaving(true);
    setCajeroError("");

    const { data, error } = await supabase.functions.invoke("create-cliente", {
      body: { tipo: "cajero", nombre, usuario, pin },
    });

    setCajeroSaving(false);

    if (error) {
      console.error("Error al crear cajero vía Edge Function:", error);
      const body = await error.context?.json?.().catch(() => null);
      setCajeroError(body?.error || "No se pudo crear el cajero. Intenta de nuevo.");
      return;
    }

    setCajeros((prev) => [...prev, { id: data.id, nombre: data.nombre, role: "cajero" }]);
    resetCajeroForm();
  };

  /* ---- estadísticas del turno actual (antes: "del día") ---- */
  const todayStats = useMemo(() => {
    const todaySales = sales.filter((s) => s.timestamp > turnoCutoff);
    // 'total' = TODAS las ventas del turno (fiadas o no) — se sigue
    // usando para Productos Vendidos / Ticket General.
    const total = todaySales.reduce((sum, s) => sum + s.total, 0);
    const items = todaySales.reduce((sum, s) => sum + s.qty, 0);
    const purchaseCount = new Set(todaySales.map((s) => s.purchaseId)).size;

    // 'cashRevenue' = solo lo que NO fue fiado — esto es lo que
    // efectivamente entró a la caja como dinero, para Recaudado Hoy.
    const cashSalesToday = todaySales.filter((s) => s.metodoPago !== "FIADO");
    const cashRevenue = cashSalesToday.reduce((sum, s) => sum + s.total, 0);
    // Cuánto de "total" (Valor Comercial) fue entregado a crédito hoy
    // — mercadería que ya salió del inventario pero todavía no se
    // cobra. total === cashRevenue + fiadoHoy, siempre.
    const fiadoHoy = total - cashRevenue;

    // "Congelamiento del Costo": el costo de una venta ya hecha es el
    // que se guardó en 'historial.costo_total' EN EL MOMENTO de esa
    // venta (ver submitVenta) — nunca se vuelve a buscar el costo
    // actual de 'productsById'/'stockCostos' acá. Si mañana cambia el
    // costo promedio ponderado (nuevo ingreso de mercadería), las
    // ventas de hoy no se mueven retroactivamente. Ventas de antes de
    // la migración 0026 no tienen costo congelado (costoTotal: null)
    // y aportan 0 — no hay forma de reconstruir ese dato con certeza.
    const costOf = (list) => list.reduce((sum, s) => sum + (s.costoTotal || 0), 0);

    // Costo de mercadería de TODAS las ventas del turno (se sigue
    // reportando como referencia general), y el de solo las ventas al
    // contado (para calcular la Ganancia de Ventas realizada).
    const cost = costOf(todaySales);
    const costCash = costOf(cashSalesToday);

    const manualToday = comprobantes
      .filter((c) => c.timestamp > turnoCutoff)
      .reduce((sum, c) => sum + c.amount, 0);

    // Cobros de fiado (Restar Crédito / Cancelar Cuenta) recibidos en
    // este turno: SÍ suman a Recaudado Hoy (es dinero real entrando
    // ahora). A diferencia de antes, ahora SÍ se reconocen como
    // ganancia — pero en su propio rubro ("Ganancia Neta Fiados"), no
    // mezclada con la de ventas frescas, y sin restarle costo (el
    // costo de esa mercadería ya se pagó cuando se hizo la venta
    // original, sea en este turno o en uno anterior).
    const cobrosHoy = movimientos.filter((m) => m.timestamp > turnoCutoff && m.tipo === "PAGO");
    const fiadoPagosHoy = cobrosHoy.reduce((sum, m) => sum + m.monto, 0);

    // Separación ESTRICTA de dinero físico vs digital — para el arqueo
    // de caja no importa si algo fue "venta" o "cobro de fiado", sino
    // si el billete entró al cajón o el dinero fue directo al banco.
    // Cobros con metodoPago null (de antes de que existiera esta
    // clasificación) NO se cuentan como efectivo — asumir "digital" por
    // defecto evita generar un falso "Faltante" en el arqueo.
    const ingresoEfectivoVentas = cashSalesToday
      .filter((s) => s.metodoPago === "EFECTIVO")
      .reduce((sum, s) => sum + s.total, 0);
    const ingresoDigitalVentas = cashSalesToday
      .filter((s) => s.metodoPago !== "EFECTIVO")
      .reduce((sum, s) => sum + s.total, 0);
    const cobroEfectivo = cobrosHoy
      .filter((m) => m.metodoPago === "EFECTIVO")
      .reduce((sum, m) => sum + m.monto, 0);
    const cobroDigital = cobrosHoy
      .filter((m) => m.metodoPago !== "EFECTIVO")
      .reduce((sum, m) => sum + m.monto, 0);
    const ingresoEfectivo = ingresoEfectivoVentas + cobroEfectivo;
    const ingresoDigital = ingresoDigitalVentas + cobroDigital;

    // Gastos reales registrados en este turno con origen "Caja" (o sea,
    // que sí salieron de esta caja). Los de origen "Externo" no se
    // restan aquí porque no salieron de la caja registradora.
    const gastosCajaHoy = gastos.filter(
      (g) => g.timestamp > turnoCutoff && g.origen === "CAJA"
    );
    const gastosHoyCaja = gastosCajaHoy.reduce((sum, g) => sum + g.total, 0);

    // Separación estricta para el arqueo: un gasto pagado por Yape NO
    // sale del cajón físico, aunque sí sea plata del negocio. Legacy
    // (metodoPago null, de antes de esta clasificación) se asume
    // EFECTIVO por seguridad: si asumiera "digital" por defecto, un
    // gasto viejo pagado en efectivo dejaría de restarse del cajón y
    // el arqueo mostraría un "Faltante" falso (el opuesto del criterio
    // usado para ingresos, donde lo desconocido se asume digital —
    // acá el gasto desconocido se asume efectivo por la misma razón:
    // evitar un Faltante fantasma).
    const gastosEfectivoHoy = gastosCajaHoy.reduce((sum, g) => {
      if (g.metodoPago === "MIXTO") return sum + (g.montoEfectivo || 0);
      if (g.metodoPago === "DIGITAL") return sum;
      return sum + g.total; // EFECTIVO o legacy (metodoPago null)
    }, 0);
    const gastosDigitalHoy = gastosCajaHoy.reduce((sum, g) => {
      if (g.metodoPago === "MIXTO") return sum + (g.montoDigital || 0);
      if (g.metodoPago === "DIGITAL") return sum + g.total;
      return sum;
    }, 0);

    // Ganancia Neta (Ventas): SOLO lo realmente vendido al contado en
    // este turno (fiado excluido — su margen no está realizado en caja
    // todavía), menos su costo de mercadería estimado (ver
    // DEFAULT_COST_RATIO), más ingreso manual, menos gastos operativos.
    const gananciaVentas = cashRevenue - costCash + manualToday - gastosHoyCaja;
    // Ganancia Neta (Fiados): lo cobrado hoy de deudas viejas o
    // nuevas — dinero recuperado, tratado como ganancia al momento del
    // cobro.
    const gananciaFiados = fiadoPagosHoy;
    const recaudadoTotal = cashRevenue + manualToday + fiadoPagosHoy;

    // Ganancia Neta Esperada: margen de TODO lo vendido hoy (contado +
    // fiado), sin importar si ya se cobró — muestra la rentabilidad de
    // la mercancía entregada, no solo la del dinero que ya entró a
    // caja. No resta gastos (esos ya se ven en su propia fila).
    const gananciaEsperada = total - cost;

    // GANANCIA NETA DEL TURNO (sección Cierre de Caja, solo admin):
    // Total Vendido (valor comercial de todo lo entregado este turno,
    // fiado incluido) menos el Total de Gastos del turno (gastosHoyCaja
    // = gastosEfectivoHoy + gastosDigitalHoy). NO se resta 'cost' acá:
    // cuando el stock se repone se registra como un Gasto (ver
    // saveGasto, que además actualiza 'stock' con el costo promedio
    // ponderado), así que restar 'cost' de nuevo aquí duplicaba el
    // costo de mercadería (una vez como compra en Gastos, otra vez como
    // costo de venta) y por eso el resultado se iba a negativo.
    const gananciaNetaTurno = total - gastosHoyCaja;

    // Ticket General: monto promedio por venta registrada hoy.
    const avgTicket = purchaseCount > 0 ? total / purchaseCount : 0;

    return {
      total,
      cashRevenue,
      fiadoHoy,
      items,
      purchaseCount,
      cost,
      manualToday,
      fiadoPagosHoy,
      ingresoEfectivo,
      ingresoDigital,
      gastosHoyCaja,
      gastosEfectivoHoy,
      gastosDigitalHoy,
      gananciaVentas,
      gananciaFiados,
      gananciaEsperada,
      gananciaNetaTurno,
      recaudadoTotal,
      avgTicket,
    };
  }, [sales, comprobantes, gastos, movimientos, turnoCutoff]);

  /* ---- 📥 Historial de Gastos (solo admin): una fila por CADA ÍTEM de
     cada gasto (no una fila por gasto) — así el proveedor/comprobante
     de la boleta se repite en sus líneas, igual que el resto de los
     exports "detallados" de esta app, y se puede sumar/filtrar en
     Excel sin tener que abrir cada boleta a mano. ---- */
  const exportHistorialGastosXLSX = () => {
    const headers = [
      "Fecha",
      "Hora",
      "Proveedor",
      "RUC",
      "Tipo Comprobante",
      "N° Comprobante",
      "Origen",
      "Método de Pago",
      "Descripción Ítem",
      "Cantidad",
      "Precio Unitario (S/)",
      "Subtotal Ítem (S/)",
      "Total Gasto (S/)",
    ];
    const filas = [headers];
    gastos.forEach((g) => {
      const proveedor = proveedores.find((p) => p.id === g.proveedorId);
      const itemsDelGasto = g.items.length > 0 ? g.items : [null];
      itemsDelGasto.forEach((it) => {
        filas.push([
          formatDate(g.timestamp),
          formatTime(g.timestamp),
          proveedor ? proveedor.razonSocial : "",
          proveedor ? proveedor.ruc : "",
          g.tipoComprobante || "",
          g.numeroComprobante || "",
          g.origen === "EXTERNO" ? "Externo" : "Caja",
          g.metodoPago || "",
          it ? it.descripcion : "",
          it ? it.cantidad : "",
          it ? Number(it.precioUnitario.toFixed(2)) : "",
          it ? Number(it.subtotal.toFixed(2)) : "",
          Number(g.total.toFixed(2)),
        ]);
      });
    });
    downloadXLSX(`historial-gastos-${Date.now()}.xlsx`, [{ nombre: "Gastos", filas }]);
  };

  /* ---- 🛒 Historial de Ventas (solo admin): una fila por línea de
     'historial', con todo lo que queda CONGELADO al momento de la
     venta (precio, costo, monto recibido y vuelto — ver submitVenta).
     Nunca se recalcula con datos actuales de 'productos'/'stock'. ---- */
  const exportHistorialVentasXLSX = () => {
    const headers = [
      "ID Compra",
      "Fecha",
      "Hora",
      "Producto",
      "Detalle",
      "Cantidad",
      "Precio Venta (S/)",
      "Total (S/)",
      "Costo Unitario (S/)",
      "Costo Total (S/)",
      "Método de Pago",
      "Vendedor",
      "Monto Recibido (S/)",
      "Vuelto (S/)",
    ];
    const filas = [
      headers,
      ...sales.map((s) => [
        s.purchaseId,
        formatDate(s.timestamp),
        formatTime(s.timestamp),
        s.name,
        s.detail || "",
        s.qty,
        Number(s.price.toFixed(2)),
        Number(s.total.toFixed(2)),
        s.costoUnitario != null ? Number(s.costoUnitario.toFixed(2)) : "",
        s.costoTotal != null ? Number(s.costoTotal.toFixed(2)) : "",
        s.metodoPago || "",
        s.vendedor || "",
        s.montoRecibido != null ? Number(s.montoRecibido.toFixed(2)) : "",
        s.vuelto != null ? Number(s.vuelto.toFixed(2)) : "",
      ]),
    ];
    downloadXLSX(`historial-ventas-${Date.now()}.xlsx`, [{ nombre: "Ventas", filas }]);
  };

  /* ---- 📥 Exportar Historial de Cierres (solo admin, modal Cierre de
     Caja): TODOS los campos de cada corte de turno con el mayor
     detalle posible, más un "Resumen Mensual" (recaudado/gastos/
     ganancia agrupados por mes, calculado desde 'sales'/'gastos'
     crudos — no desde 'cierres' — para no depender de que el mes en
     curso ya tenga un cierre hecho). ---- */
  const exportHistorialCierresXLSX = () => {
    const headersCierres = [
      "Fecha Cierre",
      "Hora Cierre",
      "Cajero",
      "Fecha Apertura",
      "Hora Apertura",
      "Fondo Inicial (S/)",
      "Recaudado Total (S/)",
      "Ingreso Efectivo (S/)",
      "Ingreso Digital (S/)",
      "Productos Vendidos",
      "Ventas Registradas",
      "Gastos Total (S/)",
      "Ganancia Neta Ventas (S/)",
      "Ganancia Neta Fiados (S/)",
      "Ganancia Neta Total (S/)",
      "Ticket General (S/)",
      "Efectivo Real (S/)",
      "Diferencia (S/)",
    ];
    const filasCierres = [
      headersCierres,
      ...cierres.map((c) => [
        formatDate(c.timestamp),
        formatTime(c.timestamp),
        c.cajeroNombre || "",
        // 'abiertaEn' es la fotografía real del momento de apertura
        // (desde estado_caja, migración 0029) — para cierres de antes
        // de esa migración no hay forma de reconstruirlo, así que cae
        // a 'turnoInicio' (el corte de estadísticas, la mejor
        // aproximación disponible) en vez de quedar vacío.
        formatDate(c.abiertaEn ?? c.turnoInicio),
        formatTime(c.abiertaEn ?? c.turnoInicio),
        c.fondoInicial != null ? Number(c.fondoInicial.toFixed(2)) : "",
        Number(c.recaudadoTotal.toFixed(2)),
        c.ingresoEfectivo != null ? Number(c.ingresoEfectivo.toFixed(2)) : "",
        c.ingresoDigital != null ? Number(c.ingresoDigital.toFixed(2)) : "",
        c.productosVendidos,
        c.ventasRegistradas,
        Number(c.gastosTotal.toFixed(2)),
        c.gananciaVentas != null ? Number(c.gananciaVentas.toFixed(2)) : "",
        c.gananciaFiados != null ? Number(c.gananciaFiados.toFixed(2)) : "",
        Number(c.gananciaNeta.toFixed(2)),
        Number(c.ticketGeneral.toFixed(2)),
        c.efectivoReal != null ? Number(c.efectivoReal.toFixed(2)) : "",
        c.diferencia != null ? Number(c.diferencia.toFixed(2)) : "",
      ]),
    ];

    const mensual = {};
    const getOrInit = (key) => {
      if (!mensual[key]) mensual[key] = { recaudado: 0, costo: 0, gastos: 0 };
      return mensual[key];
    };
    sales.forEach((s) => {
      const d = new Date(s.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const m = getOrInit(key);
      m.recaudado += s.total;
      m.costo += s.costoTotal || 0;
    });
    gastos.forEach((g) => {
      const d = new Date(g.timestamp);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      getOrInit(key).gastos += g.total;
    });
    const headersMensual = [
      "Mes",
      "Total Recaudado (S/)",
      "Total Gastos (S/)",
      "Ganancia Neta Mensual (S/)",
    ];
    const filasMensual = [
      headersMensual,
      ...Object.keys(mensual)
        .sort()
        .map((key) => {
          const m = mensual[key];
          const gananciaNetaMensual = m.recaudado - m.costo - m.gastos;
          return [
            formatMesEs(key),
            Number(m.recaudado.toFixed(2)),
            Number(m.gastos.toFixed(2)),
            Number(gananciaNetaMensual.toFixed(2)),
          ];
        }),
    ];

    downloadXLSX(`historial-cierres-${Date.now()}.xlsx`, [
      { nombre: "Cierres", filas: filasCierres },
      { nombre: "Resumen Mensual", filas: filasMensual },
    ]);
  };

  /* ---- Enviar Resumen a WhatsApp (modal Cierre de Caja): abre wa.me
     SIN número (deja elegir el contacto/grupo destino) con un texto
     PLANO — sin emojis, sin branding — armado a mano, nada de
     imágenes/PDF. El contenido está segmentado por rol EXACTAMENTE
     como se pidió: Admin ve 9 campos (incluye Gastos, Fiados,
     Ganancia Neta), Cajero ve solo 6 (nunca una cifra que su propia
     pantalla de Cierre ya le oculta). ---- */
  const buildCierreResumenTexto = () => {
    const fecha = `${formatDate(Date.now())} ${formatTime(Date.now())}`;
    const lineas = [
      "RESUMEN",
      `Fecha/Hora: ${fecha}`,
      `Vendedor: ${currentUserLabel}`,
      `Total Ventas: ${formatSoles(todayStats.total)}`,
    ];

    if (isAdmin) {
      lineas.push(
        `Total Gastos: ${formatSoles(todayStats.gastosHoyCaja)}`,
        `Efectivo: ${formatSoles(todayStats.ingresoEfectivo)}`,
        `Digital: ${formatSoles(todayStats.ingresoDigital)}`,
        `Fiados: ${formatSoles(todayStats.fiadoHoy)}`,
        `Ganancia Neta: ${formatSoles(todayStats.gananciaNetaTurno)}`
      );
    } else {
      lineas.push(
        `Efectivo: ${formatSoles(todayStats.ingresoEfectivo)}`,
        `Digital: ${formatSoles(todayStats.ingresoDigital)}`
      );
    }

    return lineas.join("\n");
  };

  const enviarResumenCierrePorWhatsApp = () => {
    const texto = buildCierreResumenTexto();
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank");
  };

  /* ---- Apertura de Caja (solo admin — el botón que dispara esto ya
     está gateado por isAdmin en el render): carga el fondo inicial
     contado a mano y abre la caja para que el POS quede disponible
     tanto para admin como para cajero. ---- */
  const abrirCaja = async () => {
    const fondo = parseFloat(fondoInicialInput);
    if (isNaN(fondo) || fondo < 0) {
      setAperturaError("Ingresa el fondo inicial (billetes y monedas contados), 0 o más.");
      return;
    }

    setAperturaSaving(true);
    setAperturaError("");

    const abiertaEn = Date.now();
    const nombreQuienAbre = cajeroNombre || (isAdmin ? "Admin" : "Cajero");

    const { error } = await supabase
      .from("estado_caja")
      .update({
        estado: "abierta",
        fondo_inicial: fondo,
        abierta_por: nombreQuienAbre,
        abierta_en: abiertaEn,
        cerrada_en: null,
      })
      .eq("id", 1);

    setAperturaSaving(false);

    if (error) {
      console.error("Error al abrir caja:", error);
      setAperturaError(
        error.message ? `No se pudo abrir la caja: ${error.message}` : "No se pudo abrir la caja."
      );
      return;
    }

    setEstadoCaja({
      estado: "abierta",
      fondoInicial: fondo,
      abiertaPor: nombreQuienAbre,
      abiertaEn,
      cerradaEn: null,
    });
    setFondoInicialInput("");
  };

  /* ---- Confirmación de turno (solo cajero): reconoce el fondo
     inicial de ESTA apertura puntual (abiertaEn) antes de dejarlo
     entrar al POS — puramente local (localStorage), no hay nada que
     guardar en Supabase acá. ---- */
  const confirmarTurno = () => {
    if (!estadoCaja?.abiertaEn) return;
    const marca = String(estadoCaja.abiertaEn);
    localStorage.setItem("tz_turno_confirmado_en", marca);
    setTurnoConfirmadoEn(marca);
  };

  /* ---- Cierre de Caja: guarda una instantánea de los contadores del
     turno actual en 'cierres_caja'. Al insertarla, 'turnoCutoff' se
     recalcula automáticamente (useMemo depende de 'cierres') y todos
     los medidores de "Hoy" vuelven a cero para el turno nuevo. ---- */
  const ejecutarCierre = async () => {
    setCierreSaving(true);
    setCierreError("");

    const timestamp = Date.now();
    const efectivoRealNum = parseFloat(efectivoReal);
    const tieneArqueo = efectivoReal !== "" && !isNaN(efectivoRealNum);
    const snapshot = {
      turno_inicio: turnoCutoff,
      recaudado_total: todayStats.recaudadoTotal,
      productos_vendidos: todayStats.items,
      ventas_registradas: todayStats.purchaseCount,
      gastos_total: todayStats.gastosHoyCaja,
      ganancia_neta: todayStats.gananciaNetaTurno,
      ganancia_ventas: todayStats.gananciaVentas,
      ganancia_fiados: todayStats.gananciaFiados,
      ticket_general: todayStats.avgTicket,
      efectivo_real: tieneArqueo ? efectivoRealNum : null,
      diferencia: tieneArqueo
        ? efectivoRealNum - (todayStats.ingresoEfectivo - todayStats.gastosEfectivoHoy)
        : null,
      ingreso_efectivo: todayStats.ingresoEfectivo,
      ingreso_digital: todayStats.ingresoDigital,
      cajero_nombre: cajeroNombre || (isAdmin ? "Admin" : "Cajero"),
      // Fotografía del estado_caja vigente — fondo inicial y momento
      // exacto de apertura de ESTE turno que se está cerrando ahora.
      fondo_inicial: estadoCaja?.fondoInicial ?? null,
      abierta_en: estadoCaja?.abiertaEn ?? null,
      fecha: timestamp,
    };

    const { data: inserted, error } = await supabase
      .from("cierres_caja")
      .insert([snapshot])
      .select();

    setCierreSaving(false);

    if (error) {
      console.error("Error detallado:", error);
      setCierreError(
        error.message
          ? `No se pudo guardar en Supabase: ${error.message}`
          : "No se pudo guardar en Supabase. Intenta de nuevo."
      );
      return;
    }

    const row = inserted && inserted[0];
    const newCierre = {
      id: row?.id ?? `cierre-${timestamp}`,
      turnoInicio: turnoCutoff,
      recaudadoTotal: snapshot.recaudado_total,
      productosVendidos: snapshot.productos_vendidos,
      ventasRegistradas: snapshot.ventas_registradas,
      gastosTotal: snapshot.gastos_total,
      gananciaNeta: snapshot.ganancia_neta,
      gananciaVentas: snapshot.ganancia_ventas,
      gananciaFiados: snapshot.ganancia_fiados,
      ticketGeneral: snapshot.ticket_general,
      efectivoReal: snapshot.efectivo_real,
      diferencia: snapshot.diferencia,
      ingresoEfectivo: snapshot.ingreso_efectivo,
      ingresoDigital: snapshot.ingreso_digital,
      cajeroNombre: snapshot.cajero_nombre,
      fondoInicial: snapshot.fondo_inicial,
      abiertaEn: snapshot.abierta_en,
      timestamp: Number(row?.fecha ?? timestamp),
    };

    setCierres((prev) => [newCierre, ...prev]);
    setConfirmCierreOpen(false);
    setEfectivoReal("");

    // Fase 1 "Control de Dinero": cerrar caja SIEMPRE marca
    // estado_caja como 'cerrada', sin importar el rol. El efecto es
    // distinto según quién cierra: el admin sigue con acceso total
    // (el gating de estado_caja solo bloquea al cajero); el cajero
    // queda bloqueado hasta la próxima apertura. No se revierte el
    // cierre ya guardado si esto falla — mismo criterio que el resto
    // de la app (el dato importante ya quedó registrado).
    const { error: estadoCajaCloseError } = await supabase
      .from("estado_caja")
      .update({ estado: "cerrada", cerrada_en: timestamp })
      .eq("id", 1);

    if (estadoCajaCloseError) {
      console.error("Error al cerrar estado_caja:", estadoCajaCloseError);
      setCierreError(
        "El cierre se guardó, pero no se pudo actualizar el estado de la caja. Recarga la página si el bloqueo no aparece."
      );
    } else {
      setEstadoCaja((prev) => (prev ? { ...prev, estado: "cerrada", cerradaEn: timestamp } : prev));
    }
  };

  /* ---- estadísticas globales por método de pago (para el modal de
     "Métodos de Pago" del header). El totalizador de "hoy" es el que
     se mantiene sincronizado en tiempo real con "Recaudado Hoy". ---- */
  const methodStats = useMemo(() => {
    const stats = {};
    PAYMENT_METHODS.forEach((m) => {
      stats[m.key] = { todayTotal: 0, allTimeTotal: 0, entries: [] };
    });

    comprobantes.forEach((c) => {
      // Normaliza a MAYÚSCULAS: comprobantes viejos pudieron guardarse
      // como 'Yape'/'yape' en vez de 'YAPE' (con qué exactitud se
      // guardó cambió entre versiones del código) — sin esto, esas
      // filas nunca encontraban su bucket en 'stats' y quedaban
      // invisibles, aunque sí existieran en la base de datos.
      const key = (c.method || "").toUpperCase();
      if (!stats[key]) return;
      stats[key].allTimeTotal += c.amount;
      stats[key].entries.push(c);
      if (c.timestamp > turnoCutoff) {
        stats[key].todayTotal += c.amount;
      }
    });

    Object.values(stats).forEach((st) => {
      st.entries.sort((a, b) => b.timestamp - a.timestamp);
    });

    return stats;
  }, [comprobantes, turnoCutoff]);

  /* ---- saldos por cliente de la Libreta (Fiados): saldo positivo =
     el cliente debe; saldo negativo = tiene crédito a favor. ---- */
  const clienteSaldos = useMemo(() => {
    const map = {};
    clientes.forEach((c) => {
      map[c.id] = { saldo: 0, items: [], pagos: [] };
    });

    fiadoItems.forEach((fi) => {
      if (!map[fi.clienteId]) return;
      map[fi.clienteId].items.push(fi);
      map[fi.clienteId].saldo += fi.saldoRestante;
    });

    movimientos.forEach((m) => {
      if (!map[m.clienteId]) return;
      if (m.tipo === "DEUDA") {
        // Compatibilidad con cuentas creadas antes de este rediseño
        // (deuda cargada a mano, sin fiado_items detrás).
        map[m.clienteId].saldo += m.monto;
      } else {
        map[m.clienteId].pagos.push(m);
      }
    });

    Object.values(map).forEach((v) => {
      v.items.sort((a, b) => b.timestamp - a.timestamp);
      v.pagos.sort((a, b) => b.timestamp - a.timestamp);
    });

    return map;
  }, [clientes, fiadoItems, movimientos]);

  /* ---- Top Clientes (ranking de fidelidad): SOLO cuentas reales de
     Cliente (authUserId != null — con PIN, nombre y teléfono, creadas
     vía la Edge Function), nunca cajeros/admin. La única actividad que
     este sistema puede atribuir HOY a un cliente puntual es lo que
     pasa por la Libreta — compras fiadas (fiado_items) y sus pagos
     (movimientos_fiado, tipo !== 'DEUDA'). Una venta al CONTADO no
     queda ligada a ningún cliente en el esquema actual (el WhatsApp
     que se tipea en el checkout es efímero, solo vive para el envío
     de esa boleta puntual — no se guarda en 'historial'), así que no
     entra en el consumo total; lo dejamos así en vez de fingir un
     vínculo que la base de datos no tiene. "Monto total consumido" =
     compras fiadas + pagos hechos; "frecuencia" = número de compras
     (purchase_id distintos) + número de pagos. También arma, por
     cliente, el Top 5 de productos favoritos (por veces comprado en
     fiado_items) y el saldo pendiente (mismo criterio que
     clienteSaldos) para el semáforo de deuda. ---- */
  const topClientesRanking = useMemo(() => {
    const map = {};
    clientes
      .filter((c) => c.authUserId)
      .forEach((c) => {
        map[c.id] = {
          cliente: c,
          totalCompras: 0,
          totalPagos: 0,
          pagosCount: 0,
          purchaseIds: new Set(),
          saldo: 0,
          productos: {}, // "nombre · detalle" -> veces comprado
        };
      });

    fiadoItems.forEach((fi) => {
      const entry = map[fi.clienteId];
      if (!entry) return;
      entry.totalCompras += fi.monto;
      entry.saldo += fi.saldoRestante;
      if (fi.purchaseId) entry.purchaseIds.add(fi.purchaseId);
      const label = fi.detalle ? `${fi.productoNombre} · ${fi.detalle}` : fi.productoNombre;
      entry.productos[label] = (entry.productos[label] || 0) + 1;
    });

    movimientos.forEach((m) => {
      const entry = map[m.clienteId];
      if (!entry) return;
      if (m.tipo === "DEUDA") {
        entry.saldo += m.monto;
        return;
      }
      entry.totalPagos += m.monto;
      entry.pagosCount += 1;
    });

    return Object.values(map)
      .map((e) => ({
        cliente: e.cliente,
        totalConsumido: e.totalCompras + e.totalPagos,
        frecuencia: e.purchaseIds.size + e.pagosCount,
        saldo: e.saldo,
        favoritos: Object.entries(e.productos)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([label, veces]) => ({ label, veces })),
      }))
      .filter((e) => e.totalConsumido > 0 || e.frecuencia > 0)
      .sort((a, b) => b.totalConsumido - a.totalConsumido || b.frecuencia - a.frecuencia);
  }, [clientes, fiadoItems, movimientos]);

  /* ---- WhatsApp 1-click para un cliente del ranking: mensaje fijo,
     sobrio, sin nombre de empresa/branding. ---- */
  const buildTopClienteWhatsappLink = (cliente) => {
    const numero = toPeruWhatsappNumber(cliente.whatsapp);
    if (!numero) return null;
    const mensaje = `Hola ${cliente.nombre}, eres uno de nuestros clientes preferidos. Pasa hoy y aprovecha nuestros descuentos del dia.`;
    return `https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`;
  };

  /* ---- Exportar Lista VIP: copia al portapapeles nombre + teléfono de
     cada cliente del ranking actual, uno por línea — sin montos ni
     datos de deuda (es una lista de contacto, no un reporte). ---- */
  const exportarListaVIP = async () => {
    const lineas = topClientesRanking.map(
      (row) => `${row.cliente.nombre} - ${row.cliente.whatsapp || "sin teléfono"}`
    );
    const texto = lineas.join("\n");
    try {
      await navigator.clipboard.writeText(texto);
      setVipExportMsg("Lista copiada al portapapeles.");
    } catch (err) {
      console.error("Error copiando la lista VIP:", err);
      setVipExportMsg("No se pudo copiar. Copia manual desde la consola.");
    }
    setTimeout(() => setVipExportMsg(""), 3000);
  };

  const totalPorCobrar = useMemo(
    () =>
      Object.values(clienteSaldos).reduce(
        (sum, v) => sum + (v.saldo > 0 ? v.saldo : 0),
        0
      ),
    [clienteSaldos]
  );

  /* ---- estadísticas por producto (para el medidor de Ticket Promedio) ---- */
  const productStats = useMemo(() => {
    const stats = {};
    Object.values(productsById).forEach((p) => {
      stats[p.id] = { unitsSold: 0, revenue: 0, salesCount: 0 };
    });

    sales.forEach((s) => {
      const match = Object.values(productsById).find(
        (p) => p.name === s.name && (p.detail || "") === (s.detail || "")
      );
      if (match && stats[match.id]) {
        stats[match.id].unitsSold += s.qty;
        stats[match.id].revenue += s.total;
        stats[match.id].salesCount += 1;
      }
    });

    Object.values(stats).forEach((st) => {
      st.avgTicket = st.salesCount > 0 ? st.revenue / st.salesCount : 0;
    });

    return stats;
  }, [sales]);

  const bestSellerId = useMemo(() => {
    let best = null;
    let bestQty = 0;
    Object.entries(productStats).forEach(([id, st]) => {
      if (st.unitsSold > bestQty) {
        bestQty = st.unitsSold;
        best = id;
      }
    });
    return bestQty > 0 ? best : null;
  }, [productStats]);

  const activeSection = sections.find((s) => s.key === activeTab);

  // Agrupación por nombre_base calculada UNA vez por sección activa,
  // sobre TODOS sus subgrupos a la vez — ver buildSectionDisplayEntries.
  const sectionEntriesByGi = useMemo(
    () => (activeSection ? buildSectionDisplayEntries(activeSection.groups) : new Map()),
    [activeSection]
  );

  /* ---- buscador global: sugerencias por nombre sobre TODO el
     catálogo (no solo la pestaña activa), tope de 8 para que el
     dropdown no tape media pantalla. ---- */
  const globalSearchResults = useMemo(() => {
    const q = globalSearchTerm.trim().toLowerCase();
    if (!q) return [];
    return Object.values(productsById)
      .filter((p) => p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [globalSearchTerm, productsById]);

  // Cambia a la pestaña de categoría del producto (si existe) antes de
  // seleccionarlo — así el usuario ve de inmediato en qué sección
  // "aterrizó" el producto que buscó/escaneó, en vez de quedar
  // seleccionado en una pestaña que no está viendo.
  const jumpToProductSection = (product) => {
    const section = sections.find((s) => s.label === product.sectionLabel);
    if (section) setActiveTab(section.key);
  };

  const handleGlobalSearchSelect = (product) => {
    jumpToProductSection(product);
    selectProductForSale(product);
    setGlobalSearchTerm("");
    setGlobalSearchOpen(false);
  };

  /* ---- escáner rápido de la pantalla principal: busca el código en
     Supabase (mismo helper que usa Gastos/Editar Stock), resuelve el
     producto completo desde 'productsById' (ya trae sectionLabel +
     consumes, lo que necesita availabilityFor/selectProductForSale) y
     dispara la misma acción que un clic en la grilla — cambiando antes
     a la pestaña de su categoría. ---- */
  const handleGlobalScan = async (codigoEscaneado) => {
    setGlobalScannerOpen(false);
    setGlobalScanError("");
    setGlobalScanBusy(true);
    try {
      const encontrado = await buscarProductoPorCodigo(codigoEscaneado);
      if (!encontrado) {
        setGlobalScanError(`No se encontró ningún producto con el código "${codigoEscaneado}".`);
        return;
      }
      const product = productsById[encontrado.id];
      if (!product) {
        setGlobalScanError(`"${encontrado.nombre}" no está disponible para vender ahora mismo.`);
        return;
      }
      jumpToProductSection(product);
      const ok = selectProductForSale(product);
      if (!ok) {
        setGlobalScanError(`"${product.name}" está agotado (sin stock disponible).`);
      }
    } catch (err) {
      console.error("Error buscando producto escaneado (búsqueda global):", err);
      setGlobalScanError("Error al buscar el producto. Intenta de nuevo.");
    } finally {
      setGlobalScanBusy(false);
    }
  };

  /* ---- Arqueo de Caja: diferencia entre lo que el admin cuenta a mano
     y lo que el sistema espera tener FÍSICAMENTE en el cajón. Usa
     ÚNICAMENTE ingresoEfectivo (nunca el digital — ese dinero va al
     banco, no al cajón) menos los Gastos pagados desde esa misma caja.
     No es lo mismo que la Ganancia Neta, que además descuenta el costo
     de los productos vendidos. ---- */
  const efectivoRealNum = parseFloat(efectivoReal);
  const cajaFisicaEsperada = todayStats.ingresoEfectivo - todayStats.gastosEfectivoHoy;
  const arqueoDiferencia =
    efectivoReal !== "" && !isNaN(efectivoRealNum) ? efectivoRealNum - cajaFisicaEsperada : null;
  const arqueoInfo =
    arqueoDiferencia == null
      ? null
      : Math.abs(arqueoDiferencia) <= 0.009
      ? { texto: "Caja cuadrada", clase: "tz-arqueo-ok" }
      : arqueoDiferencia < 0
      ? { texto: `Faltante: ${formatSoles(Math.abs(arqueoDiferencia))}`, clase: "tz-arqueo-faltante" }
      : { texto: `Sobrante: ${formatSoles(arqueoDiferencia)}`, clase: "tz-arqueo-sobrante" };

  if (loading) {
    return (
      <div className="tz-root tz-loading">
        <Styles />
        <Loader2 className="tz-spin" size={34} />
        <p>Cargando caja registradora…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="tz-root tz-loading">
        <Styles />
        <AlertTriangle size={34} className="tz-cliente-debe" />
        <p>{loadError}</p>
      </div>
    );
  }

  /* ---- Fase 1 "Control de Dinero y Flujo de Sesión": gating de
     acceso al POS según estado_caja, SOLO para el rol cajero — el
     admin nunca queda bloqueado de esta forma, ve un modal de
     apertura obligatorio en su lugar (más abajo, dentro del return
     principal). 'estadoCaja' siempre está definido acá (loadedEstadoCaja
     nunca es null, incluso si la tabla estuviera vacía). ---- */
  const cajaAbierta = estadoCaja?.estado === "abierta";
  const turnoYaConfirmado =
    !!estadoCaja?.abiertaEn && turnoConfirmadoEn === String(estadoCaja.abiertaEn);

  if (isCajero && !cajaAbierta) {
    // Si turnoConfirmadoEn tiene algo guardado, este cajero ya había
    // confirmado un turno (el que justo se cerró) — el texto refleja
    // que fue SU turno el que terminó, no que la caja ya estaba
    // cerrada cuando llegó.
    const turnoFinalizado = !!turnoConfirmadoEn;
    return (
      <div className="tz-root tz-caja-blocked">
        <Styles />
        <img src={logo} alt="TONAZO!" className="tz-caja-blocked-logo" />
        <Lock size={44} />
        <h1>{turnoFinalizado ? "Turno Finalizado" : "Caja Cerrada"}</h1>
        <p>Caja Cerrada — {turnoFinalizado ? "hasta tu próximo turno." : "Esperando apertura."}</p>
        <button className="tz-header-btn tz-caja-blocked-logout" onClick={signOut}>
          <LogOut size={16} /> Cerrar sesión
        </button>
      </div>
    );
  }

  if (isCajero && cajaAbierta && !turnoYaConfirmado) {
    return (
      <div className="tz-root tz-caja-blocked">
        <Styles />
        <img src={logo} alt="TONAZO!" className="tz-caja-blocked-logo" />
        <DollarSign size={44} />
        <h1>Confirmar Turno</h1>
        <p>Caja abierta por {estadoCaja.abiertaPor || "el admin"}.</p>
        <div className="tz-caja-fondo-readonly">
          <span>Fondo inicial</span>
          <strong>{formatSoles(estadoCaja.fondoInicial ?? 0)}</strong>
        </div>
        <button className="tz-submit-btn" onClick={confirmarTurno}>
          <Check size={16} /> Confirmar e Iniciar Turno
        </button>
        <button className="tz-header-btn tz-caja-blocked-logout" onClick={signOut}>
          <LogOut size={16} /> Cerrar sesión
        </button>
      </div>
    );
  }

  return (
    <div className="tz-root">
      <Styles />

      {/* ---------------- MODAL OBLIGATORIO: APERTURA DE CAJA (solo admin) ----------------
         Sin botón de cerrar ni backdrop clickeable — la caja tiene que
         abrirse antes de poder hacer cualquier otra cosa. Solo se
         dispara para isAdmin: el cajero nunca ve esto, para él la caja
         cerrada es la pantalla de bloqueo de más arriba. */}
      {isAdmin && !cajaAbierta && (
        <div className="tz-modal-backdrop tz-caja-apertura-backdrop">
          <div className="tz-modal">
            <div className="tz-add-entry">
              <h2>Apertura de Caja</h2>
              <p className="tz-stock-editor-sub">
                Cuenta el efectivo físico (billetes y monedas) con el que arranca el turno antes
                de habilitar la caja.
              </p>
              <label className="tz-field-label">Fondo inicial (S/)</label>
              <input
                type="number"
                min="0"
                step="0.10"
                autoFocus
                className="tz-amount-input"
                placeholder="0.00"
                value={fondoInicialInput}
                onChange={(e) => setFondoInicialInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") abrirCaja();
                }}
              />
              {aperturaError && <p className="tz-error">{aperturaError}</p>}
              <button
                className="tz-submit-btn"
                onClick={abrirCaja}
                disabled={aperturaSaving}
                style={{ marginTop: 10 }}
              >
                {aperturaSaving ? (
                  <Loader2 size={16} className="tz-spin" />
                ) : (
                  <DollarSign size={16} />
                )}
                Abrir Caja
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- HEADER ---------------- */}
      <header className="tz-header">
        <div className="tz-header-row">
          <div className="tz-header-side tz-header-side-left">
            <button
              className="tz-header-btn"
              onClick={() => setLibretaOpen(true)}
              aria-label="Libreta (Fiados)"
            >
              <BookOpen size={19} />
              <span className="tz-header-btn-label">Fiados</span>
            </button>
            <button
              className="tz-header-btn"
              onClick={() => setTopClientesOpen(true)}
              aria-label="Top Clientes"
            >
              <Trophy size={19} />
              <span className="tz-header-btn-label">Top Clientes</span>
            </button>
          </div>

          <div className="tz-header-center">
            <LogoEasterEgg src={logo} alt="TONAZO!" className="tz-logo" />
            <p className="tz-subtitle">Caja Registradora</p>
          </div>

          <div className="tz-header-side tz-header-side-right">
            <button
              className="tz-header-btn"
              onClick={signOut}
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut size={19} />
              <span className="tz-header-btn-label">Salir</span>
            </button>

            {/* "Pagos" muestra totales de recaudación por método — es
               información financiera, se oculta para el cajero. */}
            {isAdmin && (
              <div className="tz-header-payment-wrap" ref={paymentMenuRef}>
                <button
                  className="tz-header-btn"
                  onClick={() => setPaymentMenuOpen((o) => !o)}
                  aria-label="Métodos de pago"
                >
                  <Wallet size={19} />
                  <span className="tz-header-btn-label">Pagos</span>
                </button>

                {paymentMenuOpen && (
                  <div className="tz-payment-menu">
                    {PAYMENT_METHODS.map((m) => (
                      <button
                        key={m.key}
                        className="tz-payment-menu-item"
                        onClick={() => openMethodModal(m.key)}
                      >
                        <CreditCard size={14} />
                        {m.label}
                        {methodStats[m.key].todayTotal > 0 && (
                          <span className="tz-payment-menu-amount">
                            {formatSoles(methodStats[m.key].todayTotal)}
                          </span>
                        )}
                      </button>
                    ))}
                    <button
                      className="tz-payment-menu-item"
                      onClick={() => {
                        setPaymentMenuOpen(false);
                        setFiadosViewOpen(true);
                      }}
                    >
                      <BookOpen size={14} />
                      Fiados
                      {todayStats.fiadoPagosHoy > 0 && (
                        <span className="tz-payment-menu-amount">
                          {formatSoles(todayStats.fiadoPagosHoy)}
                        </span>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Gestión de personal: exclusivo del admin, un cajero no
               puede crear otros cajeros. */}
            {isAdmin && (
              <button
                className="tz-header-btn"
                onClick={() => {
                  setUsuarioActionError("");
                  setCajerosOpen(true);
                }}
                aria-label="Usuarios"
              >
                <Users size={19} />
                <span className="tz-header-btn-label">Usuarios</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="tz-main">
        {/* ---------------- STATS (solo admin: info financiera) ---------------- */}
        {isAdmin && (
          <section className="tz-stats">
            <div className="tz-stat-chip">
              <span className="tz-stat-label">Recaudado hoy</span>
              <span className="tz-stat-value tz-pink">{formatSoles(todayStats.recaudadoTotal)}</span>
              {todayStats.manualToday > 0 && (
                <span className="tz-stat-sub">
                  incluye {formatSoles(todayStats.manualToday)} manual
                </span>
              )}
            </div>
            <div className="tz-stat-chip">
              <span className="tz-stat-label">Productos vendidos</span>
              <span className="tz-stat-value tz-cyan">{todayStats.items}</span>
            </div>
            <div className="tz-stat-chip">
              <span className="tz-stat-label">Ventas registradas</span>
              <span className="tz-stat-value tz-yellow">{todayStats.purchaseCount}</span>
            </div>
            <div className="tz-stat-chip tz-stat-chip-green">
              <span className="tz-stat-label">
                <TrendingUp size={13} /> Ganancia Neta (hoy)
              </span>
              <span className="tz-stat-value tz-green">{formatSoles(todayStats.gananciaNetaTurno)}</span>
              <span className="tz-stat-sub">
                {todayStats.gastosHoyCaja > 0
                  ? `− ${formatSoles(todayStats.gastosHoyCaja)} gastos`
                  : ""}
              </span>
            </div>
            <div className="tz-stat-chip tz-stat-chip-star">
              <span className="tz-stat-label">
                <Star size={13} /> Producto Estrella
              </span>
              <span className="tz-stat-value tz-star-text">
                {bestSellerId ? productsById[bestSellerId].name : "Aún sin ventas"}
              </span>
              {bestSellerId && (
                <span className="tz-stat-sub">
                  {productStats[bestSellerId].unitsSold} unidades vendidas
                </span>
              )}
            </div>
            <div className="tz-stat-chip">
              <span className="tz-stat-label">
                <Receipt size={13} /> Ticket General
              </span>
              <span className="tz-stat-value tz-cyan">{formatSoles(todayStats.avgTicket)}</span>
              <span className="tz-stat-sub">promedio por venta, hoy</span>
            </div>
          </section>
        )}

        {/* ---------------- BUSCADOR GLOBAL + ESCÁNER RÁPIDO ---------------- */}
        {sections.length > 0 && (
          <section className="tz-global-search">
            <div className="tz-vis-search-row" ref={globalSearchRef}>
              <div className="tz-global-search-wrap">
                <input
                  type="text"
                  className="tz-text-input"
                  placeholder="Buscar producto por nombre para vender…"
                  value={globalSearchTerm}
                  onChange={(e) => {
                    setGlobalSearchTerm(e.target.value);
                    setGlobalSearchOpen(true);
                  }}
                  onFocus={() => setGlobalSearchOpen(true)}
                />
                {globalSearchOpen && globalSearchResults.length > 0 && (
                  <div className="tz-global-search-dropdown">
                    {globalSearchResults.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        className="tz-global-search-item"
                        onClick={() => handleGlobalSearchSelect(p)}
                      >
                        <span className="tz-global-search-item-name">{p.name}</span>
                        <span className="tz-global-search-item-meta">
                          {formatSoles(p.price)} · {p.sectionLabel}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="tz-scan-btn tz-vis-scan-btn"
                onClick={() => {
                  setGlobalScanError("");
                  setGlobalScannerOpen(true);
                }}
                disabled={globalScanBusy}
                aria-label="Escanear producto"
                title="Escanear producto"
              >
                {globalScanBusy ? <Loader2 size={16} className="tz-spin" /> : <ScanLine size={16} />}
              </button>
            </div>
            {globalScanError && <p className="tz-error">{globalScanError}</p>}
          </section>
        )}

        {/* ---------------- TABS ---------------- */}
        {sections.length > 0 && (
          <nav className="tz-tabs">
            {sections.map((s) => (
              <button
                key={s.key}
                className={`tz-tab ${activeTab === s.key ? "tz-tab-active" : ""} ${
                  s.label.trim().toLowerCase() === "combos" ? "tz-tab-combos" : ""
                }`}
                onClick={() => setActiveTab(s.key)}
              >
                {s.label}
              </button>
            ))}
          </nav>
        )}

        {/* ---------------- PRODUCTOS ---------------- */}
        <section className="tz-products">
          {!activeSection ? (
            <div className="tz-empty">
              <p>
                Aún no hay categorías ni productos cargados en Supabase. Corre el script de
                migración (o agrega filas a mano en las tablas 'categorias' y 'productos') y
                recarga la página.
              </p>
            </div>
          ) : (
            activeSection.groups.map((group, gi) => (
              <div key={gi} className="tz-group">
              {group.title && (
                <div className="tz-group-heading">
                  <span className="tz-badge">{group.numero}</span>
                  <h2>{group.title}</h2>
                </div>
              )}
              <div className="tz-grid">
                {(sectionEntriesByGi.get(gi) || []).map((entry) => {
                  if (entry.type === "group") {
                    const { baseName, variants } = entry;
                    const avails = variants.map((v) => availabilityFor(v, stock));
                    const totalAvail = avails.reduce((sum, a) => sum + (a > 0 ? a : 0), 0);
                    const allSoldOut = avails.every((a) => a <= 0);
                    // "Crítico a nivel familia": alguna variante tocó 0
                    // (aunque otras tengan de sobra) o alguna quedó en
                    // el umbral de poco stock — la tarjeta maestra debe
                    // avisar aunque el TOTAL sumado se vea saludable.
                    const anyCritical = avails.some((a) => a <= LOW_STOCK_THRESHOLD);
                    const prices = variants.map((v) => v.price);
                    const minPrice = Math.min(...prices);
                    const maxPrice = Math.max(...prices);
                    const isStar = variants.some((v) => v.id === bestSellerId);

                    return (
                      <div
                        key={baseName}
                        className={`tz-card tz-card-group ${
                          allSoldOut ? "tz-card-disabled" : ""
                        } ${isStar ? "tz-card-star" : ""}`}
                        onClick={() => !allSoldOut && setVariantModalGroup({ baseName, variants })}
                      >
                        {isStar && (
                          <div className="tz-star-ribbon">
                            <Star size={11} strokeWidth={2.5} /> ESTRELLA
                          </div>
                        )}
                        {/* Sin imagen acá a propósito: esta tarjeta representa
                           VARIAS variantes con empaque/color distinto entre sí
                           — una sola foto "representativa" confundiría más de
                           lo que ayuda. Cada variante tiene su propia mini
                           imagen dentro del modal "¿Qué variante?" de abajo. */}
                        <div className="tz-card-top">
                          <div className="tz-card-info">
                            <h3 className="tz-card-name">{baseName}</h3>
                            <p className="tz-card-detail">{variants.length} variantes</p>
                          </div>
                        </div>
                        <div className="tz-card-bottom">
                          {variants.some((v) => v.color) && (
                            <div className="tz-variant-dots">
                              {variants.slice(0, 8).map((v) => {
                                const vAvail = availabilityFor(v, stock);
                                const vSoldOut = vAvail <= 0;
                                return (
                                  <span
                                    key={v.id}
                                    className={`tz-variant-dot ${vSoldOut ? "tz-variant-dot-soldout" : ""}`}
                                    style={{ background: v.color || "var(--border-soft)" }}
                                    title={`${v.variant || v.name}${vSoldOut ? " (agotado)" : ""}`}
                                  />
                                );
                              })}
                            </div>
                          )}
                          <div className="tz-card-stockrow">
                            {allSoldOut ? (
                              <span className="tz-tag tz-tag-danger">AGOTADO</span>
                            ) : anyCritical ? (
                              <span className="tz-tag tz-tag-danger">
                                <AlertTriangle size={11} strokeWidth={2.5} /> Stock: {totalAvail} ·
                                variante(s) con poco stock
                              </span>
                            ) : (
                              <span className="tz-tag tz-tag-ok">Stock: {totalAvail}</span>
                            )}
                          </div>
                          <div className="tz-card-priceqty">
                            <div className="tz-price-block">
                              <span className="tz-price-label">Precio</span>
                              <span className="tz-price">
                                {minPrice === maxPrice
                                  ? formatSoles(minPrice)
                                  : `${formatSoles(minPrice)} - ${formatSoles(maxPrice)}`}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const item = entry.item;
                  const avail = availabilityFor(item, stock);
                  const checked = selection[item.id] != null;
                  const qty = selection[item.id] ?? 1;
                  const soldOut = avail <= 0;
                  const isStar = item.id === bestSellerId;

                  return (
                    <div
                      key={item.id}
                      className={`tz-card ${checked ? "tz-card-checked" : ""} ${
                        soldOut ? "tz-card-disabled" : ""
                      } ${isStar ? "tz-card-star" : ""} ${item.esCombo ? "tz-card-combo" : ""}`}
                      onClick={() => toggleProduct(item)}
                    >
                      {isStar && (
                        <div className="tz-star-ribbon">
                          <Star size={11} strokeWidth={2.5} /> ESTRELLA
                        </div>
                      )}

                      <div className="tz-card-row">
                        <ProductImage item={item} editable={isAdmin} onManage={openImageManager} />

                        <div className="tz-card-main">
                          <div className="tz-card-top">
                            <div className="tz-card-info">
                              {item.combo && <span className="tz-combo">{item.combo}</span>}
                              <h3 className="tz-card-name">
                                {item.name.split(/(\+)/).map((part, i) =>
                                  part === "+" ? (
                                    <span className="tz-name-plus" key={i}>
                                      +
                                    </span>
                                  ) : (
                                    <span key={i}>{part}</span>
                                  )
                                )}
                              </h3>
                              <CardDetail item={item} />
                              <ComboIngredients item={item} productsById={productsById} />
                            </div>
                            <div className="tz-card-top-actions">
                              {(isAdmin || isCajero) && (
                                <button
                                  type="button"
                                  className={`tz-card-discount-btn ${
                                    discounts[item.id] ? "tz-card-discount-btn-active" : ""
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openDiscountModal(item);
                                  }}
                                  aria-label={`Descuento para ${item.name}`}
                                  title="Descuento"
                                >
                                  <Percent size={13} />
                                </button>
                              )}
                              {isAdmin && (
                                <button
                                  type="button"
                                  className="tz-card-edit-price-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openPriceEdit(item);
                                  }}
                                  aria-label={`Editar precio de ${item.name}`}
                                  title="Editar precio"
                                >
                                  <Pencil size={13} />
                                </button>
                              )}
                              <div className={`tz-checkbox ${checked ? "tz-checkbox-on" : ""}`}>
                                {checked && <Check size={16} strokeWidth={3} />}
                              </div>
                            </div>
                          </div>

                          <div className="tz-card-bottom">
                            <div className="tz-card-stockrow">
                              <StockTag avail={avail} />
                            </div>

                            <div className="tz-card-priceqty">
                              {checked && (
                                <div
                                  className="tz-qty-stepper"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    onClick={() => changeQty(item, -1)}
                                    disabled={qty <= 1}
                                    aria-label="Disminuir cantidad"
                                  >
                                    <Minus size={14} />
                                  </button>
                                  <span>{qty}</span>
                                  <button
                                    onClick={() => changeQty(item, 1)}
                                    disabled={qty >= avail}
                                    aria-label="Aumentar cantidad"
                                  >
                                    <Plus size={14} />
                                  </button>
                                </div>
                              )}
                              <div className="tz-price-block">
                                <span className="tz-price-label">Precio</span>
                                {discounts[item.id] ? (
                                  <>
                                    <span className="tz-price-original">
                                      {formatSoles(item.price)}
                                    </span>
                                    <span className="tz-price tz-price-discounted">
                                      {formatSoles(
                                        checked
                                          ? discountedUnitPrice(item) * qty
                                          : discountedUnitPrice(item)
                                      )}
                                    </span>
                                    <span className="tz-discount-badge">
                                      -{discountPercentOf(item)}%
                                    </span>
                                  </>
                                ) : (
                                  <span className="tz-price">
                                    {formatSoles(checked ? item.price * qty : item.price)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            ))
          )}
        </section>

        {/* ---------------- MODAL: ¿QUÉ VARIANTE? (Fase 2) ---------------- */}
        {variantModalGroup && (
          <div
            className="tz-modal-backdrop"
            onClick={() => setVariantModalGroup(null)}
          >
            <div
              className="tz-modal tz-variant-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="tz-modal-close"
                onClick={() => setVariantModalGroup(null)}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
              <h2>{variantModalGroup.baseName}</h2>
              <p className="tz-variant-modal-subtitle">¿Qué variante?</p>
              <div className="tz-variant-grid">
                {variantModalGroup.variants.map((v) => {
                  const avail = availabilityFor(v, stock);
                  const soldOut = avail <= 0;
                  const qtyInCart = selection[v.id] ?? 0;
                  const vDiscount = discounts[v.id];
                  return (
                    <div
                      key={v.id}
                      className={`tz-variant-card ${soldOut ? "tz-variant-btn-disabled" : ""} ${
                        qtyInCart > 0 ? "tz-variant-card-selected" : ""
                      }`}
                      style={
                        v.color && !soldOut
                          ? {
                              borderColor: v.color,
                              boxShadow: `0 0 16px ${v.color}66, inset 0 0 0 1px ${v.color}55`,
                            }
                          : undefined
                      }
                    >
                      <ProductImage item={v} editable={isAdmin} onManage={openImageManager} compact />
                      <div className="tz-variant-card-info">
                        <span
                          className="tz-variant-btn-label"
                          style={v.color && !soldOut ? { color: v.color } : undefined}
                        >
                          {v.variant || v.detail || v.name}
                        </span>
                        {vDiscount ? (
                          <span className="tz-variant-btn-price">
                            <span className="tz-price-original">{formatSoles(v.price)}</span>{" "}
                            <span className="tz-price-discounted">
                              {formatSoles(discountedUnitPrice(v))}
                            </span>
                          </span>
                        ) : (
                          <span className="tz-variant-btn-price">{formatSoles(v.price)}</span>
                        )}
                        <StockTag avail={avail} />
                      </div>
                      <div className="tz-variant-card-actions">
                        {(isAdmin || isCajero) && (
                          <button
                            type="button"
                            className={`tz-card-discount-btn ${vDiscount ? "tz-card-discount-btn-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              openDiscountModal(v);
                            }}
                            aria-label={`Descuento para ${v.name}`}
                            title="Descuento"
                          >
                            <Percent size={13} />
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            type="button"
                            className="tz-card-edit-price-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              openPriceEdit(v);
                            }}
                            aria-label={`Editar precio de ${v.name}`}
                            title="Editar precio"
                          >
                            <Pencil size={13} />
                          </button>
                        )}
                        <button
                          type="button"
                          className="tz-variant-add-btn"
                          disabled={soldOut}
                          onClick={(e) => {
                            e.stopPropagation();
                            selectProductForSale(v);
                          }}
                          aria-label={`Agregar ${v.name} al carrito`}
                          title="Agregar al carrito"
                        >
                          <Plus size={15} />
                          {qtyInCart > 0 && <span className="tz-variant-add-qty">{qtyInCart}</span>}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ---------------- BARRA DE ENVÍO ---------------- */}
        {/* Se oculta por completo cuando no hay nada seleccionado y no hay
           ningún mensaje de error/éxito que mostrar. */}
        {(selectedCount > 0 || submitError || successMsg) && (
          <div className="tz-submitbar" ref={submitBarRef}>
            <div className="tz-submitbar-content">
              {submitError && !successMsg && (
                <p className="tz-error tz-submitbar-message">
                  <AlertTriangle size={16} /> {submitError}
                </p>
              )}
              {successMsg ? (
                <>
                  <p className="tz-success tz-submitbar-message">
                    <Check size={16} /> {successMsg}
                  </p>
                  {lastSale && (
                    <>
                      <a
                        href={buildWhatsappLink(
                          lastSale.whatsapp,
                          buildSaleWhatsappMessage(lastSale)
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className="tz-whatsapp-send-btn"
                      >
                        <MessageCircle size={15} /> Enviar resumen por WhatsApp
                      </a>
                      <button
                        type="button"
                        className="tz-whatsapp-send-btn tz-whatsapp-send-btn-solid"
                        onClick={enviarBoletaPorWhatsApp}
                        disabled={boletaSending}
                      >
                        {boletaSending ? (
                          <>
                            <Loader2 size={15} className="tz-spin" /> Generando boleta…
                          </>
                        ) : (
                          <>
                            <MessageCircle size={15} /> Enviar Boleta por WhatsApp
                          </>
                        )}
                      </button>
                      {boletaError && <p className="tz-error">{boletaError}</p>}

                      {/* ---- ticket oculto: fuera de pantalla, solo existe
                         para que html2canvas lo capture como imagen ---- */}
                      <div ref={ticketRef} style={{ position: "absolute", left: -9999, top: 0 }}>
                        <TicketBoleta
                          orden={{
                            id: lastSale.purchaseId,
                            fecha: formatDate(lastSale.timestamp),
                            hora: formatTime(lastSale.timestamp),
                            cajero: cajeroNombre || (isAdmin ? "Admin" : "Cajero"),
                          }}
                          cliente={{ nombre: lastSale.nombre }}
                          productos={lastSale.items.map((it) => ({
                            cantidad: it.qty,
                            nombre: it.detail ? `${it.name} · ${it.detail}` : it.name,
                            precioUnitario: it.price,
                            subtotal: it.total,
                          }))}
                          totales={{
                            totalPagar: lastSale.total,
                            metodoPago: lastSale.metodoPago,
                          }}
                        />
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="tz-cart-list">
                    {selectedIds.map((id) => {
                      const product = productsById[id];
                      const qty = selection[id];
                      const avail = availabilityFor(product, stock);
                      return (
                        <CartRow
                          key={id}
                          product={product}
                          qty={qty}
                          avail={avail}
                          unitPrice={discountedUnitPrice(product)}
                          discountPercent={discountPercentOf(product)}
                          onQtyChange={(newQty) =>
                            setSelection((prev) => ({ ...prev, [id]: newQty }))
                          }
                          onRemove={() => removeFromCart(id)}
                        />
                      );
                    })}
                  </div>
                  <p className="tz-submitbar-summary">
                    <ShoppingCart size={16} />
                    {`${selectedCount} producto${selectedCount > 1 ? "s" : ""} · ${totalItems} unidad${
                      totalItems > 1 ? "es" : ""
                    } · Total ${formatSoles(totalPrice)}`}
                  </p>
                  {/* ---- Nombre/WhatsApp generales: el flujo de Fiado maneja
                     su propio cliente (con su propio nombre/WhatsApp) más
                     abajo, así que estos dos quedan ocultos ahí para no
                     duplicar/confundir con dos "clientes" distintos en la
                     misma venta. ---- */}
                  {checkoutMetodo !== "FIADO" && (
                    <div className="tz-checkout-crm">
                      <div className="tz-global-search-wrap" ref={checkoutNombreRef}>
                        <input
                          type="text"
                          className="tz-text-input tz-checkout-input"
                          placeholder="Nombre del cliente (opcional)"
                          value={checkoutNombre}
                          onChange={(e) => {
                            setCheckoutNombre(e.target.value);
                            setCheckoutNombreSuggestOpen(true);
                          }}
                          onFocus={() => setCheckoutNombreSuggestOpen(true)}
                        />
                        {checkoutNombreSuggestOpen && checkoutNombreSuggestions.length > 0 && (
                          <div className="tz-global-search-dropdown">
                            {checkoutNombreSuggestions.map((c) => (
                              <button
                                type="button"
                                key={c.id}
                                className="tz-global-search-item"
                                onClick={() => selectCheckoutClienteByNombre(c)}
                              >
                                <span className="tz-global-search-item-name">{c.nombre}</span>
                                {c.whatsapp && (
                                  <span className="tz-global-search-item-meta">{c.whatsapp}</span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="tz-global-search-wrap" ref={checkoutWhatsappRef}>
                        <input
                          type="text"
                          inputMode="tel"
                          className="tz-text-input tz-checkout-input"
                          placeholder="WhatsApp (opcional)"
                          value={checkoutWhatsapp}
                          onChange={(e) => {
                            setCheckoutWhatsapp(e.target.value);
                            setCheckoutWhatsappSuggestOpen(true);
                          }}
                          onFocus={() => setCheckoutWhatsappSuggestOpen(true)}
                        />
                        {checkoutWhatsappSuggestOpen && checkoutWhatsappSuggestions.length > 0 && (
                          <div className="tz-global-search-dropdown">
                            {checkoutWhatsappSuggestions.map((c) => (
                              <button
                                type="button"
                                key={c.id}
                                className="tz-global-search-item"
                                onClick={() => selectCheckoutClienteByWhatsapp(c)}
                              >
                                <span className="tz-global-search-item-name">{c.whatsapp}</span>
                                <span className="tz-global-search-item-meta">{c.nombre}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ---- método de pago: obligatorio antes de poder enviar ---- */}
                  <div className="tz-metodo-pago">
                    <div className="tz-metodo-pago-head">
                      <label className="tz-field-label">Método de pago</label>
                      {checkoutMetodo && (
                        <button className="tz-metodo-pago-change" onClick={resetMetodo}>
                          Cambiar
                        </button>
                      )}
                    </div>
                    <div className="tz-gasto-tipo-buttons">
                      {PAYMENT_METHODS.map((m) => (
                        <button
                          key={m.key}
                          className={`tz-gasto-tipo-btn tz-metodo-btn tz-metodo-btn-${m.key.toLowerCase()} ${
                            checkoutMetodo === m.key ? "tz-gasto-tipo-active" : ""
                          }`}
                          onClick={() => chooseMetodo(m.key)}
                        >
                          {m.label}
                        </button>
                      ))}
                      <button
                        className={`tz-gasto-tipo-btn tz-metodo-btn tz-metodo-btn-efectivo ${
                          checkoutMetodo === "EFECTIVO" ? "tz-gasto-tipo-active" : ""
                        }`}
                        onClick={() => chooseMetodo("EFECTIVO")}
                      >
                        Efectivo
                      </button>
                      <button
                        className={`tz-gasto-tipo-btn tz-metodo-btn tz-metodo-btn-fiado ${
                          checkoutMetodo === "FIADO" ? "tz-gasto-tipo-active" : ""
                        }`}
                        onClick={() => chooseMetodo("FIADO")}
                      >
                        Fiado
                      </button>
                    </div>

                    {/* ---- sub-flujo: Yape / Plin / Otros (escaneo obligatorio).
                       Fiado y Efectivo NO pasan por acá: se procesan directo,
                       sin foto ni monto manual. ---- */}
                    {checkoutMetodo && checkoutMetodo !== "FIADO" && checkoutMetodo !== "EFECTIVO" && (
                      <div className="tz-checkout-scan">
                        {modalView === "camera" && (
                          <div className="tz-camera-view">
                            <video
                              ref={videoRef}
                              className="tz-camera-video"
                              muted
                              playsInline
                              autoPlay
                            />
                            <div className="tz-camera-actions">
                              <button className="tz-scan-btn" onClick={captureFromCamera}>
                                <Camera size={16} /> Capturar y leer
                              </button>
                              <button
                                className="tz-camera-cancel"
                                onClick={() => {
                                  stopCamera();
                                  setManualAmount(totalPrice.toFixed(2));
                                  setModalView("manual");
                                }}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}

                        {modalView === "processing" && (
                          <div className="tz-scan-processing">
                            <Loader2 size={26} className="tz-spin" />
                            <p>Leyendo comprobante con OCR…</p>
                          </div>
                        )}

                        {(modalView === "manual" || modalView === "review") && (
                          <>
                            {modalView === "review" && (
                              <div className="tz-scan-result">
                                <p className="tz-scan-result-title">
                                  <Check size={14} /> Comprobante detectado
                                </p>
                                <div className="tz-scan-result-row">
                                  <span>Método:</span>
                                  <strong>{scanDetected.method || "OTROS"}</strong>
                                </div>
                                <div className="tz-scan-result-row">
                                  <span>ID operación:</span>
                                  <strong>{scanDetected.opId || "No detectado"}</strong>
                                </div>
                                <div className="tz-scan-result-row">
                                  <span>Foto:</span>
                                  <strong>
                                    {photoUploading
                                      ? "Subiendo…"
                                      : scanDetected.photoUrl
                                      ? "Guardada ✓"
                                      : "No se pudo subir"}
                                  </strong>
                                </div>
                              </div>
                            )}
                            {photoUploadError && (
                              <p className="tz-error">
                                <AlertTriangle size={14} /> La foto no se subió:{" "}
                                {photoUploadError}
                              </p>
                            )}
                            <label className="tz-field-label">Monto recibido (S/)</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              className="tz-amount-input"
                              placeholder="0.00"
                              value={manualAmount}
                              onChange={(e) => handleManualAmountChange(e.target.value)}
                            />
                            {manualAmount &&
                              (Math.abs(parseFloat(manualAmount) - totalPrice) > 0.009 ? (
                                <p className="tz-error">
                                  <AlertTriangle size={14} /> Debe ser exacto:{" "}
                                  {formatSoles(totalPrice)} (total de la venta).
                                </p>
                              ) : (
                                <p className="tz-camera-note tz-monto-ok">
                                  <Check size={13} /> Coincide con el total de la venta.
                                </p>
                              ))}
                            <button className="tz-scan-btn" onClick={startCamera}>
                              <Camera size={16} />
                              {modalView === "review"
                                ? "Escanear otro comprobante"
                                : "Escanear comprobante"}
                            </button>
                            {!cameraSupported && (
                              <p className="tz-camera-note">
                                No se pudo acceder a la cámara; se abrirá el selector de fotos.
                              </p>
                            )}
                            {scanError && <p className="tz-error">{scanError}</p>}
                          </>
                        )}
                      </div>
                    )}

                    {/* ---- sub-flujo: Fiado (elegir o crear cliente) ---- */}
                    {checkoutMetodo === "FIADO" && (
                      <div className="tz-checkout-fiado">
                        {clientes.length > 0 && !checkoutFiadoAddingNew && (
                          <select
                            className="tz-text-input"
                            value={checkoutFiadoClienteId || ""}
                            onChange={(e) => setCheckoutFiadoClienteId(e.target.value || null)}
                          >
                            <option value="">Elige un cliente…</option>
                            {clientes.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nombre}
                              </option>
                            ))}
                          </select>
                        )}

                        {!checkoutFiadoAddingNew ? (
                          <button
                            className="tz-gasto-add-item"
                            onClick={() => setCheckoutFiadoAddingNew(true)}
                          >
                            <Plus size={13} /> Nuevo cliente
                          </button>
                        ) : (
                          <div className="tz-checkout-fiado-new">
                            <input
                              type="text"
                              className="tz-text-input"
                              placeholder="Nombre del nuevo cliente"
                              value={checkoutFiadoNewName}
                              onChange={(e) => setCheckoutFiadoNewName(e.target.value)}
                              autoFocus
                            />
                            <input
                              type="text"
                              inputMode="numeric"
                              className="tz-text-input"
                              placeholder="Celular (será su usuario para iniciar sesión)"
                              value={checkoutFiadoNewWhatsapp}
                              onChange={(e) => setCheckoutFiadoNewWhatsapp(e.target.value)}
                            />
                            <input
                              type="text"
                              inputMode="numeric"
                              className="tz-text-input"
                              placeholder="PIN (4 a 10 dígitos)"
                              value={checkoutFiadoNewPin}
                              onChange={(e) => setCheckoutFiadoNewPin(e.target.value)}
                            />
                            <div className="tz-add-entry-actions">
                              <button
                                className="tz-camera-cancel"
                                onClick={() => {
                                  setCheckoutFiadoAddingNew(false);
                                  setCheckoutFiadoNewName("");
                                  setCheckoutFiadoNewWhatsapp("");
                                  setCheckoutFiadoNewPin("");
                                }}
                              >
                                Cancelar
                              </button>
                              <button
                                className="tz-pw-submit tz-payment-save"
                                onClick={saveCheckoutFiadoCliente}
                                disabled={checkoutFiadoSaving}
                              >
                                {checkoutFiadoSaving ? (
                                  <Loader2 size={16} className="tz-spin" />
                                ) : (
                                  <Save size={16} />
                                )}
                                Crear
                              </button>
                            </div>
                          </div>
                        )}

                        {checkoutFiadoClienteId && (
                          <p className="tz-checkout-fiado-selected">
                            <Check size={13} /> Se fiará a{" "}
                            <strong>
                              {clientes.find((c) => c.id === checkoutFiadoClienteId)?.nombre}
                            </strong>
                          </p>
                        )}
                      </div>
                    )}

                    {/* ---- sub-flujo: Efectivo (calculadora de vuelto) ---- */}
                    {checkoutMetodo === "EFECTIVO" && (
                      <div className="tz-checkout-fiado">
                        <label className="tz-field-label">Monto recibido (S/)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="tz-amount-input"
                          placeholder="0.00"
                          value={montoRecibido}
                          onChange={(e) => handleMontoRecibidoChange(e.target.value)}
                          autoFocus
                        />
                        <div className="tz-vuelto-quick-buttons">
                          {MONTOS_RAPIDOS.map((m) => (
                            <button
                              type="button"
                              key={m}
                              className="tz-vuelto-quick-btn"
                              onClick={() => setMontoRecibido(String(m))}
                            >
                              S/ {m}
                            </button>
                          ))}
                        </div>
                        {(() => {
                          const recibidoNum = parseFloat(montoRecibido);
                          if (montoRecibido === "" || isNaN(recibidoNum)) return null;
                          const vuelto = recibidoNum - totalPrice;
                          if (vuelto < -0.009) {
                            return (
                              <p className="tz-error">
                                <AlertTriangle size={14} /> Falta{" "}
                                {formatSoles(Math.abs(vuelto))} para cubrir el total.
                              </p>
                            );
                          }
                          return (
                            <p className="tz-vuelto-display">
                              VUELTO: <strong>{formatSoles(Math.max(vuelto, 0))}</strong>
                            </p>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
            {isPaymentStepComplete && !successMsg && (
              <button
                className="tz-submit-btn"
                onClick={handleSubmit}
                disabled={ventaSubmitting}
              >
                {ventaSubmitting ? (
                  <>
                    <Loader2 size={16} className="tz-spin" /> Procesando...
                  </>
                ) : (
                  "Enviar Venta"
                )}
              </button>
            )}
          </div>
        )}

        {/* ---------------- HISTORIAL ---------------- */}
        <section className="tz-history">
          <div className="tz-history-heading">
            <Receipt size={20} />
            <h2>Historial de Ventas</h2>
          </div>

          {sales.length === 0 ? (
            <div className="tz-empty">
              <p>Todavía no se registró ninguna venta.</p>
              <p className="tz-empty-sub">
                Marca un producto arriba, elige la cantidad y presiona “Enviar Venta”.
              </p>
            </div>
          ) : (
            <>
              <div className="tz-table-wrap">
                <table className="tz-table">
                  <thead>
                    <tr>
                      <th>ID Compra</th>
                      <th>Producto</th>
                      <th>Detalle</th>
                      <th>Cant.</th>
                      <th>Precio</th>
                      <th>Método de Pago</th>
                      <th>Vendedor</th>
                      <th>Hora</th>
                      <th>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Colapsado por defecto: solo las 5 ventas más
                       recientes ('sales' ya viene ordenado del más
                       nuevo al más viejo) — evita que este historial
                       empuje el resto del dashboard hacia abajo. */}
                    {(historialExpanded ? sales : sales.slice(0, 5)).map((s) => (
                      <tr key={s.saleId}>
                        <td className="tz-id-cell">{s.purchaseId}</td>
                        <td>{s.name}</td>
                        <td className="tz-dim-cell">{s.detail || "—"}</td>
                        <td>{s.qty}</td>
                        <td className="tz-pink-cell">{formatSoles(s.total)}</td>
                        <td>
                          {s.metodoPago ? (
                            <span
                              className={`tz-metodo-tag tz-metodo-tag-${s.metodoPago.toLowerCase()}`}
                            >
                              {s.metodoPago}
                            </span>
                          ) : (
                            <span className="tz-dim-cell">—</span>
                          )}
                        </td>
                        <td className="tz-dim-cell">{s.vendedor || "—"}</td>
                        <td className="tz-dim-cell">{formatTime(s.timestamp)}</td>
                        <td className="tz-dim-cell">{formatDate(s.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sales.length > 5 && (
                <button
                  type="button"
                  className="tz-history-toggle-btn"
                  onClick={() => setHistorialExpanded((prev) => !prev)}
                >
                  {historialExpanded ? (
                    <>🔼 Ocultar</>
                  ) : (
                    <>🔽 Ver historial completo ({sales.length})</>
                  )}
                </button>
              )}
            </>
          )}
        </section>
      </main>

      {/* ---------------- PIE DE PÁGINA (Cerrar Caja / Gastos / Editar Stock) ---------------- */}
      {/* Antes eran botones flotantes (position: fixed) que en móvil
         terminaban tapando el formulario de checkout al crecer (más
         campos = más alto). Ahora viven en el flujo normal del
         documento, al final de la página — igual que ya se hizo con
         el header — así es estructuralmente imposible que tapen nada. */}
      <footer className="tz-page-footer">
        <button
          className="tz-footer-btn tz-footer-btn-cierre"
          onClick={() => {
            setCierreModalOpen(true);
            setConfirmCierreOpen(false);
            setCierreError("");
            setEfectivoReal("");
          }}
        >
          <Receipt size={18} />
          Cerrar Caja
        </button>
        <button
          className="tz-footer-btn tz-footer-btn-gastos"
          onClick={() => {
            setGastosOpen(true);
            setGastoFormOpen(false);
          }}
        >
          <TrendingDown size={18} />
          Gastos
        </button>
        <button className="tz-footer-btn tz-footer-btn-stock" onClick={openEdit}>
          <Pencil size={18} />
          Editar Stock
        </button>
        <button
          className="tz-footer-btn tz-footer-btn-misventas"
          onClick={() => {
            setMisVentasOpen(true);
            setAnularError("");
          }}
        >
          <Receipt size={18} />
          Mis Ventas
        </button>
      </footer>

      {/* ---------------- MODAL EDICIÓN DE STOCK ---------------- */}
      {editOpen && (
        <div className="tz-modal-backdrop" onClick={closeEdit}>
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button className="tz-modal-close" onClick={closeEdit} aria-label="Cerrar">
              <X size={18} />
            </button>

            <div className="tz-stock-editor">
              <h2>Agregar unidades al stock</h2>

              {isAdmin && !newProductoOpen && (
                <button
                  type="button"
                  className="tz-new-combo-btn"
                  onClick={openComboModal}
                >
                  <Plus size={16} /> Nuevo Combo
                </button>
              )}

              {newProductoOpen ? (
                <div className="tz-add-entry">
                  <p className="tz-stock-editor-sub">
                    {newProductoCodigo
                      ? "Ese código no existe todavía — completa estos datos para crear el producto. Va a quedar listo para sumarle stock apenas lo guardes."
                      : "Creando un producto nuevo sin código de barras — completa estos datos. Va a quedar listo para sumarle stock apenas lo guardes."}
                  </p>

                  {newProductoCodigo && (
                    <>
                      <label className="tz-field-label">Código escaneado</label>
                      <input
                        type="text"
                        className="tz-text-input"
                        value={newProductoCodigo}
                        readOnly
                      />
                    </>
                  )}

                  <label className="tz-field-label">Nombre Base</label>
                  <input
                    type="text"
                    autoFocus
                    className="tz-text-input"
                    placeholder="Ej. Hey FIT, Zaphitos"
                    value={newProductoNombre}
                    onChange={(e) => setNewProductoNombre(e.target.value)}
                  />

                  <label className="tz-field-label">Sabor / Variedad (opcional)</label>
                  <input
                    type="text"
                    className="tz-text-input"
                    placeholder="Ej. Fresa, Azul"
                    value={newProductoVariante}
                    onChange={(e) => setNewProductoVariante(e.target.value)}
                  />

                  <label className="tz-field-label">Presentación / Medida (opcional)</label>
                  <input
                    type="text"
                    className="tz-text-input"
                    placeholder="Ej. 600ml, 50g"
                    value={newProductoPresentacion}
                    onChange={(e) => setNewProductoPresentacion(e.target.value)}
                  />

                  <ColorPicker value={newProductoColor} onChange={setNewProductoColor} />

                  <label className="tz-field-label">Precio de venta (S/)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.10"
                    className="tz-text-input"
                    placeholder="0.00"
                    value={newProductoPrecio}
                    onChange={(e) => setNewProductoPrecio(e.target.value)}
                  />

                  <p className="tz-field-label" style={{ marginTop: 8 }}>
                    Stock inicial (para el Costo Promedio Ponderado desde el día 1)
                  </p>
                  <div className="tz-stock-cost-inputs">
                    <label className="tz-stock-cost-field">
                      <span>Unidades que ingresan</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0"
                        value={newProductoUnidades}
                        onChange={(e) => setNewProductoUnidades(e.target.value)}
                      />
                    </label>
                    <label className="tz-stock-cost-field">
                      <span>Costo TOTAL de esta compra (S/)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={newProductoCostoTotal}
                        onChange={(e) => setNewProductoCostoTotal(e.target.value)}
                      />
                    </label>
                  </div>
                  {(() => {
                    const unidadesNum = parseFloat(newProductoUnidades);
                    const costoTotalNum = parseFloat(newProductoCostoTotal);
                    const costoUnitario =
                      unidadesNum > 0 && !isNaN(costoTotalNum) && costoTotalNum >= 0
                        ? costoTotalNum / unidadesNum
                        : null;
                    return (
                      costoUnitario != null && (
                        <p className="tz-stock-cost-hint">
                          Costo unitario: {formatSoles(costoUnitario)}
                        </p>
                      )
                    );
                  })()}

                  <label className="tz-field-label">Categoría / Sección</label>
                  <input
                    type="text"
                    list="tz-categoria-options"
                    className="tz-text-input"
                    placeholder="Elige una existente o escribe una nueva"
                    value={newProductoCategoria}
                    onChange={(e) => {
                      setNewProductoCategoria(e.target.value);
                      // Blindaje: si borran la categoría, el subgrupo
                      // queda huérfano — se limpia para no arrastrar un
                      // subgrupo de otra categoría por error.
                      if (!e.target.value.trim()) setNewProductoSubgrupo("");
                    }}
                  />
                  <datalist id="tz-categoria-options">
                    {sections.map((s) => (
                      <option key={s.key} value={s.label} />
                    ))}
                  </datalist>

                  <label className="tz-field-label">Subgrupo (opcional)</label>
                  <input
                    type="text"
                    list="tz-subgrupo-options"
                    className="tz-text-input"
                    placeholder={
                      newProductoCategoria.trim()
                        ? "Elige uno existente o escribe uno nuevo"
                        : "Primero elige una categoría"
                    }
                    value={newProductoSubgrupo}
                    onChange={(e) => setNewProductoSubgrupo(e.target.value)}
                    disabled={!newProductoCategoria.trim()}
                  />
                  <p className="tz-field-hint">
                    Nota: Si creas un subgrupo nuevo, inicia el nombre con un número (ej. "03
                    Nuevo Pack") para mantener el orden en el catálogo.
                  </p>
                  <datalist id="tz-subgrupo-options">
                    {(() => {
                      // Blindaje: SOLO se sugieren subgrupos que ya
                      // existen dentro de la categoría elegida — nunca
                      // los de otras categorías (evita, ej., colgar un
                      // producto de "Bebidas" bajo "Pack con Whisky").
                      const categoriaTrim = newProductoCategoria.trim().toLowerCase();
                      const matchingSection = sections.find(
                        (s) => s.label.trim().toLowerCase() === categoriaTrim
                      );
                      const groups = matchingSection
                        ? matchingSection.groups.filter((g) => g.title)
                        : [];
                      return groups
                        // Mismo orden natural/numérico que ya aplica
                        // buildSectionsFromRows al renderizar el
                        // catálogo — para que las sugerencias reflejen
                        // el mismo orden.
                        .sort((a, b) => {
                          if (!a.numero) return 1;
                          if (!b.numero) return -1;
                          return a.numero.localeCompare(b.numero, undefined, { numeric: true });
                        })
                        .map((g) => <option key={g.title} value={g.title} />);
                    })()}
                  </datalist>

                  {newProductoError && <p className="tz-error">{newProductoError}</p>}

                  <div className="tz-add-entry-actions">
                    <button className="tz-camera-cancel" onClick={resetNewProductoForm}>
                      Cancelar
                    </button>
                    <button
                      className="tz-pw-submit tz-payment-save"
                      onClick={saveNewProducto}
                      disabled={newProductoSaving}
                    >
                      {newProductoSaving ? (
                        <Loader2 size={16} className="tz-spin" />
                      ) : (
                        <Save size={16} />
                      )}
                      Crear producto
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="tz-vis-search-row" style={{ marginBottom: 4 }}>
                    <input
                      type="text"
                      className="tz-text-input"
                      placeholder="Buscar producto por nombre…"
                      value={stockSearchTerm}
                      onChange={(e) => {
                        setStockSearchTerm(e.target.value);
                        setScannedStockKey(null);
                      }}
                    />
                    <button
                      type="button"
                      className="tz-scan-btn tz-vis-scan-btn"
                      onClick={() => {
                        setStockScanError("");
                        setStockScannerOpen(true);
                      }}
                      disabled={stockScanBusy}
                      aria-label="Escanear producto"
                      title="Escanear producto"
                    >
                      {stockScanBusy ? (
                        <Loader2 size={16} className="tz-spin" />
                      ) : (
                        <ScanLine size={16} />
                      )}
                    </button>
                  </div>
                  {stockScanError && <p className="tz-error">{stockScanError}</p>}

                  {scannedStockKey && (
                    <button
                      type="button"
                      className="tz-camera-cancel"
                      style={{ marginBottom: 10 }}
                      onClick={() => setScannedStockKey(null)}
                    >
                      <X size={13} /> Quitar filtro de escaneo
                    </button>
                  )}

                  {(() => {
                    const hasQuery = scannedStockKey || stockSearchTerm.trim();
                    const queryLower = stockSearchTerm.trim().toLowerCase();

                    // Busca sobre 'productsById' (TODOS los productos,
                    // tengan o no stock cargado todavía) en vez de
                    // 'stock' (solo claves físicas con fila propia) —
                    // así ninguna variante recién creada queda fuera
                    // del buscador solo porque su etiqueta de stock no
                    // calzaba con lo que se escribió.
                    const matches = !hasQuery
                      ? []
                      : Object.values(productsById)
                          .map((item) => ({ item, key: resolveStockKeyFromConsumes(item.consumes) }))
                          .filter(({ key }) => key != null)
                          .filter(({ item, key }) => {
                            if (scannedStockKey) return key === scannedStockKey;
                            return item.name.toLowerCase().includes(queryLower);
                          })
                          .sort((a, b) => a.item.name.localeCompare(b.item.name));

                    // Si todos los resultados actuales comparten UN
                    // mismo nombre_base, se ofrece el flujo rápido de
                    // "variedades existentes + nueva variedad" debajo
                    // de la lista (punto 4 del refactor).
                    const matchedBaseNames = [...new Set(matches.map((m) => m.item.baseName))];
                    const activeBaseName = matchedBaseNames.length === 1 ? matchedBaseNames[0] : null;
                    const baseVariants = activeBaseName
                      ? Object.values(productsById).filter((it) => it.baseName === activeBaseName)
                      : [];
                    const referenceItem = baseVariants[0] || matches[0]?.item || null;

                    if (!hasQuery) {
                      return (
                        <p className="tz-method-history-empty">
                          Escanea un producto o escribe arriba para buscarlo.
                        </p>
                      );
                    }

                    if (matches.length === 0) {
                      return (
                        <div>
                          <p className="tz-method-history-empty">
                            Ningún producto coincide con la búsqueda.
                          </p>
                          {stockSearchTerm.trim() && !scannedStockKey && (
                            <button
                              type="button"
                              className="tz-camera-cancel tz-scanner-upload-btn"
                              onClick={() => {
                                const nombreBuscado = stockSearchTerm.trim();
                                resetNewProductoForm();
                                setNewProductoNombre(nombreBuscado);
                                setNewProductoOpen(true);
                              }}
                            >
                              <Plus size={15} /> Crear nuevo producto: "{stockSearchTerm.trim()}"
                            </button>
                          )}
                        </div>
                      );
                    }

                    return (
                      <>
                        <div className="tz-stock-list">
                          {matches.map(({ item, key }) => {
                            const unidadesNum = parseFloat(stockEdits[key]);
                            const costoTotalNum = parseFloat(stockCostEdits[key]);
                            const costoUnitarioLote =
                              unidadesNum > 0 && !isNaN(costoTotalNum) && costoTotalNum >= 0
                                ? costoTotalNum / unidadesNum
                                : null;
                            const costoActual = stockCostos[key];

                            return (
                              <div className="tz-stock-cost-item" key={item.id}>
                                <div className="tz-stock-row-info">
                                  <span className="tz-stock-row-name">
                                    {item.color && (
                                      <span
                                        className="tz-variant-dot tz-variant-dot-inline"
                                        style={{ background: item.color }}
                                      />
                                    )}
                                    {item.name}
                                  </span>
                                  <span className="tz-stock-row-current">
                                    Stock actual: {stock[key] ?? 0}
                                    {costoActual != null &&
                                      ` · Costo actual: ${formatSoles(costoActual)}/u`}
                                  </span>
                                </div>
                                <div className="tz-stock-cost-inputs">
                                  <label className="tz-stock-cost-field">
                                    <span>Unidades que ingresan</span>
                                    <input
                                      type="number"
                                      min="0"
                                      placeholder="0"
                                      value={stockEdits[key] ?? ""}
                                      onChange={(e) => handleStockEditChange(key, e.target.value)}
                                    />
                                  </label>
                                  <label className="tz-stock-cost-field">
                                    <span>Costo TOTAL de esta compra (S/)</span>
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      placeholder="0.00"
                                      value={stockCostEdits[key] ?? ""}
                                      onChange={(e) => handleStockCostEditChange(key, e.target.value)}
                                    />
                                  </label>
                                </div>
                                {costoUnitarioLote != null && (
                                  <p className="tz-stock-cost-hint">
                                    Costo unitario de este lote: {formatSoles(costoUnitarioLote)}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {activeBaseName && referenceItem && !scannedStockKey && (
                          <div className="tz-variedades-quickadd">
                            <p className="tz-field-label">Variedades de "{activeBaseName}"</p>
                            <div className="tz-variant-chips">
                              {baseVariants.map((v) => (
                                <button
                                  key={v.id}
                                  type="button"
                                  className="tz-variant-chip"
                                  style={v.color ? { borderColor: v.color, color: v.color } : undefined}
                                  onClick={() => setStockSearchTerm(v.name)}
                                >
                                  {v.color && (
                                    <span className="tz-variant-dot" style={{ background: v.color }} />
                                  )}
                                  {v.variant || v.detail || v.name}
                                </button>
                              ))}
                            </div>

                            {nuevaVariedadOpen ? (
                              <div className="tz-vis-confirm-delete">
                                <input
                                  type="text"
                                  className="tz-text-input"
                                  placeholder='Sabor / variedad nueva (ej. "Fresa")'
                                  value={nuevaVariedadSabor}
                                  onChange={(e) => setNuevaVariedadSabor(e.target.value)}
                                  autoFocus
                                />
                                <input
                                  type="text"
                                  className="tz-text-input"
                                  placeholder="Presentación / medida (opcional)"
                                  value={nuevaVariedadPresentacion}
                                  onChange={(e) => setNuevaVariedadPresentacion(e.target.value)}
                                />
                                <ColorPicker value={nuevaVariedadColor} onChange={setNuevaVariedadColor} />
                                {nuevaVariedadError && <p className="tz-error">{nuevaVariedadError}</p>}
                                <div className="tz-vis-confirm-actions">
                                  <button
                                    type="button"
                                    className="tz-cliente-action-btn tz-cliente-action-pago"
                                    onClick={() => saveNuevaVariedad(referenceItem)}
                                    disabled={nuevaVariedadSaving}
                                  >
                                    {nuevaVariedadSaving ? (
                                      <Loader2 size={13} className="tz-spin" />
                                    ) : (
                                      <Check size={13} />
                                    )}
                                    Crear variedad
                                  </button>
                                  <button
                                    type="button"
                                    className="tz-cliente-action-btn"
                                    onClick={resetNuevaVariedadForm}
                                    disabled={nuevaVariedadSaving}
                                  >
                                    <X size={13} /> Cancelar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                type="button"
                                className="tz-camera-cancel tz-scanner-upload-btn"
                                onClick={() => {
                                  resetNuevaVariedadForm();
                                  setNuevaVariedadOpen(true);
                                }}
                              >
                                <Plus size={15} /> Nueva variedad
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {stockSavedMsg && <p className="tz-stock-saved">{stockSavedMsg}</p>}

                  <button
                    className="tz-stock-save"
                    onClick={saveStockEdits}
                    disabled={savingStock}
                  >
                    {savingStock ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
                    Guardar cambios
                  </button>
                </>
              )}

              {/* Visibilidad en Catálogo Público: exclusivo del admin —
                 un cajero solo puede agregar unidades al stock, arriba.
                 Nada de crear/renombrar/eliminar categorías ni tocar
                 qué se ve en el catálogo público. */}
              {isAdmin && (
                <>
                  <h2 className="tz-stock-editor-section">Visibilidad en catálogo público</h2>
                  <p className="tz-stock-editor-sub">
                    Los productos desactivados siguen disponibles para vender acá en el POS, solo
                    se ocultan del catálogo público ("/").
                  </p>
                  {visibilityError && <p className="tz-error">{visibilityError}</p>}

                  <CatalogVisibilityAccordion
                    sections={sections}
                    onToggleVisibility={async (producto, checked) => {
                      setVisibilityError("");
                      const { error } = await setProductVisibility(producto.id, checked);
                      if (error) {
                        setVisibilityError(
                          `No se pudo guardar "${producto.name}". Revisa la política RLS de UPDATE en 'productos'.`
                        );
                      }
                    }}
                    onDelete={eliminarProductoDefinitivo}
                    onSoftDelete={desactivarProductoCatalogo}
                    onEditProducto={editarProductoNombreDetalle}
                    onRenameCategoria={renombrarCategoria}
                    onRenameSubgrupo={renombrarSubgrupo}
                    onDeleteCategoria={eliminarCategoria}
                    onDeleteSubgrupo={eliminarSubgrupo}
                    onCreateCategoria={crearCategoria}
                    onAddVariante={agregarVariante}
                    onReorderCategorias={reorderCategorias}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODAL: NUEVO COMBO ----------------
         Un combo es un producto normal con 'consumos' combinado de sus
         ingredientes — no tiene stock propio, así que no pide unidades
         ni costo inicial (ver crearCombo en productLookup.js). */}
      {comboModalOpen && (
        <div className="tz-modal-backdrop" onClick={() => setComboModalOpen(false)}>
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="tz-modal-close"
              onClick={() => setComboModalOpen(false)}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>

            <h2>Nuevo Combo</h2>
            <p className="tz-stock-editor-sub">
              Elige los productos (o variantes puntuales) que forman el combo y cuántas unidades
              de cada uno lleva. Al vender el combo se descuenta el stock de cada ingrediente
              automáticamente — el combo no tiene stock propio.
            </p>

            <label className="tz-field-label">Nombre del combo</label>
            <input
              type="text"
              autoFocus
              className="tz-text-input"
              placeholder="Ej. Combo Fiesta"
              value={comboNombre}
              onChange={(e) => setComboNombre(e.target.value)}
            />

            <label className="tz-field-label">Precio de venta (S/)</label>
            <input
              type="number"
              min="0"
              step="0.10"
              className="tz-text-input"
              placeholder="0.00"
              value={comboPrecio}
              onChange={(e) => setComboPrecio(e.target.value)}
            />

            <label className="tz-field-label">Categoría</label>
            <input
              type="text"
              list="tz-combo-categoria-options"
              className="tz-text-input"
              placeholder='Ej. "Combos"'
              value={comboCategoria}
              onChange={(e) => setComboCategoria(e.target.value)}
            />
            <datalist id="tz-combo-categoria-options">
              {sections.map((s) => (
                <option key={s.key} value={s.label} />
              ))}
            </datalist>

            <label className="tz-field-label">Subgrupo (opcional)</label>
            <input
              type="text"
              className="tz-text-input"
              placeholder="Opcional"
              value={comboSubgrupo}
              onChange={(e) => setComboSubgrupo(e.target.value)}
            />

            <label className="tz-field-label" style={{ marginTop: 8 }}>
              Ingredientes del combo
            </label>
            <input
              type="text"
              className="tz-text-input"
              placeholder="Buscar producto para agregar…"
              value={comboSearchTerm}
              onChange={(e) => setComboSearchTerm(e.target.value)}
            />

            {comboSearchTerm.trim() &&
              (() => {
                const q = comboSearchTerm.trim().toLowerCase();
                const results = Object.values(productsById)
                  .filter((p) => p.name.toLowerCase().includes(q))
                  .filter((p) => !comboItems.some((it) => it.productId === p.id))
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .slice(0, 8);

                return (
                  <div className="tz-combo-search-results">
                    {results.length === 0 ? (
                      <p className="tz-method-history-empty">Ningún producto coincide.</p>
                    ) : (
                      results.map((p) => (
                        <button
                          type="button"
                          key={p.id}
                          className="tz-combo-search-result"
                          onClick={() => addComboItem(p)}
                        >
                          {p.color && (
                            <span
                              className="tz-variant-dot tz-variant-dot-inline"
                              style={{ background: p.color }}
                            />
                          )}
                          {p.name}
                        </button>
                      ))
                    )}
                  </div>
                );
              })()}

            {comboItems.length > 0 && (
              <div className="tz-combo-items">
                {comboItems.map((it) => (
                  <div className="tz-combo-item" key={it.productId}>
                    <span className="tz-combo-item-name">{it.name}</span>
                    <input
                      type="number"
                      min="1"
                      className="tz-combo-item-qty"
                      value={it.qty}
                      onChange={(e) => setComboItemQty(it.productId, e.target.value)}
                    />
                    <button
                      type="button"
                      className="tz-combo-item-remove"
                      onClick={() => removeComboItem(it.productId)}
                      aria-label={`Quitar ${it.name}`}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {comboError && <p className="tz-error">{comboError}</p>}

            <button
              className="tz-stock-save"
              onClick={saveCombo}
              disabled={comboSaving}
              style={{ marginTop: 14 }}
            >
              {comboSaving ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
              Crear Combo
            </button>
          </div>
        </div>
      )}

      {/* ---------------- MODAL: GESTIÓN DE IMAGEN (solo admin) ----------------
         Se abre al tocar el espacio de imagen de una tarjeta. "Subir
         Foto"/"Tomar Foto" van directo a Storage + productos.imagen_url.
         "Mejorar con IA" quita el fondo en el navegador (@imgly/
         background-removal) y muestra el resultado en un recuadro
         BLANCO ("efecto estudio", ya que el resto de la app es oscura)
         antes de guardarlo — ver handleAiEnhance/confirmAiResult. */}
      {imageManagerProduct && (
        <div className="tz-modal-backdrop" onClick={closeImageManager}>
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button className="tz-modal-close" onClick={closeImageManager} aria-label="Cerrar">
              <X size={18} />
            </button>

            <h2>Gestión de Imagen</h2>
            <p className="tz-stock-editor-sub">{imageManagerProduct.name}</p>

            <div className="tz-image-manager-preview">
              {imageManagerProduct.imagenUrl ? (
                <img src={imageManagerProduct.imagenUrl} alt={imageManagerProduct.name} />
              ) : (
                <div className="tz-product-image-placeholder">
                  <Package size={32} />
                </div>
              )}
            </div>

            {imageUploadError && <p className="tz-error">{imageUploadError}</p>}
            {imageUploading && (
              <p className="tz-stock-editor-sub">
                <Loader2 size={14} className="tz-spin" /> Subiendo imagen…
              </p>
            )}

            {/* Mientras haya un recorte de IA pendiente de confirmar,
               se ocultan Subir/Tomar Foto — obliga a resolver esa
               decisión primero en vez de perder el resultado en
               silencio si el admin sube otra foto encima. */}
            {!aiPreviewBlob && (
              <div className="tz-image-manager-actions">
                <label className="tz-camera-cancel tz-image-manager-btn">
                  <Upload size={15} /> Subir Foto
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={imageUploading || aiProcessing}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      handleUploadFromInput(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                <label className="tz-camera-cancel tz-image-manager-btn">
                  <Camera size={15} /> Tomar Foto
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    disabled={imageUploading || aiProcessing}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      handleUploadFromInput(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            )}

            {!aiPreviewBlob && (
              <button
                type="button"
                className="tz-ai-magic-btn"
                onClick={handleAiEnhance}
                disabled={
                  aiProcessing ||
                  imageUploading ||
                  !(lastUploadedImage || imageManagerProduct.imagenUrl)
                }
              >
                {aiProcessing ? (
                  <>
                    <Loader2 size={16} className="tz-spin" /> Procesando recorte con IA…
                  </>
                ) : (
                  <>
                    <Wand2 size={16} /> Mejorar con IA
                  </>
                )}
              </button>
            )}
            {aiError && <p className="tz-error">{aiError}</p>}

            {aiPreviewUrl && (
              <div className="tz-ai-result">
                <p className="tz-field-label">Vista previa — fondo removido</p>
                <div className="tz-ai-result-preview">
                  <img src={aiPreviewUrl} alt={`${imageManagerProduct.name} sin fondo`} />
                </div>
                <div className="tz-image-manager-actions">
                  <button
                    type="button"
                    className="tz-camera-cancel tz-image-manager-btn"
                    onClick={discardAiPreview}
                    disabled={imageUploading}
                  >
                    <X size={15} /> Descartar
                  </button>
                  <button
                    type="button"
                    className="tz-stock-save tz-image-manager-btn"
                    onClick={confirmAiResult}
                    disabled={imageUploading}
                  >
                    {imageUploading ? (
                      <Loader2 size={15} className="tz-spin" />
                    ) : (
                      <Check size={15} />
                    )}
                    Guardar recorte
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {stockScannerOpen && (
        <BarcodeScannerModal
          onScan={handleStockProductScan}
          onClose={() => setStockScannerOpen(false)}
        />
      )}

      {globalScannerOpen && (
        <BarcodeScannerModal onScan={handleGlobalScan} onClose={() => setGlobalScannerOpen(false)} />
      )}

      {/* ---------------- MODAL: EDITAR PRECIO (solo admin) ---------------- */}
      {editingPriceProduct && (
        <div className="tz-modal-backdrop" onClick={closePriceEdit}>
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button className="tz-modal-close" onClick={closePriceEdit} aria-label="Cerrar">
              <X size={18} />
            </button>
            <div className="tz-add-entry">
              <h2>Editar precio</h2>
              <p className="tz-stock-editor-sub">{editingPriceProduct.name}</p>
              <label className="tz-field-label">Precio de venta (S/)</label>
              <input
                type="number"
                min="0"
                step="0.10"
                autoFocus
                className="tz-text-input"
                value={editingPriceValue}
                onChange={(e) => setEditingPriceValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") savePriceEdit();
                }}
              />
              {editingPriceError && <p className="tz-error">{editingPriceError}</p>}
              <div className="tz-add-entry-actions">
                <button className="tz-camera-cancel" onClick={closePriceEdit}>
                  Cancelar
                </button>
                <button
                  className="tz-pw-submit tz-payment-save"
                  onClick={savePriceEdit}
                  disabled={editingPriceSaving}
                >
                  {editingPriceSaving ? (
                    <Loader2 size={16} className="tz-spin" />
                  ) : (
                    <Save size={16} />
                  )}
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODAL: DESCUENTO (solo admin) ---------------- */}
      {discountModalProduct && (
        <div className="tz-modal-backdrop" onClick={closeDiscountModal}>
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button className="tz-modal-close" onClick={closeDiscountModal} aria-label="Cerrar">
              <X size={18} />
            </button>
            <div className="tz-add-entry">
              <h2>
                <Percent size={17} /> Descuento
              </h2>
              <p className="tz-stock-editor-sub">
                {discountModalProduct.name}
                {discountModalProduct.detail ? ` · ${discountModalProduct.detail}` : ""} — precio
                de catálogo {formatSoles(discountModalProduct.price)}
              </p>

              <div className="tz-discount-type-toggle">
                <button
                  type="button"
                  className={`tz-tab ${discountModalType === "percent" ? "tz-tab-active" : ""}`}
                  onClick={() => setDiscountModalType("percent")}
                >
                  % Porcentaje
                </button>
                <button
                  type="button"
                  className={`tz-tab ${discountModalType === "monto" ? "tz-tab-active" : ""}`}
                  onClick={() => setDiscountModalType("monto")}
                >
                  S/ Monto fijo
                </button>
              </div>

              <label className="tz-field-label">
                {discountModalType === "percent" ? "Porcentaje de descuento (%)" : "Monto a descontar (S/)"}
              </label>
              <input
                type="number"
                min="0"
                max={discountModalType === "percent" ? 100 : discountModalProduct.price}
                step={discountModalType === "percent" ? "1" : "0.10"}
                autoFocus
                className="tz-text-input"
                value={discountModalValue}
                onChange={(e) => setDiscountModalValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveDiscountModal();
                }}
              />

              {discountModalValue && !isNaN(parseFloat(discountModalValue)) && (
                <p className="tz-discount-preview">
                  Precio final:{" "}
                  <strong>
                    {formatSoles(
                      discountModalType === "percent"
                        ? Math.max(
                            0,
                            discountModalProduct.price *
                              (1 - Math.min(parseFloat(discountModalValue), 100) / 100)
                          )
                        : Math.max(
                            0,
                            discountModalProduct.price -
                              Math.min(parseFloat(discountModalValue), discountModalProduct.price)
                          )
                    )}
                  </strong>
                </p>
              )}

              <div className="tz-add-entry-actions">
                {discounts[discountModalProduct.id] && (
                  <button
                    className="tz-camera-cancel"
                    onClick={() => {
                      removeDiscount(discountModalProduct.id);
                      closeDiscountModal();
                    }}
                  >
                    Quitar descuento
                  </button>
                )}
                <button className="tz-camera-cancel" onClick={closeDiscountModal}>
                  Cancelar
                </button>
                <button className="tz-pw-submit tz-payment-save" onClick={saveDiscountModal}>
                  <Save size={16} />
                  Aplicar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODAL: MIS VENTAS (HOY) ---------------- */}
      {misVentasOpen && (
        <div className="tz-modal-backdrop" onClick={() => setMisVentasOpen(false)}>
          <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
            <button
              className="tz-modal-close"
              onClick={() => setMisVentasOpen(false)}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
            <div className="tz-payment-modal">
              <h2>
                <Receipt size={17} /> Mis Ventas (Hoy)
              </h2>
              <p className="tz-stock-editor-sub">
                Ventas de este turno (desde {formatDate(turnoCutoff)} ·{" "}
                {formatTime(turnoCutoff)}). Anular repone el stock — úsalo solo para corregir
                un error de tipeo recién hecho.
              </p>
              {anularError && <p className="tz-error">{anularError}</p>}

              {ventasHoyAgrupadas.length === 0 ? (
                <p className="tz-method-history-empty">
                  Todavía no registraste ventas en este turno.
                </p>
              ) : (
                <div className="tz-cierre-list">
                  {ventasHoyAgrupadas.map((venta) => (
                    <div key={venta.purchaseId} className="tz-receipt tz-receipt-compact">
                      <div className="tz-receipt-header">
                        <span className="tz-receipt-title">{venta.purchaseId}</span>
                        <span className="tz-receipt-date">
                          {formatTime(venta.timestamp)} · {venta.metodoPago || "?"}
                        </span>
                      </div>
                      <div className="tz-receipt-divider" />
                      {venta.items.map((it) => (
                        <div className="tz-receipt-row" key={it.saleId}>
                          <span>
                            {it.name}
                            {it.detail ? ` (${it.detail})` : ""} × {it.qty}
                          </span>
                          <strong>{formatSoles(it.total)}</strong>
                        </div>
                      ))}
                      <div className="tz-receipt-divider" />
                      <div className="tz-receipt-row tz-receipt-total">
                        <span>Total</span>
                        <strong>{formatSoles(venta.total)}</strong>
                      </div>
                      <button
                        className="tz-cliente-action-btn tz-cliente-action-deuda"
                        style={{ marginTop: 10, width: "100%", justifyContent: "center" }}
                        disabled={anulandoVentaId === venta.purchaseId}
                        onClick={() => {
                          if (
                            window.confirm(
                              `¿Anular la venta ${venta.purchaseId} por ${formatSoles(
                                venta.total
                              )}? Repone el stock. No se puede deshacer.`
                            )
                          ) {
                            anularVenta(venta.purchaseId);
                          }
                        }}
                      >
                        {anulandoVentaId === venta.purchaseId ? (
                          <Loader2 size={13} className="tz-spin" />
                        ) : (
                          <Trash2 size={13} />
                        )}
                        Anular Venta
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODAL: USUARIOS (Cajeros y Clientes, solo admin) ---------------- */}
      {cajerosOpen && (
        <div
          className="tz-modal-backdrop"
          onClick={() => {
            setCajerosOpen(false);
            resetCajeroForm();
          }}
        >
          <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
            <button
              className="tz-modal-close"
              onClick={() => {
                setCajerosOpen(false);
                resetCajeroForm();
              }}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
            <div className="tz-payment-modal">
              <h2>
                <Users size={17} /> Usuarios
              </h2>
              <p className="tz-stock-editor-sub">
                Cajeros (acceso operativo sin cifras financieras) y clientes con cuenta de fiado.
                Cambia su PIN de acceso o elimina la cuenta si ya no corresponde.
              </p>

              {usuarioActionError && <p className="tz-error">{usuarioActionError}</p>}

              {cajerosLoading ? (
                <p className="tz-method-history-empty">Cargando…</p>
              ) : cajeros.length === 0 ? (
                <p className="tz-method-history-empty">Todavía no hay cajeros ni clientes registrados.</p>
              ) : (
                <ul className="tz-history-rows">
                  {cajeros.map((c) => (
                    <li key={c.id} className="tz-history-row">
                      <div className="tz-history-row-head" style={{ cursor: "default" }}>
                        <Users size={14} />
                        <span>{c.nombre || "(sin nombre)"}</span>
                        <span
                          className={`tz-metodo-tag ${
                            c.role === "cajero" ? "tz-metodo-tag-yape" : "tz-metodo-tag-otros"
                          }`}
                          style={{ marginLeft: "auto" }}
                        >
                          {c.role === "cajero" ? "Cajero" : "Cliente"}
                        </span>
                      </div>
                      <div className="tz-usuario-row-actions">
                        <button
                          type="button"
                          className="tz-camera-cancel tz-usuario-action-btn"
                          onClick={() => openPinModal(c)}
                        >
                          <Lock size={13} /> Cambiar PIN
                        </button>
                        <button
                          type="button"
                          className="tz-camera-cancel tz-usuario-action-btn tz-usuario-delete-btn"
                          onClick={() => eliminarUsuarioAuth(c)}
                          disabled={deletingUsuarioId === c.id}
                        >
                          {deletingUsuarioId === c.id ? (
                            <Loader2 size={13} className="tz-spin" />
                          ) : (
                            <Trash2 size={13} />
                          )}
                          Eliminar
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {!addCajeroOpen ? (
                <button
                  className="tz-scan-btn tz-add-entry-toggle"
                  onClick={() => setAddCajeroOpen(true)}
                >
                  <Plus size={16} /> Añadir cajero
                </button>
              ) : (
                <div className="tz-add-entry">
                  <label className="tz-field-label">Nombre</label>
                  <input
                    type="text"
                    autoFocus
                    className="tz-text-input"
                    placeholder="Ej. María López"
                    value={newCajeroNombre}
                    onChange={(e) => setNewCajeroNombre(e.target.value)}
                  />
                  <label className="tz-field-label">Usuario (para iniciar sesión)</label>
                  <input
                    type="text"
                    className="tz-text-input"
                    placeholder="Ej. maria"
                    value={newCajeroUsuario}
                    onChange={(e) => setNewCajeroUsuario(e.target.value)}
                  />
                  <label className="tz-field-label">Clave (4 a 10 dígitos)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="tz-text-input"
                    placeholder="••••••"
                    value={newCajeroPin}
                    onChange={(e) => setNewCajeroPin(e.target.value)}
                  />
                  {cajeroError && <p className="tz-error">{cajeroError}</p>}
                  <div className="tz-add-entry-actions">
                    <button className="tz-camera-cancel" onClick={resetCajeroForm}>
                      Cancelar
                    </button>
                    <button
                      className="tz-pw-submit tz-payment-save"
                      onClick={saveCajero}
                      disabled={cajeroSaving}
                    >
                      {cajeroSaving ? (
                        <Loader2 size={16} className="tz-spin" />
                      ) : (
                        <>
                          <Check size={16} /> Guardar
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODAL: CAMBIAR PIN (dentro de Usuarios) ---------------- */}
      {pinModalUser && (
        <div className="tz-modal-backdrop" onClick={closePinModal}>
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button className="tz-modal-close" onClick={closePinModal} aria-label="Cerrar">
              <X size={18} />
            </button>
            <div className="tz-add-entry">
              <h2>Cambiar PIN</h2>
              <p className="tz-stock-editor-sub">{pinModalUser.nombre || "(sin nombre)"}</p>
              <label className="tz-field-label">Nueva clave (4 a 10 dígitos)</label>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                className="tz-text-input"
                placeholder="••••••"
                value={pinModalValue}
                onChange={(e) => setPinModalValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") savePinModal();
                }}
              />
              {pinModalError && <p className="tz-error">{pinModalError}</p>}
              <div className="tz-add-entry-actions">
                <button className="tz-camera-cancel" onClick={closePinModal}>
                  Cancelar
                </button>
                <button
                  className="tz-pw-submit tz-payment-save"
                  onClick={savePinModal}
                  disabled={pinModalSaving}
                >
                  {pinModalSaving ? (
                    <Loader2 size={16} className="tz-spin" />
                  ) : (
                    <>
                      <Check size={16} /> Guardar
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODAL: MÉTODO DE PAGO (Yape / Plin / Otros) ---------------- */}
      {activeMethodModal && (
        <div className="tz-modal-backdrop" onClick={closeMethodModal}>
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button className="tz-modal-close" onClick={closeMethodModal} aria-label="Cerrar">
              <X size={18} />
            </button>

            <div className="tz-payment-modal">
              <h2>
                <CreditCard size={17} />{" "}
                {PAYMENT_METHODS.find((m) => m.key === activeMethodModal)?.label}
              </h2>

              {/* ---- totalizador interno, sincronizado con "Recaudado Hoy" ---- */}
              <div className="tz-method-totals">
                <div className="tz-method-total">
                  <span>Hoy</span>
                  <strong className="tz-green">
                    {formatSoles(methodStats[activeMethodModal].todayTotal)}
                  </strong>
                </div>
                <div className="tz-method-total">
                  <span>Histórico</span>
                  <strong>{formatSoles(methodStats[activeMethodModal].allTimeTotal)}</strong>
                </div>
              </div>

              {/* ---- historial exclusivo de este método, en acordeón ---- */}
              <div className="tz-method-history">
                <span className="tz-method-history-label">Historial</span>
                {methodStats[activeMethodModal].entries.length === 0 ? (
                  <p className="tz-method-history-empty">
                    Aún no hay ingresos registrados por esta vía.
                  </p>
                ) : (
                  <ul className="tz-history-rows">
                    {methodStats[activeMethodModal].entries.map((c) => {
                      const rowOpen = expandedEntryId === c.id;
                      return (
                        <li key={c.id} className="tz-history-row">
                          <button
                            className="tz-history-row-head"
                            onClick={() => toggleEntryRow(c.id)}
                          >
                            <span className="tz-history-row-method">
                              {formatDate(c.timestamp)}
                            </span>
                            <span className="tz-history-row-amount">
                              {formatSoles(c.amount)}
                            </span>
                            {rowOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                          {rowOpen &&
                            (c.opId || c.fotoUrl ? (
                              <div className="tz-history-row-detail">
                                <span>
                                  <strong>Hora:</strong> {formatTime(c.timestamp)}
                                </span>
                                <span>
                                  <strong>Fecha:</strong> {formatDate(c.timestamp)}
                                </span>
                                <span>
                                  <strong>ID comprobante:</strong> {c.opId || "No detectado"}
                                </span>
                                {c.fotoUrl && (
                                  <a
                                    href={c.fotoUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="tz-history-row-photo-link"
                                  >
                                    <img
                                      src={c.fotoUrl}
                                      alt="Comprobante escaneado"
                                      className="tz-history-row-photo"
                                    />
                                  </a>
                                )}
                              </div>
                            ) : (
                              // Sin ID de operación ni foto (ingreso cargado a
                              // mano, sin escaneo) — igual se muestra la fila
                              // completa, con Fecha/Monto ya visibles arriba en
                              // el encabezado; acá solo se aclara que no hay
                              // captura para no dejar el detalle en blanco.
                              <div className="tz-history-row-detail">
                                <span className="tz-history-row-manual-note">
                                  Sin captura adjunta · {formatTime(c.timestamp)}
                                </span>
                              </div>
                            ))}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- UTILIDADES DE ESCANEO (siempre montadas) ---------------- */}
      {/* El canvas y el input de archivo los usan TRES flujos distintos
         (checkout, cobro de fiado, y antes también Pagos) — viven acá,
         fuera de cualquier modal condicional, para que 'canvasRef' y
         'fileInputRef' nunca sean null sin importar cuál flujo esté
         activo. Este era el motivo exacto por el que "Capturar y leer"
         no hacía nada: el <canvas> solo existía dentro del modal de
         Pagos, que ya no lo necesita (es de solo lectura). */}
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={handleFileCapture}
      />

      {/* ---------------- MODAL: LIBRETA (Fiados) ---------------- */}
      {libretaOpen && (
        <div className="tz-modal-backdrop" onClick={closeLibreta}>
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button className="tz-modal-close" onClick={closeLibreta} aria-label="Cerrar">
              <X size={18} />
            </button>
            <div className="tz-payment-modal">
              <h2>
                <BookOpen size={17} /> Libreta (Fiados)
              </h2>

              {/* ---- pagos pendientes: comprobantes subidos por clientes,
                 esperando aprobación. La deuda NO se toca hasta Aprobar. ---- */}
              {pagosPendientes.length > 0 && (
                <div className="tz-method-history">
                  <span className="tz-method-history-label">
                    Pagos pendientes de aprobación ({pagosPendientes.length})
                  </span>
                  {pagosPendientesError && <p className="tz-error">{pagosPendientesError}</p>}
                  <ul className="tz-history-rows">
                    {pagosPendientes.map((pago) => {
                      const clienteNombre =
                        clientes.find((c) => c.id === pago.clienteId)?.nombre || "Cliente";
                      const resolving = resolvingPagoId === pago.id;
                      return (
                        <li key={pago.id} className="tz-history-row">
                          <div className="tz-history-row-detail tz-cliente-detail">
                            <div className="tz-mov-row tz-mov-deuda">
                              <span className="tz-mov-row-desc">
                                {clienteNombre} ·{" "}
                                {pago.tipo === "cancelar" ? "Cancelar cuenta" : "Restar crédito"}
                                <span className="tz-mov-row-date">
                                  {formatDate(pago.timestamp)}
                                </span>
                              </span>
                              <strong>{formatSoles(pago.monto)}</strong>
                            </div>
                            <div className="tz-cliente-actions">
                              <button
                                className="tz-cliente-action-btn tz-cliente-action-whatsapp"
                                onClick={() => verComprobante(pago)}
                              >
                                <Camera size={13} /> Ver comprobante
                              </button>
                              <button
                                className="tz-cliente-action-btn tz-cliente-action-pago"
                                disabled={resolving}
                                onClick={() => resolverPagoPendiente(pago, "aprobado")}
                              >
                                <Check size={13} /> Aprobar
                              </button>
                              <button
                                className="tz-cliente-action-btn tz-cliente-action-deuda"
                                disabled={resolving}
                                onClick={() => resolverPagoPendiente(pago, "rechazado")}
                              >
                                <X size={13} /> Rechazar
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {clientes.length === 0 && !addClienteOpen ? (
                /* ---- estado vacío ---- */
                <div className="tz-libreta-empty">
                  <p className="tz-method-history-empty">
                    No hay cuentas por cobrar activas.
                  </p>
                  <button
                    className="tz-scan-btn tz-add-entry-toggle"
                    onClick={() => setAddClienteOpen(true)}
                  >
                    <Plus size={16} /> Añadir cuenta
                  </button>
                </div>
              ) : (
                <>
                  {clientes.length > 0 && (
                    <div className="tz-method-totals">
                      <div className="tz-method-total">
                        <span>Por cobrar</span>
                        <strong className="tz-pink">{formatSoles(totalPorCobrar)}</strong>
                      </div>
                      <div className="tz-method-total">
                        <span>Clientes</span>
                        <strong>{clientes.length}</strong>
                      </div>
                    </div>
                  )}

                  {/* ---- agregar cliente ---- */}
                  {!addClienteOpen ? (
                    <button
                      className="tz-scan-btn tz-add-entry-toggle"
                      onClick={() => setAddClienteOpen(true)}
                    >
                      <Plus size={16} /> Añadir cuenta
                    </button>
                  ) : (
                    <div className="tz-add-entry">
                      <label className="tz-field-label">Nombre del cliente</label>
                      <input
                        type="text"
                        autoFocus
                        className="tz-text-input"
                        placeholder="Ej. Juan Pérez"
                        value={newClienteName}
                        onChange={(e) => setNewClienteName(e.target.value)}
                      />
                      <label className="tz-field-label">
                        Celular (será su usuario para iniciar sesión)
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="tz-text-input"
                        placeholder="999999999"
                        value={newClienteWhatsapp}
                        onChange={(e) => setNewClienteWhatsapp(e.target.value)}
                      />
                      <label className="tz-field-label">PIN (4 a 10 dígitos)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="tz-text-input"
                        placeholder="••••••"
                        value={newClientePin}
                        onChange={(e) => setNewClientePin(e.target.value)}
                      />
                      {clienteError && <p className="tz-error">{clienteError}</p>}
                      <div className="tz-add-entry-actions">
                        <button className="tz-camera-cancel" onClick={resetClienteForm}>
                          Cancelar
                        </button>
                        <button
                          className="tz-pw-submit tz-payment-save"
                          onClick={saveCliente}
                          disabled={clienteSaving}
                        >
                          {clienteSaving ? (
                            <Loader2 size={16} className="tz-spin" />
                          ) : (
                            <Save size={16} />
                          )}
                          Guardar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ---- lista de clientes ---- */}
                  {clientes.length > 0 && (
                  <div className="tz-method-history">
                    <span className="tz-method-history-label">Clientes</span>
                    <ul className="tz-history-rows">
                      {clientes.map((c) => {
                        const info = clienteSaldos[c.id] || {
                          saldo: 0,
                          movimientos: [],
                        };
                        const open = selectedClienteId === c.id;
                        const formOpen = cobroFormFor && cobroFormFor.clienteId === c.id;
                        const whatsappLink = c.whatsapp
                          ? buildWhatsappLink(
                              c.whatsapp,
                              `Hola ${c.nombre}, este es un recordatorio de tu saldo pendiente de ${formatSoles(
                                info.saldo
                              )} en Tonazo. ¡Gracias!`
                            )
                          : null;

                        return (
                          <li key={c.id} className="tz-history-row">
                            <button
                              className="tz-history-row-head"
                              onClick={() => toggleCliente(c.id)}
                            >
                              <span className="tz-history-row-method tz-cliente-nombre">
                                {c.nombre}
                              </span>
                              <span
                                className={`tz-history-row-amount ${
                                  info.saldo > 0
                                    ? "tz-cliente-debe"
                                    : info.saldo < 0
                                    ? "tz-cliente-favor"
                                    : "tz-cliente-aldia"
                                }`}
                              >
                                {info.saldo === 0
                                  ? "Al día"
                                  : `${formatSoles(Math.abs(info.saldo))} ${
                                      info.saldo > 0 ? "debe" : "a favor"
                                    }`}
                              </span>
                              {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>

                            {open && (
                              <div className="tz-history-row-detail tz-cliente-detail">
                                <FiadoDetalle info={info} />

                                <div className="tz-cliente-actions">
                                  {info.saldo > 0.009 && (
                                    <>
                                      <button
                                        className="tz-cliente-action-btn tz-cliente-action-pago"
                                        onClick={() => {
                                          stopCamera();
                                          setCobroFormFor({ clienteId: c.id, tipo: "RESTAR" });
                                          setCobroMonto("");
                                          setCobroMetodo("");
                                          setCobroError("");
                                          setModalView("manual");
                                          setScanDetected({ method: "", opId: "", photoUrl: "" });
                                          setScanError("");
                                        }}
                                      >
                                        <Minus size={13} /> Restar Crédito
                                      </button>
                                      <button
                                        className="tz-cliente-action-btn tz-cliente-action-deuda"
                                        onClick={() => {
                                          stopCamera();
                                          setCobroFormFor({ clienteId: c.id, tipo: "CANCELAR" });
                                          setCobroMonto(info.saldo.toFixed(2));
                                          setCobroMetodo("");
                                          setCobroError("");
                                          setModalView("manual");
                                          setScanDetected({ method: "", opId: "", photoUrl: "" });
                                          setScanError("");
                                        }}
                                      >
                                        <Check size={13} /> Cancelar Cuenta
                                      </button>
                                    </>
                                  )}
                                  {info.saldo > 0.009 && (
                                    <button
                                      type="button"
                                      className="tz-cliente-action-btn tz-cliente-action-whatsapp"
                                      onClick={() => window.open(whatsappLink, "_blank", "noreferrer")}
                                      disabled={!c.whatsapp}
                                      title={
                                        c.whatsapp
                                          ? undefined
                                          : "Este cliente no tiene WhatsApp registrado"
                                      }
                                    >
                                      <MessageCircle size={13} /> Recordar
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="tz-cliente-action-btn tz-cliente-action-delete"
                                    onClick={() => eliminarClienteFiado(c)}
                                    aria-label={`Eliminar cliente ${c.nombre}`}
                                    title="Eliminar cliente"
                                  >
                                    <Trash2 size={13} /> Eliminar
                                  </button>
                                </div>

                                {formOpen &&
                                  (() => {
                                    const montoNum = parseFloat(cobroMonto);
                                    const montoValido = cobroMonto !== "" && !isNaN(montoNum);
                                    // Reglas estrictas por tipo de cobro: "Cancelar cuenta" solo
                                    // acepta el monto EXACTO de la deuda; "Restar Crédito" (abono
                                    // parcial) solo acepta un monto mayor a 0 y ESTRICTAMENTE
                                    // menor a la deuda — si fuera igual o mayor, en realidad es
                                    // un "Cancelar cuenta" y debe usarse ese botón.
                                    let montoError = "";
                                    if (montoValido) {
                                      if (cobroFormFor.tipo === "CANCELAR") {
                                        if (Math.abs(montoNum - info.saldo) > 0.009) {
                                          montoError = `Para cancelar la cuenta, el monto debe ser exacto (${formatSoles(
                                            info.saldo
                                          )}).`;
                                        }
                                      } else if (montoNum <= 0) {
                                        montoError = "Ingresa un monto mayor a 0.";
                                      } else if (info.saldo - montoNum <= 0.009) {
                                        montoError = `El abono debe ser menor a la deuda total (${formatSoles(
                                          info.saldo
                                        )}). Para pagar todo, usa "Cancelar Cuenta".`;
                                      }
                                    }
                                    const montoBloqueaGuardar = !montoValido || !!montoError;

                                    return (
                                      <div className="tz-add-entry">
                                        <label className="tz-field-label">
                                          {cobroFormFor.tipo === "CANCELAR"
                                            ? `Cancelar cuenta (S/) — debe ser exacto`
                                            : "Monto a restar (S/)"}
                                        </label>
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          autoFocus
                                          className="tz-amount-input"
                                          placeholder="0.00"
                                          value={cobroMonto}
                                          onChange={(e) => handleCobroMontoChange(e.target.value)}
                                        />
                                        {montoError && <p className="tz-error">{montoError}</p>}

                                    {/* ---- método del cobro: obligatorio, define si el dinero
                                       entra físico a la caja o va directo al banco ---- */}
                                    <label className="tz-field-label">¿Cómo pagó?</label>
                                    <div className="tz-gasto-tipo-buttons">
                                      <button
                                        className={`tz-gasto-tipo-btn tz-metodo-btn tz-metodo-btn-efectivo ${
                                          cobroMetodo === "EFECTIVO" ? "tz-gasto-tipo-active" : ""
                                        }`}
                                        onClick={() => setCobroMetodo("EFECTIVO")}
                                      >
                                        Efectivo
                                      </button>
                                      <button
                                        className={`tz-gasto-tipo-btn tz-metodo-btn tz-metodo-btn-yape ${
                                          cobroMetodo === "DIGITAL" ? "tz-gasto-tipo-active" : ""
                                        }`}
                                        onClick={() => setCobroMetodo("DIGITAL")}
                                      >
                                        Digital (Yape/Plin/Otros)
                                      </button>
                                    </div>

                                    {/* ---- escáner del comprobante: SOLO para cobros Digitales.
                                       Efectivo no tiene foto que adjuntar. ---- */}
                                    {cobroMetodo === "DIGITAL" && (
                                      <>
                                        {modalView === "camera" ? (
                                          <div className="tz-camera-view">
                                            <video
                                              ref={videoRef}
                                              className="tz-camera-video"
                                              muted
                                              playsInline
                                              autoPlay
                                            />
                                            <div className="tz-camera-actions">
                                              <button
                                                className="tz-scan-btn"
                                                onClick={captureFromCamera}
                                              >
                                                <Camera size={16} /> Capturar
                                              </button>
                                              <button
                                                className="tz-camera-cancel"
                                                onClick={() => {
                                                  stopCamera();
                                                  setModalView("manual");
                                                }}
                                              >
                                                Cancelar
                                              </button>
                                            </div>
                                          </div>
                                        ) : modalView === "processing" ? (
                                          <div className="tz-scan-processing">
                                            <Loader2 size={22} className="tz-spin" />
                                            <p>Leyendo comprobante…</p>
                                          </div>
                                        ) : (
                                          <button className="tz-scan-btn" onClick={startCamera}>
                                            <Camera size={16} />
                                            {scanDetected.photoUrl
                                              ? "Comprobante adjuntado ✓"
                                              : "Adjuntar comprobante (obligatorio)"}
                                          </button>
                                        )}
                                        {!cameraSupported && (
                                          <p className="tz-camera-note">
                                            No se pudo acceder a la cámara; se abrirá el
                                            selector de fotos.
                                          </p>
                                        )}
                                        {!scanDetected.photoUrl && (
                                          <p className="tz-field-hint">
                                            Un cobro Digital no se puede confirmar sin adjuntar
                                            el comprobante.
                                          </p>
                                        )}
                                      </>
                                    )}

                                    {cobroError && <p className="tz-error">{cobroError}</p>}
                                    <div className="tz-add-entry-actions">
                                      <button
                                        className="tz-camera-cancel"
                                        onClick={resetCobroForm}
                                      >
                                        Cancelar
                                      </button>
                                      <button
                                        className="tz-pw-submit tz-payment-save"
                                        onClick={cobrarFiado}
                                        disabled={
                                          cobroSaving ||
                                          !cobroMetodo ||
                                          montoBloqueaGuardar ||
                                          (cobroMetodo === "DIGITAL" && !scanDetected.photoUrl)
                                        }
                                      >
                                        {cobroSaving ? (
                                          <Loader2 size={16} className="tz-spin" />
                                        ) : (
                                          <Save size={16} />
                                        )}
                                        Confirmar
                                      </button>
                                    </div>
                                  </div>
                                );
                              })()}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODAL: TOP CLIENTES (ranking de fidelidad) ---------------- */}
      {topClientesOpen && (
        <div
          className="tz-modal-backdrop"
          onClick={() => {
            setTopClientesOpen(false);
            setExpandedTopClienteId(null);
          }}
        >
          <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
            <button
              className="tz-modal-close"
              onClick={() => {
                setTopClientesOpen(false);
                setExpandedTopClienteId(null);
              }}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
            <div className="tz-payment-modal">
              <h2>
                <Trophy size={17} /> Top Clientes
              </h2>
              <p className="tz-stock-editor-sub">
                Ranking por consumo total (compras fiadas + pagos) y frecuencia. Solo cuentas de
                Cliente registradas con PIN — no incluye ventas al contado sin cuenta asociada.
              </p>

              {topClientesRanking.length > 0 && (
                <div className="tz-export-buttons">
                  <button type="button" className="tz-csv-btn" onClick={exportarListaVIP}>
                    <Download size={13} /> Exportar Lista VIP
                  </button>
                </div>
              )}
              {vipExportMsg && <p className="tz-success">{vipExportMsg}</p>}

              {topClientesRanking.length === 0 ? (
                <p className="tz-method-history-empty">
                  Todavía no hay actividad de cuentas de Cliente para rankear.
                </p>
              ) : (
                <ol className="tz-top-clientes-list">
                  {topClientesRanking.map((row, idx) => {
                    const waLink = buildTopClienteWhatsappLink(row.cliente);
                    const expanded = expandedTopClienteId === row.cliente.id;
                    const alDia = row.saldo <= 0;
                    return (
                      <li key={row.cliente.id} className="tz-top-cliente-row">
                        <div className="tz-top-cliente-main">
                          <span className="tz-top-cliente-rank">#{idx + 1}</span>
                          <div className="tz-top-cliente-info">
                            <span className="tz-top-cliente-nombre">{row.cliente.nombre}</span>
                            <span className="tz-top-cliente-sub">
                              {row.frecuencia} compra{row.frecuencia === 1 ? "" : "s"}/pago
                              {row.frecuencia === 1 ? "" : "s"}
                            </span>
                            <span
                              className={`tz-tag ${alDia ? "tz-tag-ok" : "tz-tag-danger"} tz-top-cliente-deuda`}
                            >
                              {alDia ? "Al día" : `Deuda pendiente: ${formatSoles(row.saldo)}`}
                            </span>
                          </div>
                          <strong className="tz-top-cliente-monto">
                            {formatSoles(row.totalConsumido)}
                          </strong>
                          <div className="tz-top-cliente-actions">
                            {waLink && (
                              <a
                                href={waLink}
                                target="_blank"
                                rel="noreferrer"
                                className="tz-top-cliente-wa-btn"
                                aria-label={`Escribir a ${row.cliente.nombre} por WhatsApp`}
                                title="Escribir por WhatsApp"
                              >
                                <MessageCircle size={15} />
                              </a>
                            )}
                            <button
                              type="button"
                              className="tz-top-cliente-expand-btn"
                              onClick={() =>
                                setExpandedTopClienteId(expanded ? null : row.cliente.id)
                              }
                              aria-label="Ver productos favoritos"
                              title="Productos favoritos"
                            >
                              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                          </div>
                        </div>
                        {expanded && (
                          <div className="tz-top-cliente-favoritos">
                            {row.favoritos.length === 0 ? (
                              <p className="tz-method-history-empty">
                                Sin compras fiadas registradas todavía.
                              </p>
                            ) : (
                              <ol className="tz-top-favoritos-list">
                                {row.favoritos.map((f, i) => (
                                  <li key={f.label}>
                                    {i + 1}. {f.label} x{f.veces} veces
                                  </li>
                                ))}
                              </ol>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODAL: FIADOS (historial de cobros, solo lectura) ---------------- */}
      {fiadosViewOpen && (
        <div className="tz-modal-backdrop" onClick={() => setFiadosViewOpen(false)}>
          <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
            <button
              className="tz-modal-close"
              onClick={() => setFiadosViewOpen(false)}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
            <div className="tz-payment-modal">
              <h2>
                <BookOpen size={17} /> Fiados · Cobros
              </h2>

              <div className="tz-method-totals">
                <div className="tz-method-total">
                  <span>Hoy</span>
                  <strong className="tz-green">{formatSoles(todayStats.fiadoPagosHoy)}</strong>
                </div>
                <div className="tz-method-total">
                  <span>Histórico</span>
                  <strong>
                    {formatSoles(movimientos.reduce((sum, m) => sum + m.monto, 0))}
                  </strong>
                </div>
              </div>

              <div className="tz-method-history">
                <span className="tz-method-history-label">Historial de cobros</span>
                {movimientos.length === 0 ? (
                  <p className="tz-method-history-empty">
                    Aún no se registró ningún cobro de fiado.
                  </p>
                ) : (
                  <ul className="tz-history-rows">
                    {movimientos.map((m) => {
                      const clienteNombre =
                        clientes.find((c) => c.id === m.clienteId)?.nombre || "Cliente";
                      const rowOpen = expandedFiadoPagoId === m.id;
                      return (
                        <li key={m.id} className="tz-history-row">
                          <button
                            className="tz-history-row-head"
                            onClick={() =>
                              setExpandedFiadoPagoId((prev) => (prev === m.id ? null : m.id))
                            }
                          >
                            <span className="tz-history-row-method">{clienteNombre}</span>
                            <span className="tz-history-row-amount">{formatSoles(m.monto)}</span>
                            {rowOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                          {rowOpen && (
                            <div className="tz-history-row-detail">
                              <span>
                                <strong>Tipo:</strong> {m.descripcion || "Pago"}
                              </span>
                              <span>
                                <strong>Hora:</strong> {formatTime(m.timestamp)}
                              </span>
                              <span>
                                <strong>Fecha:</strong> {formatDate(m.timestamp)}
                              </span>
                              {m.fotoUrl && (
                                <a
                                  href={m.fotoUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="tz-history-row-photo-link"
                                >
                                  <img
                                    src={m.fotoUrl}
                                    alt="Comprobante del cobro"
                                    className="tz-history-row-photo"
                                  />
                                </a>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- MODAL: GASTOS ---------------- */}
      {gastosOpen && (
        <div className="tz-modal-backdrop" onClick={closeGastosModal}>
          <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
            <button className="tz-modal-close" onClick={closeGastosModal} aria-label="Cerrar">
              <X size={18} />
            </button>
            <div className="tz-payment-modal">
              <h2>
                <TrendingDown size={17} /> Gastos
              </h2>

              <div className="tz-method-totals">
                <div className="tz-method-total">
                  <span>Hoy (caja)</span>
                  <strong className="tz-cliente-debe">
                    {formatSoles(todayStats.gastosHoyCaja)}
                  </strong>
                </div>
                <div className="tz-method-total">
                  <span>Registrados</span>
                  <strong>{gastos.length}</strong>
                </div>
              </div>

              {gastoStockWarning && <p className="tz-error">{gastoStockWarning}</p>}

              {!gastoFormOpen ? (
                <button className="tz-scan-btn tz-add-entry-toggle" onClick={openGastoForm}>
                  <Plus size={16} /> Registrar gasto
                </button>
              ) : (
                <div className="tz-add-entry tz-gasto-form">
                  <label className="tz-field-label">Tipo de comprobante</label>
                  <div className="tz-gasto-tipo-buttons">
                    {["Boleta", "Factura", "Recibo", "Otro"].map((t) => (
                      <button
                        key={t}
                        className={`tz-gasto-tipo-btn ${
                          gastoTipoComprobante === t ? "tz-gasto-tipo-active" : ""
                        }`}
                        onClick={() => setGastoTipoComprobante(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  <div className="tz-gasto-row-2col">
                    <div>
                      <label className="tz-field-label">N° comprobante</label>
                      <input
                        type="text"
                        className="tz-text-input"
                        placeholder="B001-00123"
                        value={gastoNumeroComprobante}
                        onChange={(e) => setGastoNumeroComprobante(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="tz-field-label">Origen del dinero</label>
                      <div className="tz-gasto-tipo-buttons">
                        <button
                          className={`tz-gasto-tipo-btn ${
                            gastoOrigen === "CAJA" ? "tz-gasto-tipo-active" : ""
                          }`}
                          onClick={() => setGastoOrigen("CAJA")}
                        >
                          Caja
                        </button>
                        <button
                          className={`tz-gasto-tipo-btn ${
                            gastoOrigen === "EXTERNO" ? "tz-gasto-tipo-active" : ""
                          }`}
                          onClick={() => {
                            setGastoOrigen("EXTERNO");
                            setGastoPagoEfectivo(false);
                            setGastoPagoDigital(false);
                          }}
                        >
                          Externo
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ---- método de pago del gasto: SOLO importa si salió de
                     la caja del negocio — define si se resta del efectivo
                     físico (arqueo) o solo de la Ganancia Neta. Ya no son
                     excluyentes: se puede prender uno, el otro, o ambos
                     (pago mixto) cuando la compra se cubrió parte en
                     billetes y parte por Yape/Plin/transferencia. ---- */}
                  {gastoOrigen === "CAJA" && (
                    <div>
                      <label className="tz-field-label">Método de Pago</label>
                      <div className="tz-gasto-tipo-buttons">
                        <button
                          type="button"
                          className={`tz-gasto-tipo-btn tz-metodo-btn tz-metodo-btn-efectivo ${
                            gastoPagoEfectivo ? "tz-gasto-tipo-active" : ""
                          }`}
                          onClick={() => setGastoPagoEfectivo((prev) => !prev)}
                        >
                          {gastoPagoEfectivo ? <Check size={13} /> : null} Efectivo (Caja física)
                        </button>
                        <button
                          type="button"
                          className={`tz-gasto-tipo-btn tz-metodo-btn tz-metodo-btn-yape ${
                            gastoPagoDigital ? "tz-gasto-tipo-active" : ""
                          }`}
                          onClick={() => setGastoPagoDigital((prev) => !prev)}
                        >
                          {gastoPagoDigital ? <Check size={13} /> : null} Digital
                          (Yape/Plin/Transferencia)
                        </button>
                      </div>

                      {gastoEsMixto && (
                        <div className="tz-gasto-row-2col" style={{ marginTop: 8 }}>
                          <div>
                            <label className="tz-field-label">Monto pagado en Efectivo</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              className="tz-text-input"
                              placeholder="0.00"
                              value={gastoMontoEfectivo}
                              onChange={(e) => setGastoMontoEfectivo(e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="tz-field-label">Monto pagado en Digital</label>
                            <input
                              type="text"
                              inputMode="decimal"
                              className="tz-text-input"
                              placeholder="0.00"
                              value={gastoMontoDigital}
                              onChange={(e) => setGastoMontoDigital(e.target.value)}
                            />
                          </div>
                        </div>
                      )}
                      {gastoEsMixto && (
                        <p
                          className={`tz-ruc-hint ${
                            Math.abs(gastoMixtoDiferencia) > 0.01 ? "tz-ruc-new" : "tz-ruc-found"
                          }`}
                        >
                          {Math.abs(gastoMixtoDiferencia) > 0.01 ? (
                            <>
                              <Building2 size={12} /> Falta cuadrar:{" "}
                              {formatSoles(Math.abs(gastoMixtoDiferencia))}{" "}
                              {gastoMixtoDiferencia > 0 ? "por asignar" : "de más"}
                            </>
                          ) : (
                            <>
                              <Check size={12} /> Efectivo + Digital cuadra con el Total
                            </>
                          )}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="tz-gasto-row-2col">
                    <div>
                      <label className="tz-field-label">Fecha</label>
                      <input
                        type="date"
                        className="tz-text-input"
                        value={gastoFecha}
                        onChange={(e) => setGastoFecha(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="tz-field-label">Hora</label>
                      <input
                        type="time"
                        className="tz-text-input"
                        value={gastoHora}
                        onChange={(e) => setGastoHora(e.target.value)}
                      />
                    </div>
                  </div>

                  <label className="tz-field-label">RUC del proveedor (opcional)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="tz-text-input"
                    placeholder="20123456789"
                    value={gastoRuc}
                    onChange={(e) => setGastoRuc(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  />
                  {rucLookupStatus === "found" && (
                    <p className="tz-ruc-hint tz-ruc-found">
                      <Check size={12} /> Proveedor encontrado — Razón Social autocompletada
                    </p>
                  )}
                  {rucLookupStatus === "not_found" && (
                    <p className="tz-ruc-hint tz-ruc-new">
                      <Building2 size={12} /> RUC nuevo: se creará el proveedor al guardar
                    </p>
                  )}

                  <label className="tz-field-label">Razón social</label>
                  <div className="tz-suggest-wrap">
                    <input
                      type="text"
                      className="tz-text-input"
                      placeholder="Ej. Distribuidora Pérez S.A.C."
                      value={gastoRazonSocial}
                      onChange={(e) => {
                        setGastoRazonSocial(e.target.value);
                        setRazonSocialSuggestOpen(true);
                      }}
                      onFocus={() => setRazonSocialSuggestOpen(true)}
                      onBlur={() => setTimeout(() => setRazonSocialSuggestOpen(false), 150)}
                      disabled={rucLookupStatus === "found"}
                      autoComplete="off"
                    />
                    {razonSocialSuggestOpen && razonSocialMatches.length > 0 && (
                      <div className="tz-suggest-list">
                        {razonSocialMatches.map((p) => (
                          <button
                            type="button"
                            key={p.id}
                            className="tz-suggest-item"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              selectProveedorSuggestion(p);
                            }}
                          >
                            <span className="tz-suggest-item-name">{p.razonSocial}</span>
                            <span className="tz-suggest-item-ruc">RUC {p.ruc}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <label className="tz-field-label">Ítems</label>

                  <button
                    type="button"
                    className="tz-scan-btn"
                    style={{ width: "100%", justifyContent: "center", marginBottom: 8 }}
                    onClick={() => setProductScannerOpen(true)}
                    disabled={productScanBusy}
                  >
                    {productScanBusy ? (
                      <Loader2 size={16} className="tz-spin" />
                    ) : (
                      <ScanLine size={16} />
                    )}
                    {productScanBusy ? "Buscando producto…" : "📷 Escanear Producto"}
                  </button>

                  <div className="tz-gasto-items">
                    {gastoItems.map((it) => {
                      const unidadesNum = parseFloat(it.cantidad);
                      const costoTotalNum = parseFloat(it.costoTotal);
                      const costoUnitario =
                        unidadesNum > 0 && !isNaN(costoTotalNum) && costoTotalNum >= 0
                          ? costoTotalNum / unidadesNum
                          : null;

                      return (
                        <div key={it.id} className="tz-stock-cost-item">
                          <div className="tz-gasto-item-desc-wrap tz-suggest-wrap">
                            {(it.productoId || it.stockKey) && (
                              <span
                                className="tz-gasto-item-linked"
                                title={
                                  it.stockKey
                                    ? `Vinculado a stock: ${it.stockKey} (se sumará al guardar)`
                                    : "Vinculado al producto, pero sin stock único para sumar"
                                }
                              >
                                <Package size={13} />
                              </span>
                            )}
                            <input
                              type="text"
                              className="tz-text-input tz-gasto-item-desc"
                              placeholder="Descripción"
                              value={it.descripcion}
                              autoComplete="off"
                              onChange={(e) => {
                                updateGastoItem(it.id, "descripcion", e.target.value);
                                setGastoItemSuggestOpenId(it.id);
                              }}
                              onFocus={() => setGastoItemSuggestOpenId(it.id)}
                              onBlur={() => setTimeout(() => setGastoItemSuggestOpenId(null), 150)}
                            />
                            {gastoItemSuggestOpenId === it.id &&
                              gastoItemStockSuggestions(it.descripcion).length > 0 && (
                                <div className="tz-suggest-list">
                                  {gastoItemStockSuggestions(it.descripcion).map((key) => (
                                    <button
                                      type="button"
                                      key={key}
                                      className="tz-suggest-item"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        selectGastoItemStock(it.id, key);
                                      }}
                                    >
                                      <span className="tz-suggest-item-name">
                                        {stockLabels[key] ?? key}
                                      </span>
                                      <span className="tz-suggest-item-ruc">
                                        Stock: {stock[key] ?? 0}
                                        {stockCostos[key] != null &&
                                          ` · Costo actual: ${formatSoles(stockCostos[key])}/u`}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                          </div>

                          <div className="tz-stock-cost-inputs">
                            <label className="tz-stock-cost-field">
                              <span>Unidades</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0"
                                value={it.cantidad}
                                onChange={(e) => updateGastoItem(it.id, "cantidad", e.target.value)}
                              />
                            </label>
                            <label className="tz-stock-cost-field">
                              <span>Costo Total (S/)</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0.00"
                                value={it.costoTotal}
                                onChange={(e) =>
                                  updateGastoItem(it.id, "costoTotal", e.target.value)
                                }
                              />
                            </label>
                            <button
                              type="button"
                              className="tz-gasto-item-remove"
                              onClick={() => removeGastoItemRow(it.id)}
                              aria-label="Quitar ítem"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          {costoUnitario != null && (
                            <p className="tz-stock-cost-hint">
                              Costo unitario: {formatSoles(costoUnitario)}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button className="tz-gasto-add-item" onClick={addGastoItemRow}>
                    <Plus size={13} /> Agregar ítem
                  </button>

                  <div className="tz-gasto-total-row">
                    <span>Total</span>
                    <strong>{formatSoles(gastoItemsTotal)}</strong>
                  </div>

                  {gastoError && <p className="tz-error">{gastoError}</p>}

                  <div className="tz-add-entry-actions">
                    <button className="tz-camera-cancel" onClick={closeGastoForm}>
                      Cancelar
                    </button>
                    <button
                      className="tz-pw-submit tz-payment-save"
                      onClick={saveGasto}
                      disabled={gastoSaving}
                    >
                      {gastoSaving ? (
                        <Loader2 size={16} className="tz-spin" />
                      ) : (
                        <Save size={16} />
                      )}
                      Guardar
                    </button>
                  </div>
                </div>
              )}

              {gastos.length > 0 && (
                <div className="tz-method-history">
                  <span className="tz-method-history-label">Historial de gastos</span>
                  {isAdmin && (
                    <div className="tz-export-buttons">
                      <button
                        type="button"
                        className="tz-csv-btn"
                        onClick={exportHistorialGastosXLSX}
                      >
                        <Download size={13} /> 📥 Historial de Gastos
                      </button>
                      <button
                        type="button"
                        className="tz-csv-btn"
                        onClick={exportReportePreciosXLSX}
                      >
                        <Download size={13} /> 📊 Reporte de Precios
                      </button>
                      <button
                        type="button"
                        className="tz-csv-btn"
                        onClick={exportHistorialVentasXLSX}
                      >
                        <Download size={13} /> 🛒 Historial de Ventas
                      </button>
                    </div>
                  )}
                  <ul className="tz-history-rows">
                    {gastos.map((g) => {
                      const open = expandedGastoId === g.id;
                      const proveedor = proveedores.find((p) => p.id === g.proveedorId);
                      return (
                        <li key={g.id} className="tz-history-row">
                          <button
                            className="tz-history-row-head"
                            onClick={() =>
                              setExpandedGastoId((prev) => (prev === g.id ? null : g.id))
                            }
                          >
                            <span className="tz-history-row-method">
                              {g.tipoComprobante}
                              {g.origen === "EXTERNO" ? " · Externo" : ""}
                            </span>
                            <span className="tz-history-row-amount tz-cliente-debe">
                              {formatSoles(g.total)}
                            </span>
                            {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                          {open && (
                            <div className="tz-history-row-detail">
                              <span>
                                <strong>Fecha:</strong> {formatDate(g.timestamp)} ·{" "}
                                {formatTime(g.timestamp)}
                              </span>
                              {g.numeroComprobante && (
                                <span>
                                  <strong>N° comprobante:</strong> {g.numeroComprobante}
                                </span>
                              )}
                              {g.origen === "CAJA" && (
                                <span>
                                  <strong>Método:</strong>{" "}
                                  {g.metodoPago === "MIXTO"
                                    ? `MIXTO (${formatSoles(g.montoEfectivo || 0)} Efectivo | ${formatSoles(
                                        g.montoDigital || 0
                                      )} Digital)`
                                    : g.metodoPago || "EFECTIVO"}
                                </span>
                              )}
                              {proveedor && (
                                <span>
                                  <strong>Proveedor:</strong> {proveedor.razonSocial} (RUC{" "}
                                  {proveedor.ruc})
                                </span>
                              )}
                              {g.items.length > 0 && (
                                <ul className="tz-mov-list" style={{ marginTop: 4 }}>
                                  {g.items.map((it) => (
                                    <li key={it.id} className="tz-mov-row">
                                      <span className="tz-mov-row-desc">
                                        {it.descripcion}
                                        <span className="tz-mov-row-date">
                                          {it.cantidad} × {formatSoles(it.precioUnitario)}
                                        </span>
                                      </span>
                                      <strong>{formatSoles(it.subtotal)}</strong>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {productScannerOpen && (
        <BarcodeScannerModal
          onScan={handleProductScan}
          onClose={() => setProductScannerOpen(false)}
        />
      )}

      {/* ---------------- MODAL: CIERRE DE CAJA ---------------- */}
      {cierreModalOpen && (
        <div className="tz-modal-backdrop" onClick={() => setCierreModalOpen(false)}>
          <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
            <button
              className="tz-modal-close"
              onClick={() => setCierreModalOpen(false)}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
            <div className="tz-payment-modal">
              <h2>
                <Receipt size={17} /> Cierre de Caja
              </h2>

              {/* ---- recibo del turno actual (aún no cerrado) ---- */}
              <div className="tz-receipt">
                <div className="tz-receipt-header">
                  <span className="tz-receipt-title">Turno actual</span>
                  <span className="tz-receipt-date">
                    Desde {formatDate(turnoCutoff)} · {formatTime(turnoCutoff)}
                  </span>
                </div>
                <div className="tz-receipt-row">
                  <span>Cajero</span>
                  <strong>{currentUserLabel}</strong>
                </div>
                <div className="tz-receipt-divider" />
                {isAdmin ? (
                  <>
                    {/* ---- valor comercial vs flujo de caja: separado para
                       que no parezca que una venta fiada "no se registró"
                       solo porque el dinero todavía no entró físicamente ---- */}
                    <div className="tz-receipt-row">
                      <span>Total Vendido (Valor Comercial)</span>
                      <strong>{formatSoles(todayStats.total)}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Fiado hoy (Por cobrar)</span>
                      <strong className="tz-cliente-debe">
                        {formatSoles(todayStats.fiadoHoy)}
                      </strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Total Ingresos (Efectivo)</span>
                      <strong>{formatSoles(todayStats.ingresoEfectivo)}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Total Ingresos (Digitales)</span>
                      <strong>{formatSoles(todayStats.ingresoDigital)}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Ingreso por Cobro de Deudas</span>
                      <strong>{formatSoles(todayStats.fiadoPagosHoy)}</strong>
                    </div>
                    <div className="tz-receipt-divider" />
                    <div className="tz-receipt-row">
                      <span>Recaudado (caja)</span>
                      <strong>{formatSoles(todayStats.recaudadoTotal)}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Productos vendidos</span>
                      <strong>{todayStats.items}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Ventas registradas</span>
                      <strong>{todayStats.purchaseCount}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Gastos (Efectivo)</span>
                      <strong>{formatSoles(todayStats.gastosEfectivoHoy)}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Gastos (Digitales)</span>
                      <strong>{formatSoles(todayStats.gastosDigitalHoy)}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Ticket general</span>
                      <strong>{formatSoles(todayStats.avgTicket)}</strong>
                    </div>
                    <div className="tz-receipt-divider" />
                    <div className="tz-receipt-row tz-receipt-total">
                      <span>GANANCIA NETA DEL TURNO</span>
                      <strong>{formatSoles(todayStats.gananciaNetaTurno)}</strong>
                    </div>
                  </>
                ) : (
                  // Cajero: solo lo operativo, nada de márgenes/ganancias.
                  <>
                    <div className="tz-receipt-row">
                      <span>Total Vendido</span>
                      <strong>{formatSoles(todayStats.total)}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Ingresos (Efectivo)</span>
                      <strong>{formatSoles(todayStats.ingresoEfectivo)}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Ingresos (Digitales)</span>
                      <strong>{formatSoles(todayStats.ingresoDigital)}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Productos vendidos</span>
                      <strong>{todayStats.items}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Ventas registradas</span>
                      <strong>{todayStats.purchaseCount}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Gastos (Efectivo)</span>
                      <strong>{formatSoles(todayStats.gastosEfectivoHoy)}</strong>
                    </div>
                    <div className="tz-receipt-row">
                      <span>Gastos (Digitales)</span>
                      <strong>{formatSoles(todayStats.gastosDigitalHoy)}</strong>
                    </div>
                  </>
                )}
              </div>

              {!confirmCierreOpen ? (
                <button
                  className="tz-scan-btn tz-add-entry-toggle"
                  onClick={() => setConfirmCierreOpen(true)}
                >
                  <Receipt size={16} /> Cerrar turno
                </button>
              ) : (
                <div className="tz-add-entry">
                  <p className="tz-cierre-warning">
                    <AlertTriangle size={14} /> Esto guarda una instantánea de estos totales y
                    reinicia los contadores de "Hoy" para el nuevo turno. No se puede deshacer.
                  </p>

                  <label className="tz-field-label">Efectivo físico en caja (S/)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="tz-amount-input"
                    placeholder="0.00"
                    value={efectivoReal}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^\d*\.?\d{0,2}$/.test(v)) setEfectivoReal(v);
                    }}
                  />
                  {arqueoInfo && <p className={arqueoInfo.clase}>{arqueoInfo.texto}</p>}

                  {cierreError && <p className="tz-error">{cierreError}</p>}
                  <div className="tz-add-entry-actions">
                    <button
                      className="tz-camera-cancel"
                      onClick={() => {
                        setConfirmCierreOpen(false);
                        setEfectivoReal("");
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      className="tz-pw-submit tz-payment-save"
                      onClick={ejecutarCierre}
                      disabled={cierreSaving}
                    >
                      {cierreSaving ? (
                        <Loader2 size={16} className="tz-spin" />
                      ) : (
                        <Save size={16} />
                      )}
                      Sí, cerrar turno
                    </button>
                  </div>
                </div>
              )}

              {/* ---- historial de cierres pasados, estilo ticket neón ---- */}
              {cierres.length > 0 && (
                <div className="tz-method-history">
                  <span className="tz-method-history-label">Historial de cierres</span>
                  {isAdmin && (
                    <div className="tz-export-buttons">
                      <button
                        type="button"
                        className="tz-csv-btn"
                        onClick={exportHistorialCierresXLSX}
                      >
                        <Download size={13} /> 📥 Exportar Historial de Cierres
                      </button>
                    </div>
                  )}
                  <div className="tz-export-buttons">
                    <button
                      type="button"
                      className="tz-csv-btn"
                      onClick={enviarResumenCierrePorWhatsApp}
                    >
                      <MessageCircle size={13} /> 📲 Enviar Resumen a WhatsApp
                    </button>
                  </div>
                  <div className="tz-cierre-list">
                    {cierres.map((c) => (
                      <div key={c.id} className="tz-receipt tz-receipt-compact">
                        <div className="tz-receipt-header">
                          <span className="tz-receipt-title">Cierre</span>
                          <span className="tz-receipt-date">
                            {formatDate(c.timestamp)} · {formatTime(c.timestamp)}
                          </span>
                        </div>
                        <div className="tz-receipt-divider" />
                        <div className="tz-receipt-row">
                          <span>Recaudado</span>
                          <strong>{formatSoles(c.recaudadoTotal)}</strong>
                        </div>
                        <div className="tz-receipt-row">
                          <span>Ventas</span>
                          <strong>{c.ventasRegistradas}</strong>
                        </div>
                        <div className="tz-receipt-row">
                          <span>Gastos</span>
                          <strong>{formatSoles(c.gastosTotal)}</strong>
                        </div>
                        <div className="tz-receipt-divider" />
                        {c.gananciaVentas != null ? (
                          <>
                            <div className="tz-receipt-row">
                              <span>Ganancia Neta (Ventas)</span>
                              <strong>{formatSoles(c.gananciaVentas)}</strong>
                            </div>
                            <div className="tz-receipt-row tz-receipt-total">
                              <span>Ganancia Neta (Fiados)</span>
                              <strong>{formatSoles(c.gananciaFiados)}</strong>
                            </div>
                          </>
                        ) : (
                          <div className="tz-receipt-row tz-receipt-total">
                            <span>Ganancia Neta</span>
                            <strong>{formatSoles(c.gananciaNeta)}</strong>
                          </div>
                        )}
                        {c.efectivoReal != null && (
                          <div className="tz-receipt-row">
                            <span>Arqueo</span>
                            <strong
                              className={
                                Math.abs(c.diferencia) <= 0.009
                                  ? "tz-arqueo-ok"
                                  : c.diferencia < 0
                                  ? "tz-arqueo-faltante"
                                  : "tz-arqueo-sobrante"
                              }
                            >
                              {Math.abs(c.diferencia) <= 0.009
                                ? "Cuadrada"
                                : `${c.diferencia < 0 ? "Faltante" : "Sobrante"} ${formatSoles(
                                    Math.abs(c.diferencia)
                                  )}`}
                            </strong>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
