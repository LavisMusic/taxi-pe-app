import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Lista de paquetes/membresías para RECOLECTORES — misma forma que
// usePaquetes.js (paquetes de conductor), tabla separada
// (`paquetes_recolectores`) porque el catálogo de un recolector no
// tiene nada que ver con el de un conductor (créditos de recarga
// propios, no créditos/membresía que se le venden a un chofer). Solo
// lectura: el admin los siembra por SQL (ver el bloque entregado), no
// hay UI de edición todavía.
export function usePaquetesRecolectores() {
  const [paquetes, setPaquetes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("paquetes_recolectores")
      .select("id, tipo_item, nombre, precio, dias_membresia, creditos, descripcion, activo, orden")
      .eq("activo", true)
      .order("orden", { ascending: true });

    if (fetchError) {
      setError("No se pudieron cargar los paquetes de recolectores.");
      setPaquetes([]);
    } else {
      setPaquetes(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { paquetes, loading, error, refresh };
}
