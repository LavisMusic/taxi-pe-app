import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Reemplaza al array hardcodeado LOCALIDADES (lib/taxiEnums.js) y a los
// pares fijos de LOCALIDADES_COORDS (lib/localidadesCoords.js) — ahora
// las localidades (con sus coordenadas) viven en la tabla `localidades`
// de Supabase y las administra el Admin desde AdminLocalidadesModal.jsx.
// Usado tanto por el panel de Admin (CRUD completo) como, en modo
// solo-lectura, por RegistroConductorForm.jsx (dropdown de localidad) y
// HomePage.jsx (filtro + viewbox del buscador de direcciones en
// RadarGlobal.jsx) — RLS permisiva (`using(true)`), mismo criterio que
// el resto del proyecto.
export function useLocalidades() {
  const [localidades, setLocalidades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("localidades")
      .select("id, nombre, lat, lon")
      .order("nombre", { ascending: true });
    if (fetchError) {
      setError("No se pudieron cargar las localidades.");
      setLocalidades([]);
    } else {
      setLocalidades(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const crearLocalidad = useCallback(
    async ({ nombre, lat, lon }) => {
      const { error: insertError } = await supabase.from("localidades").insert({ nombre, lat, lon });
      if (!insertError) await refresh();
      return { error: insertError };
    },
    [refresh]
  );

  const actualizarLocalidad = useCallback(
    async (id, patch) => {
      const { data, error: updateError } = await supabase.from("localidades").update(patch).eq("id", id).select();
      if (updateError) return { error: updateError };
      if (!data || data.length === 0) return { error: new Error("No se guardó (0 filas afectadas).") };
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  const eliminarLocalidad = useCallback(
    async (id) => {
      const { error: deleteError } = await supabase.from("localidades").delete().eq("id", id);
      if (!deleteError) await refresh();
      return { error: deleteError };
    },
    [refresh]
  );

  return { localidades, loading, error, refresh, crearLocalidad, actualizarLocalidad, eliminarLocalidad };
}

// Fallback fijo — mismo rol que tenía COORD_DEFAULT en
// localidadesCoords.js: centrar el mapa cuando todavía no cargó
// `localidades` o el navegador niega el GPS. San Ramón, Chanchamayo.
export const COORD_DEFAULT = [-11.1156, -75.3567];

export function coordsDeLocalidad(localidades, nombre) {
  const fila = (localidades ?? []).find((l) => l.nombre === nombre);
  return fila ? [fila.lat, fila.lon] : COORD_DEFAULT;
}
