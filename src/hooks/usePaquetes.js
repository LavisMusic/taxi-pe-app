import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Lista de paquetes configurables (Membresías y Paquetes de Créditos)
// que el admin arma desde "Configurar Membresías" — reemplaza a la fila
// única vieja de `configuracion_paquetes`: ahora puede haber varias
// opciones por tipo ("Membresía Básica", "Membresía Premium", etc.),
// elegibles desde un desplegable en Recarga Rápida en vez de tipear un
// monto a mano.
export function usePaquetes() {
  const [paquetes, setPaquetes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("paquetes")
      .select("id, tipo_item, nombre, precio, dias_membresia, creditos, descripcion, activo, orden")
      .order("orden", { ascending: true });

    if (fetchError) {
      setError("No se pudieron cargar los paquetes.");
      setPaquetes([]);
    } else {
      setPaquetes(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const crearPaquete = useCallback(
    async (patch) => {
      const { error: insertError } = await supabase.from("paquetes").insert(patch);
      if (!insertError) await refresh();
      return { error: insertError };
    },
    [refresh]
  );

  const actualizarPaquete = useCallback(
    async (id, patch) => {
      const { data, error: updateError } = await supabase
        .from("paquetes")
        .update(patch)
        .eq("id", id)
        .select();
      if (updateError) return { error: updateError };
      if (!data || data.length === 0) {
        return { error: new Error("No se guardó ningún cambio (0 filas afectadas).") };
      }
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  const eliminarPaquete = useCallback(
    async (id) => {
      const { error: deleteError } = await supabase.from("paquetes").delete().eq("id", id);
      if (!deleteError) await refresh();
      return { error: deleteError };
    },
    [refresh]
  );

  return { paquetes, loading, error, refresh, crearPaquete, actualizarPaquete, eliminarPaquete };
}
