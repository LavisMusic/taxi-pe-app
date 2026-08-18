import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// CRUD completo de `categorias` + `subgrupos` (las "empresas o flotas"
// dentro de una categoría, ej. "Turismo X" dentro de "Autos") — usado
// solo por CategoriasModal.jsx. El resto de la app (Directorio,
// Recarga Rápida, registro de conductores) lee categorias/subgrupos en
// modo solo-lectura desde useConductores.js; después de cualquier
// cambio acá conviene refrescar ESE hook también para que no queden
// desincronizados en la misma pantalla — ver el `onCambio` que recibe
// AdminDashboardPage.
//
// Reordenar (categorías o subgrupos) es drag-and-drop nativo HTML5 —
// mismo patrón que ya usaba CatalogVisibilityAccordion.jsx para
// categorías de productos: el componente arma el array completo en el
// nuevo orden visual y acá se persiste con un UPDATE de `orden` por
// fila (índice = nuevo valor de orden).
export function useCategorias() {
  const [categorias, setCategorias] = useState([]);
  const [subgrupos, setSubgrupos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const [catRes, subRes] = await Promise.all([
      supabase.from("categorias").select("id, nombre, orden").order("orden", { ascending: true }),
      supabase
        .from("subgrupos")
        .select("id, categoria_id, nombre, orden")
        .order("orden", { ascending: true }),
    ]);

    if (catRes.error || subRes.error) {
      setError("No se pudo cargar el catálogo de categorías.");
    } else {
      setCategorias(catRes.data ?? []);
      setSubgrupos(subRes.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const crearCategoria = useCallback(
    async (nombre) => {
      const maxOrden = categorias.reduce((m, c) => Math.max(m, c.orden ?? 0), 0);
      const { error: insertError } = await supabase
        .from("categorias")
        .insert({ nombre, orden: maxOrden + 1 });
      if (!insertError) await refresh();
      return { error: insertError };
    },
    [refresh, categorias]
  );

  const actualizarCategoria = useCallback(
    async (id, patch) => {
      const { data, error: updateError } = await supabase
        .from("categorias")
        .update(patch)
        .eq("id", id)
        .select();
      if (updateError) return { error: updateError };
      if (!data || data.length === 0) return { error: new Error("No se guardó (0 filas afectadas).") };
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  const eliminarCategoria = useCallback(
    async (id) => {
      const { error: deleteError } = await supabase.from("categorias").delete().eq("id", id);
      if (!deleteError) await refresh();
      return { error: deleteError };
    },
    [refresh]
  );

  // `idsEnOrden`: los ids de TODAS las categorías, ya en el orden final
  // que armó el drag-and-drop en el componente — se persiste asignando
  // orden = índice en ese array.
  const reordenarCategorias = useCallback(
    async (idsEnOrden) => {
      const results = await Promise.all(
        idsEnOrden.map((id, index) => supabase.from("categorias").update({ orden: index }).eq("id", id))
      );
      const failed = results.find((r) => r.error);
      if (failed) return { error: failed.error };
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  const reordenarSubgrupos = useCallback(
    async (idsEnOrden) => {
      const results = await Promise.all(
        idsEnOrden.map((id, index) => supabase.from("subgrupos").update({ orden: index }).eq("id", id))
      );
      const failed = results.find((r) => r.error);
      if (failed) return { error: failed.error };
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  const crearSubgrupo = useCallback(
    async ({ categoriaId, nombre }) => {
      const maxOrden = subgrupos
        .filter((s) => s.categoria_id === categoriaId)
        .reduce((m, s) => Math.max(m, s.orden ?? 0), 0);
      const { error: insertError } = await supabase
        .from("subgrupos")
        .insert({ categoria_id: categoriaId, nombre, orden: maxOrden + 1 });
      if (!insertError) await refresh();
      return { error: insertError };
    },
    [refresh, subgrupos]
  );

  const actualizarSubgrupo = useCallback(
    async (id, patch) => {
      const { data, error: updateError } = await supabase
        .from("subgrupos")
        .update(patch)
        .eq("id", id)
        .select();
      if (updateError) return { error: updateError };
      if (!data || data.length === 0) return { error: new Error("No se guardó (0 filas afectadas).") };
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  const eliminarSubgrupo = useCallback(
    async (id) => {
      const { error: deleteError } = await supabase.from("subgrupos").delete().eq("id", id);
      if (!deleteError) await refresh();
      return { error: deleteError };
    },
    [refresh]
  );

  const duplicarSubgrupo = useCallback(
    (subgrupo) => crearSubgrupo({ categoriaId: subgrupo.categoria_id, nombre: `${subgrupo.nombre} (copia)` }),
    [crearSubgrupo]
  );

  return {
    categorias,
    subgrupos,
    loading,
    error,
    refresh,
    crearCategoria,
    actualizarCategoria,
    eliminarCategoria,
    reordenarCategorias,
    crearSubgrupo,
    actualizarSubgrupo,
    eliminarSubgrupo,
    duplicarSubgrupo,
    reordenarSubgrupos,
  };
}
