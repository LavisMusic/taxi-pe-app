import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

function slugify(text) {
  return (text || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/* "01 OLD TIME GREEN" -> { numero: "01", title: "Old Time Green" }.
   Si no hay número al inicio, o si subgrupo es null (ej. "BEBIDAS",
   que es una lista plana), no hay encabezado (numero/title = null),
   igual que las categorías sin "groups.title" en el catálogo viejo. */
function parseSubgrupo(subgrupo) {
  if (!subgrupo) return { numero: null, title: null };
  const match = subgrupo.match(/^(\d+)\s+(.*)$/);
  if (match) return { numero: match[1], title: match[2] };
  return { numero: null, title: subgrupo };
}

/* Arma [{ key, label, groups: [{ numero, title, items: [...] }] }] a
   partir de las filas planas de 'categorias' + 'productos'. Es la
   MISMA forma que antes producía el array SECTIONS hardcodeado. */
function buildSectionsFromRows(categoriaRows, productoRows) {
  return categoriaRows.map((cat) => {
    const productosDeCategoria = productoRows
      .filter((p) => p.categoria === cat.nombre)
      .sort((a, b) => a.orden - b.orden);

    // Agrupa por 'subgrupo'.
    const groupsMap = new Map();
    productosDeCategoria.forEach((p) => {
      const groupKey = p.subgrupo || "__sin_subgrupo__";
      if (!groupsMap.has(groupKey)) {
        groupsMap.set(groupKey, []);
      }
      groupsMap.get(groupKey).push(p);
    });

    // Orden ESTRICTO por el número al inicio del nombre del subgrupo
    // (ej. "01 RON CARTAVIO" antes que "02 OTRO PACK"), no por el
    // orden de aparición de los productos — el negocio depende de este
    // orden para que la carta se vea como espera. Natural/numeric
    // sort: "2" antes que "10" (localeCompare alfabético pondría "10"
    // primero). Los productos sin subgrupo van siempre al final.
    const groupsOrder = Array.from(groupsMap.keys()).sort((a, b) => {
      if (a === "__sin_subgrupo__") return 1;
      if (b === "__sin_subgrupo__") return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    });

    const groups = groupsOrder.map((groupKey) => {
      const { numero, title } = parseSubgrupo(
        groupKey === "__sin_subgrupo__" ? null : groupKey
      );
      return {
        numero,
        title,
        items: groupsMap.get(groupKey).map((p) => ({
          id: p.id,
          combo: p.etiqueta || undefined,
          name: p.nombre,
          detail: p.descripcion || "",
          // Campos separados del refactor de variantes: 'baseName' es
          // la clave ESTRICTA de agrupación en el POS (ya no se adivina
          // por un separador en 'name'). Los productos cargados antes
          // de este refactor tienen baseName = su nombre completo
          // (backfill en la migración), así que quedan solos en su
          // propio grupo hasta que alguien los edite.
          baseName: p.nombre_base || p.nombre,
          variant: p.variante || "",
          presentation: p.presentacion || "",
          color: p.color_variante || null,
          subgrupoRaw: p.subgrupo || null,
          price: Number(p.precio),
          cost: p.costo != null ? Number(p.costo) : null,
          consumes: Array.isArray(p.consumos) ? p.consumos : JSON.parse(p.consumos || "[]"),
          visiblePublico: p.visible_publico ?? true,
          esCombo: p.es_combo ?? false,
          comboItems: Array.isArray(p.combo_items)
            ? p.combo_items
            : p.combo_items
              ? JSON.parse(p.combo_items)
              : null,
          imagenUrl: p.imagen_url || null,
        })),
      };
    });

    return { key: slugify(cat.nombre), label: cat.nombre, groups };
  });
}

function buildProductsById(sections) {
  const map = {};
  sections.forEach((section) => {
    section.groups.forEach((group) => {
      group.items.forEach((item) => {
        map[item.id] = { ...item, sectionLabel: section.label };
      });
    });
  });
  return map;
}

// Carga el catálogo (categorías + productos + stock) desde Supabase.
// Extraído de App.jsx para que la vista pública del catálogo y el POS
// de /admin compartan la misma fuente de datos sin duplicar el fetch.
export function useCatalog() {
  const [sections, setSections] = useState([]);
  const [productsById, setProductsById] = useState({});
  const [stock, setStock] = useState({});
  const [stockLabels, setStockLabels] = useState({});
  const [stockCostos, setStockCostos] = useState({});
  const [stockUltimoCosto, setStockUltimoCosto] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Extraído como useCallback (en vez de una función local del efecto)
  // para poder exponerlo como 'refetch': el flujo de "crear producto al
  // vuelo" desde Editar Stock hace un INSERT fuera de este hook y
  // necesita refrescar sections/productsById/stock sin recargar la
  // página.
  const load = useCallback(async () => {
    const { data: categoriaRows, error: categoriaError } = await supabase
      .from("categorias")
      .select("*")
      .eq("activo", true)
      .order("orden", { ascending: true });

    if (categoriaError) {
      console.error("Error cargando categorias desde Supabase:", categoriaError);
    }

    const { data: productoRows, error: productoError } = await supabase
      .from("productos")
      .select("*")
      .eq("activo", true)
      .order("orden", { ascending: true });

    if (productoError) {
      console.error("Error cargando productos desde Supabase:", productoError);
    }

    const builtSections = buildSectionsFromRows(categoriaRows || [], productoRows || []);
    const builtProductsById = buildProductsById(builtSections);

    if (categoriaError || productoError) {
      setError(
        "No se pudo cargar el catálogo desde Supabase. Revisa las tablas 'categorias' y 'productos'."
      );
    }

    const { data: stockRows, error: stockError } = await supabase
      .from("stock")
      .select("nombre, cantidad, etiqueta, precio_costo, ultimo_costo_compra");

    if (stockError) {
      console.error("Error cargando stock desde Supabase:", stockError);
    }

    const loadedStock = {};
    const loadedStockLabels = {};
    const loadedStockCostos = {};
    const loadedStockUltimoCosto = {};
    (stockRows || []).forEach((row) => {
      loadedStock[row.nombre] = row.cantidad;
      loadedStockLabels[row.nombre] = row.etiqueta || row.nombre;
      loadedStockCostos[row.nombre] = row.precio_costo != null ? Number(row.precio_costo) : null;
      loadedStockUltimoCosto[row.nombre] =
        row.ultimo_costo_compra != null ? Number(row.ultimo_costo_compra) : null;
    });

    Object.values(builtProductsById).forEach((product) => {
      (product.consumes || []).forEach(({ key }) => {
        if (loadedStock[key] == null) {
          console.warn(
            `La key de stock "${key}" (usada por "${product.name}") no existe todavía en la tabla 'stock'. Se muestra en 0.`
          );
          loadedStock[key] = 0;
          loadedStockLabels[key] = key;
          loadedStockCostos[key] = null;
          loadedStockUltimoCosto[key] = null;
        }
      });
    });

    setSections(builtSections);
    setProductsById(builtProductsById);
    setStock(loadedStock);
    setStockLabels(loadedStockLabels);
    setStockCostos(loadedStockCostos);
    setStockUltimoCosto(loadedStockUltimoCosto);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Alterna si un producto se muestra en el catálogo público (no afecta
  // su disponibilidad para vender desde /admin). Actualiza el estado
  // local al toque (optimista) y persiste en 'productos.visible_publico'.
  function applyVisibilityLocally(productId, visible) {
    setSections((prev) =>
      prev.map((section) => ({
        ...section,
        groups: section.groups.map((group) => ({
          ...group,
          items: group.items.map((item) =>
            item.id === productId ? { ...item, visiblePublico: visible } : item
          ),
        })),
      }))
    );
    setProductsById((prev) =>
      prev[productId]
        ? { ...prev, [productId]: { ...prev[productId], visiblePublico: visible } }
        : prev
    );
  }

  async function setProductVisibility(productId, visible) {
    const previous = productsById[productId]?.visiblePublico ?? true;
    applyVisibilityLocally(productId, visible);

    const { data, error: updateError } = await supabase
      .from("productos")
      .update({ visible_publico: visible })
      .eq("id", productId)
      .select("id");

    // Si RLS no tiene una política de UPDATE que cubra a este usuario,
    // Supabase no devuelve un error: simplemente actualiza 0 filas y
    // responde 200 OK. Sin este chequeo, el toggle cambia en pantalla
    // pero nunca se guarda, sin ningún aviso.
    const noRowsAffected = !updateError && (!data || data.length === 0);

    if (updateError || noRowsAffected) {
      console.error(
        "Error al actualizar visibilidad del producto:",
        updateError || "0 filas afectadas (probable política RLS de UPDATE faltante en 'productos')"
      );
      applyVisibilityLocally(productId, previous);
      return { error: updateError || new Error("No se pudo guardar: 0 filas afectadas.") };
    }

    return { error: null };
  }

  // Reordena las categorías (Drag & Drop en "Visibilidad en Catálogo
  // Público"): 'newLabelOrder' es el array completo de nombres de
  // categoría en el orden final deseado. Actualiza 'sections' al toque
  // (optimista, para que el arrastre se sienta instantáneo) y persiste
  // un 'orden' correlativo (0, 1, 2…) por categoría — mucho más chico
  // que safeOrdenValue() (segundos desde 2024), así que una categoría
  // nueva creada después siempre cae al final sin pisar este orden
  // manual.
  async function reorderCategorias(newLabelOrder) {
    const previousSections = sections;
    const byLabel = new Map(sections.map((s) => [s.label, s]));
    const reordered = newLabelOrder.map((label) => byLabel.get(label)).filter(Boolean);
    sections.forEach((s) => {
      if (!newLabelOrder.includes(s.label)) reordered.push(s);
    });
    setSections(reordered);

    const results = await Promise.all(
      newLabelOrder.map((label, index) =>
        supabase.from("categorias").update({ orden: index }).eq("nombre", label).select("id")
      )
    );

    const failed = results.find((r) => r.error);
    const zeroRows = results.find((r) => !r.error && (!r.data || r.data.length === 0));

    if (failed || zeroRows) {
      console.error(
        "Error reordenando categorías:",
        failed?.error || "0 filas afectadas (probable política RLS de UPDATE faltante en 'categorias')"
      );
      setSections(previousSections);
      return { error: failed?.error || new Error("No se pudo guardar el nuevo orden.") };
    }

    return { error: null };
  }

  return {
    sections,
    productsById,
    stock,
    setStock,
    stockLabels,
    stockCostos,
    setStockCostos,
    stockUltimoCosto,
    setStockUltimoCosto,
    loading,
    error,
    setProductVisibility,
    reorderCategorias,
    refetch: load,
  };
}
