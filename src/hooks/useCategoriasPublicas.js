import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Solo categorias+subgrupos, sin tocar `conductores` — lo usa el
// auto-registro de LoginPage.jsx (página pública, sin sesión). Reusar
// useConductores() ahí hubiera traído también la lista completa de
// conductores (teléfonos, créditos...) a una pantalla sin login, algo
// que useConductoresPublicos.js ya evita a propósito para la Home.
export function useCategoriasPublicas() {
  const [categorias, setCategorias] = useState([]);
  const [subgrupos, setSubgrupos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [catRes, subRes] = await Promise.all([
        supabase.from("categorias").select("id, nombre, orden").order("orden", { ascending: true }),
        supabase.from("subgrupos").select("id, categoria_id, nombre, orden").order("orden", { ascending: true }),
      ]);
      if (cancelado) return;
      setCategorias(catRes.data ?? []);
      setSubgrupos(subRes.data ?? []);
      setLoading(false);
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  return { categorias, subgrupos, loading };
}
