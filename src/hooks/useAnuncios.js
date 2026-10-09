import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { FRECUENCIA_UNA_VEZ_TOTAL } from "../lib/taxiEnums";

// CRUD completo de `anuncios` (Gestor de Anuncios, Admin) — cada fila
// es una campaña de marketing (imagen y/o video de YouTube, título y
// descripción opcionales, vigencia por rango de fechas, frecuencia de
// aparición). Ver useAnuncioActivo.js para el lado consumidor (qué le
// toca ver a un visitante público ahora mismo).
export function useAnuncios() {
  const [anuncios, setAnuncios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const columnas = "id, titulo, descripcion, imagen_url, video_url, fecha_inicio, fecha_fin, frecuencia_mostrar, activo, orden, created_at";
    const consultar = (cols) =>
      supabase.from("anuncios").select(cols).order("orden", { ascending: true }).order("created_at", { ascending: false });
    // "publico" (a quién se muestra) viene de la migración 20261007100000;
    // si todavía no se corrió, se lee sin esa columna (todos = pasajeros).
    let { data, error: fetchError } = await consultar(`${columnas}, publico`);
    if (fetchError) ({ data, error: fetchError } = await consultar(columnas));

    if (fetchError) {
      setError("No se pudieron cargar los anuncios.");
      setAnuncios([]);
    } else {
      setAnuncios(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const crearAnuncio = useCallback(
    async (patch) => {
      const { error: insertError } = await supabase.from("anuncios").insert({
        activo: true,
        frecuencia_mostrar: FRECUENCIA_UNA_VEZ_TOTAL,
        ...patch,
      });
      if (!insertError) await refresh();
      return { error: insertError };
    },
    [refresh]
  );

  const actualizarAnuncio = useCallback(
    async (id, patch) => {
      const { data, error: updateError } = await supabase.from("anuncios").update(patch).eq("id", id).select();
      if (updateError) return { error: updateError };
      if (!data || data.length === 0) {
        return { error: new Error("No se guardó ningún cambio (0 filas afectadas).") };
      }
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  const eliminarAnuncio = useCallback(
    async (id) => {
      const { error: deleteError } = await supabase.from("anuncios").delete().eq("id", id);
      if (!deleteError) await refresh();
      return { error: deleteError };
    },
    [refresh]
  );

  return { anuncios, loading, error, refresh, crearAnuncio, actualizarAnuncio, eliminarAnuncio };
}
