import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { subscribeTable } from "../lib/realtime";

// Mismo valor que usePaquetes.js/usePaquetesRecolectores.js — el efecto
// tiene que sentirse idéntico desde cualquiera de las tres pantallas.
const GLOW_DURACION_MS = 2600;

// Lista de paquetes/membresías para CLIENTES (unificación
// pasajero/cliente) — tercer catálogo independiente, mismo criterio que
// ya separa Conductores (`paquetes`) de Recolectores
// (`paquetes_recolectores`): el precio/beneficio que se le vende a un
// cliente no tiene por qué coincidir con el de un conductor.
export function usePaquetesClientes() {
  const [paquetes, setPaquetes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [glow, setGlow] = useState(false);
  const glowTimeoutRef = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("paquetes_clientes")
      .select("id, tipo_item, nombre, precio, dias_membresia, creditos, descripcion, activo, orden")
      .order("orden", { ascending: true });

    if (fetchError) {
      setError("No se pudieron cargar los paquetes de clientes.");
      setPaquetes([]);
    } else {
      setPaquetes(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(
    () =>
      subscribeTable("paquetes_clientes", () => {
        refresh();
        setGlow(true);
        clearTimeout(glowTimeoutRef.current);
        glowTimeoutRef.current = setTimeout(() => setGlow(false), GLOW_DURACION_MS);
      }),
    [refresh]
  );
  useEffect(() => () => clearTimeout(glowTimeoutRef.current), []);

  const crearPaquete = useCallback(
    async (patch) => {
      const { error: insertError } = await supabase.from("paquetes_clientes").insert(patch);
      if (!insertError) await refresh();
      return { error: insertError };
    },
    [refresh]
  );

  const actualizarPaquete = useCallback(
    async (id, patch) => {
      const { data, error: updateError } = await supabase
        .from("paquetes_clientes")
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
      const { error: deleteError } = await supabase.from("paquetes_clientes").delete().eq("id", id);
      if (!deleteError) await refresh();
      return { error: deleteError };
    },
    [refresh]
  );

  const reordenarPaquetes = useCallback(
    async (paquetesEnNuevoOrden) => {
      const resultados = await Promise.all(
        paquetesEnNuevoOrden.map((p, index) =>
          supabase.from("paquetes_clientes").update({ orden: index }).eq("id", p.id)
        )
      );
      const primerError = resultados.find((r) => r.error)?.error;
      if (primerError) return { error: primerError };
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  return {
    paquetes,
    loading,
    error,
    glow,
    refresh,
    crearPaquete,
    actualizarPaquete,
    eliminarPaquete,
    reordenarPaquetes,
  };
}
