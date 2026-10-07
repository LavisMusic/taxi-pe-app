import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Descripciones de la app (texto que se escribe solo debajo del logo).
// Ver la migración 20261007100000.

// Admin (Gestor de Descripciones): CRUD completo.
export function useDescripciones() {
  const [descripciones, setDescripciones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("descripciones_app")
      .select("id, texto, publico, activo, orden, created_at")
      .order("orden", { ascending: true })
      .order("created_at", { ascending: true });
    if (fetchError) {
      setError("No se pudieron cargar las descripciones. ¿Ya corriste la migración 20261007100000?");
      setDescripciones([]);
    } else {
      setDescripciones(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const crear = useCallback(
    async (patch) => {
      const orden = descripciones.reduce((m, d) => Math.max(m, d.orden ?? 0), 0) + 1;
      const { error: e } = await supabase.from("descripciones_app").insert({ activo: true, orden, ...patch });
      if (!e) await refresh();
      return { error: e };
    },
    [descripciones, refresh]
  );

  const actualizar = useCallback(
    async (id, patch) => {
      const { error: e } = await supabase.from("descripciones_app").update(patch).eq("id", id);
      if (!e) await refresh();
      return { error: e };
    },
    [refresh]
  );

  const eliminar = useCallback(
    async (id) => {
      const { error: e } = await supabase.from("descripciones_app").delete().eq("id", id);
      if (!e) await refresh();
      return { error: e };
    },
    [refresh]
  );

  // Intercambia el lugar de dos descripciones (las vecinas en la lista
  // que ve el Admin, filtrada o no) y deja el orden 0..n sin huecos.
  const intercambiar = useCallback(
    async (idA, idB) => {
      const i = descripciones.findIndex((d) => d.id === idA);
      const j = descripciones.findIndex((d) => d.id === idB);
      if (i < 0 || j < 0) return { error: null };
      const nueva = [...descripciones];
      [nueva[i], nueva[j]] = [nueva[j], nueva[i]];
      const resultados = await Promise.all(
        nueva.map((d, k) => (d.orden === k ? null : supabase.from("descripciones_app").update({ orden: k }).eq("id", d.id)))
      );
      await refresh();
      return { error: resultados.find((r) => r?.error)?.error || null };
    },
    [descripciones, refresh]
  );

  return { descripciones, loading, error, crear, actualizar, eliminar, intercambiar };
}

// App (pasajero o conductor): textos activos para ese público (o para
// ambos), en orden, en tiempo real. Si la tabla todavía no existe
// (migración sin correr) devuelve [] y queda la frase de siempre.
export function useDescripcionesPublico(publico) {
  const [textos, setTextos] = useState([]);

  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      const { data, error } = await supabase
        .from("descripciones_app")
        .select("texto, orden, created_at")
        .eq("activo", true)
        .in("publico", [publico, "todos"])
        .order("orden", { ascending: true })
        .order("created_at", { ascending: true });
      if (!vivo) return;
      setTextos(error || !data ? [] : data.map((d) => d.texto).filter(Boolean));
    };
    cargar();
    const canal = supabase
      .channel(`descripciones-${publico}-${Math.random().toString(36).slice(2, 10)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "descripciones_app" }, cargar)
      .subscribe();
    return () => {
      vivo = false;
      supabase.removeChannel(canal);
    };
  }, [publico]);

  return textos;
}
