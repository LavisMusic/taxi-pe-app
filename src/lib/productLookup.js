import { supabase } from "../supabaseClient";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(codigo) {
  return UUID_REGEX.test(String(codigo || "").trim());
}

/* Busca un producto por el código escaneado. Si el string tiene forma
   de UUID (un QR que codifica el id interno del producto) busca por
   'id'; si no (un código de barras EAN/UPC numérico normal) busca por
   'codigo_barras'. Evita el error de Postgres "invalid input syntax
   for type uuid" que tira .eq('id', codigo) cuando codigo no es un
   UUID válido. Devuelve null si no hay match (no lanza error por
   "no encontrado" — eso lo decide quien llama). */
export async function buscarProductoPorCodigo(codigoRaw) {
  const codigo = String(codigoRaw || "").trim();
  if (!codigo) return null;

  const columna = isUuid(codigo) ? "id" : "codigo_barras";
  const { data, error } = await supabase
    .from("productos")
    .select("id, nombre, descripcion, precio, consumos")
    .eq(columna, codigo)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/* Un producto puede consumir de varias claves de stock a la vez (ej.
   un combo: 2 gaseosas + 1 hielo). Solo se puede reponer stock
   automáticamente al escanear si el producto consume de UNA sola
   clave — si consume de varias, o de ninguna, no hay forma no
   ambigua de saber a cuál sumarle la mercadería recibida. */
export function resolveStockKey(producto) {
  if (!producto) return null;
  const consumos = Array.isArray(producto.consumos)
    ? producto.consumos
    : JSON.parse(producto.consumos || "[]");
  const claves = [...new Set(consumos.map((c) => c.key).filter(Boolean))];
  return claves.length === 1 ? claves[0] : null;
}

// Marcas diacríticas combinantes (acentos) que quedan sueltas después
// de normalize("NFD") — rango ̀-ͯ.
const DIACRITICS_REGEX = new RegExp("[\\u0300-\\u036f]", "g");

function slugify(text) {
  return (text || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICS_REGEX, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/* Genera una clave de stock única a partir del nombre del producto
   (ej. "Coca Cola 1.5L" -> "coca-cola-1-5l"). Si ya existe esa clave
   en 'stockKeysExistentes' (el objeto 'stock' que ya trae useCatalog),
   le agrega un sufijo corto para no pisar un insumo existente. */
function generateStockKey(nombre, stockKeysExistentes) {
  const base = slugify(nombre) || "producto";
  if (!stockKeysExistentes || stockKeysExistentes[base] == null) return base;
  const sufijo = Math.random().toString(36).slice(2, 6);
  return `${base}-${sufijo}`;
}

/* Costo Promedio Ponderado de una clave de stock al recibir un lote
   nuevo. Fórmula estricta:
     Nuevo Costo = ((StockActual * CostoActual) + CostoTotalCompra)
                   / (StockActual + UnidadesIngresan)
   Caso especial (primer ingreso real): si no había stock previo, o el
   costo previo no se conocía (null/0 — ej. mercadería cargada antes
   de que existiera este sistema de costeo), no hay nada que
   promediar todavía — el costo nuevo ES el de este lote
   (CostoTotalCompra / UnidadesIngresan). Devuelve null si los datos
   de entrada no permiten calcular nada (0 unidades — división por
   cero — o un costo total inválido), para que el llamador decida qué
   hacer en vez de guardar un NaN/Infinity en la base. */
export function calcularCostoPromedioPonderado({
  stockActual,
  costoActualUnitario,
  unidadesIngresan,
  costoTotalCompra,
}) {
  const unidades = Number(unidadesIngresan);
  if (!unidades || unidades <= 0) return null;

  const costoTotal = Number(costoTotalCompra);
  if (isNaN(costoTotal) || costoTotal < 0) return null;

  const stockPrevio = Number(stockActual) || 0;
  const costoPrevio = Number(costoActualUnitario) || 0;

  if (stockPrevio <= 0 || costoPrevio <= 0) {
    return costoTotal / unidades;
  }

  return (stockPrevio * costoPrevio + costoTotal) / (stockPrevio + unidades);
}

/* 'orden' es una columna integer estándar de Postgres (máx.
   2 147 483 647). Date.now() son milisegundos desde 1970 — 13 dígitos,
   ~1 786 000 000 000 en 2026 — que desborda esa columna por completo.
   ESE desborde era el error real de "Crear producto" (Postgres lo
   rechaza como valor fuera de rango para integer); el código de
   barras escaneado, también de 13 dígitos, viajaba correctamente en
   su propia columna de texto y no tenía nada que ver. Acá se arma un
   entero chico y monótono (segundos desde una fecha fija reciente) que
   sigue sirviendo para ordenar "lo más nuevo al final" sin arriesgar
   overflow durante décadas. */
export function safeOrdenValue() {
  const EPOCH_BASE = new Date("2024-01-01T00:00:00Z").getTime();
  return Math.floor((Date.now() - EPOCH_BASE) / 1000);
}

/* Arma el 'nombre' completo (el string que sigue usándose en boletas,
   WhatsApp, historial, búsqueda, etc.) a partir de los 3 campos
   separados del alta/edición de producto: "Hey FIT" + "600ml" + "Fresa"
   -> "Hey FIT 600ml - Fresa". Sin variante, es simplemente
   "Hey FIT 600ml" (mismo comportamiento de siempre para productos sin
   sabor/color). */
export function composeProductoNombre({ nombreBase, variante, presentacion }) {
  const base = (nombreBase || "").trim();
  const pres = (presentacion || "").trim();
  const varn = (variante || "").trim();
  const conPresentacion = [base, pres].filter(Boolean).join(" ");
  return varn ? `${conPresentacion} - ${varn}` : conPresentacion;
}

/* 'descripcion' pasa a ser solo el subtítulo visual de la tarjeta
   (variante + presentación, ej. "Fresa · 600ml") — ya no hay que
   escribirla a mano por separado, sale de los mismos 2 campos. */
export function composeProductoDescripcion({ variante, presentacion }) {
  return (
    [variante, presentacion]
      .map((s) => (s || "").trim())
      .filter(Boolean)
      .join(" · ") || null
  );
}

/* Crea un producto "al vuelo" desde el flujo de escaneo de Editar
   Stock cuando el código no existe todavía en 'productos'. Un
   producto creado así representa mercadería física simple (no un
   combo), así que se le genera automáticamente una clave de stock 1:1
   propia (consumos: [{key, qty: 1}]) — es lo que permite que, apenas
   se crea, ya se pueda sumarle stock igual que a cualquier otro
   producto escaneado. Si la categoría escrita no existe todavía en
   'categorias', se crea también (si no, el producto quedaría
   "huérfano": buildSectionsFromRows arma las secciones recorriendo
   'categorias', no 'productos', así que un producto con una categoría
   sin fila propia nunca aparecería en el catálogo).

   nombreBase/variante/presentacion/color son los campos separados del
   formulario (Fase "Inventario Inteligente" v2) — nombre/descripcion
   se COMPONEN a partir de ellos, nunca se piden sueltos. */
export async function crearProducto({
  codigoBarras,
  nombreBase,
  variante,
  presentacion,
  color,
  precio,
  categoria,
  subgrupo,
  stockExistente,
  // Stock inicial + costo (unificación "Crear Producto" + "Agregar
  // Unidades al Stock" — ver App.jsx:saveNewProducto). Opcionales: si
  // no vienen (ej. agregarVariante / alta rápida al escanear), el
  // producto se crea igual que antes, con stock en 0 sin costo, listo
  // para cargarlo después desde Agregar Unidades.
  unidadesIniciales,
  costoTotalInicial,
}) {
  const categoriaNombre = (categoria || "").trim();
  const { data: catExistente, error: catLookupError } = await supabase
    .from("categorias")
    .select("id")
    .eq("nombre", categoriaNombre)
    .maybeSingle();
  if (catLookupError) throw catLookupError;

  if (!catExistente) {
    const { error: catInsertError } = await supabase
      .from("categorias")
      .insert([{ nombre: categoriaNombre, activo: true, orden: safeOrdenValue() }]);
    if (catInsertError) throw catInsertError;
  }

  const nombreBaseTrim = (nombreBase || "").trim();
  const varianteTrim = (variante || "").trim();
  const presentacionTrim = (presentacion || "").trim();
  const nombreCompleto = composeProductoNombre({
    nombreBase: nombreBaseTrim,
    variante: varianteTrim,
    presentacion: presentacionTrim,
  });
  const stockKey = generateStockKey(nombreCompleto, stockExistente);

  // Precio SIEMPRE numérico real (parseFloat), nunca el string crudo
  // del input — y el código de barras SOLO va a 'codigo_barras' (texto),
  // nunca mezclado con ningún campo numérico. Alta manual (desde el
  // buscador, sin escanear nada) no trae código: se manda NULL, no ""
  // — si 'codigo_barras' tiene un UNIQUE constraint, NULL nunca choca
  // (Postgres permite múltiples NULL en una columna UNIQUE), mientras
  // que dos productos con "" sí violarían esa restricción.
  const codigoBarrasTrim = String(codigoBarras || "").trim();
  const productoPayload = {
    nombre: nombreCompleto,
    descripcion: composeProductoDescripcion({ variante: varianteTrim, presentacion: presentacionTrim }),
    nombre_base: nombreBaseTrim,
    variante: varianteTrim || null,
    presentacion: presentacionTrim || null,
    color_variante: color || null,
    precio: parseFloat(precio),
    categoria: categoriaNombre,
    subgrupo: (subgrupo || "").trim() || null,
    codigo_barras: codigoBarrasTrim || null,
    consumos: JSON.stringify([{ key: stockKey, qty: 1 }]),
    activo: true,
    visible_publico: true,
    orden: safeOrdenValue(),
  };

  // Log explícito del payload exacto antes del INSERT, para poder
  // comparar tipo por tipo contra las columnas reales de Supabase si
  // algo vuelve a fallar.
  console.log("crearProducto: payload enviado a 'productos'", productoPayload);

  const { data: insertedProducto, error: prodError } = await supabase
    .from("productos")
    .insert([productoPayload])
    .select()
    .single();
  if (prodError) throw prodError;

  // Costo inicial: como el producto (y su clave de stock) recién nace
  // acá, no hay stock previo que promediar — es sencillamente
  // costoTotal / unidades. Se reusa calcularCostoPromedioPonderado con
  // stockActual/costoActualUnitario en 0 (misma fórmula, mismo caso
  // especial "primer ingreso real" que ya cubre) para no duplicar el
  // criterio en dos lugares.
  const unidadesNum = Number(unidadesIniciales) || 0;
  const costoUnitarioInicial =
    unidadesNum > 0
      ? calcularCostoPromedioPonderado({
          stockActual: 0,
          costoActualUnitario: 0,
          unidadesIngresan: unidadesNum,
          costoTotalCompra: costoTotalInicial,
        })
      : null;

  const { error: stockError } = await supabase
    .from("stock")
    .upsert(
      [
        {
          nombre: stockKey,
          cantidad: unidadesNum,
          etiqueta: nombreCompleto,
          ...(costoUnitarioInicial != null
            ? { precio_costo: costoUnitarioInicial, ultimo_costo_compra: costoUnitarioInicial }
            : {}),
        },
      ],
      { onConflict: "nombre" }
    );
  if (stockError) throw stockError;

  return { producto: insertedProducto, stockKey };
}

/* Crea un Combo: una fila de 'productos' SIN stock propio, cuya
   disponibilidad y descuento de inventario al vender salen gratis de
   la misma maquinaria genérica que ya usa cualquier producto con
   'consumos' de más de una clave (availabilityFor/unitCostFor en
   App.jsx, y el descuento de stock al confirmar una venta) — por eso
   no hace falta ningún caso especial de venta para combos, solo armar
   bien el 'consumos' combinado acá, una única vez, al crearlo.

   'items' es la receta elegida en el modal: [{ productId, consumes,
   qty }], donde 'consumes' es el array YA PARSEADO de ESE producto
   (item.consumes de productsById) y 'qty' cuántas unidades de ese
   producto entran en UN combo. Se combinan sumando, por cada clave de
   stock real, (consumo unitario del ingrediente) * (cantidad en la
   receta) — así un combo puede incluir a su vez otro combo como
   ingrediente (su 'consumes' ya viene aplanado a claves reales) sin
   ningún ajuste extra. */
export async function crearCombo({ nombre, categoria, subgrupo, precio, items }) {
  const categoriaNombre = (categoria || "").trim();
  const { data: catExistente, error: catLookupError } = await supabase
    .from("categorias")
    .select("id")
    .eq("nombre", categoriaNombre)
    .maybeSingle();
  if (catLookupError) throw catLookupError;

  if (!catExistente) {
    const { error: catInsertError } = await supabase
      .from("categorias")
      .insert([{ nombre: categoriaNombre, activo: true, orden: safeOrdenValue() }]);
    if (catInsertError) throw catInsertError;
  }

  const consumosMap = {};
  items.forEach(({ consumes, qty }) => {
    (consumes || []).forEach((c) => {
      consumosMap[c.key] = (consumosMap[c.key] || 0) + c.qty * qty;
    });
  });
  const consumos = Object.entries(consumosMap).map(([key, qty]) => ({ key, qty }));

  const nombreTrim = (nombre || "").trim();
  const productoPayload = {
    nombre: nombreTrim,
    descripcion: null,
    nombre_base: nombreTrim,
    variante: null,
    presentacion: null,
    color_variante: null,
    precio: parseFloat(precio),
    categoria: categoriaNombre,
    subgrupo: (subgrupo || "").trim() || null,
    codigo_barras: null,
    consumos: JSON.stringify(consumos),
    es_combo: true,
    combo_items: JSON.stringify(
      items.map(({ productId, qty }) => ({ productoId: productId, cantidad: qty }))
    ),
    activo: true,
    visible_publico: true,
    orden: safeOrdenValue(),
  };

  const { data: insertedProducto, error: prodError } = await supabase
    .from("productos")
    .insert([productoPayload])
    .select()
    .single();
  if (prodError) throw prodError;

  return { producto: insertedProducto };
}
