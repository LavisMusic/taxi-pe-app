import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { subscribeTable } from "../lib/realtime";

// Reemplaza al array hardcodeado LOCALIDADES (lib/taxiEnums.js) y a los
// pares fijos de LOCALIDADES_COORDS (lib/localidadesCoords.js) — ahora
// las localidades (con sus coordenadas) viven en la tabla `localidades`
// de Supabase y las administra el Admin desde AdminLocalidadesModal.jsx.
// Usado tanto por el panel de Admin (CRUD completo) como, en modo
// solo-lectura, por RegistroConductorForm.jsx (dropdown de localidad) y
// HomePage.jsx (filtro + viewbox del buscador de direcciones en
// RadarGlobal.jsx) — RLS permisiva (`using(true)`), mismo criterio que
// el resto del proyecto.
//
// Pedido: orden a mano (Drag & Drop) en vez de alfabético fijo, y que
// el cambio se vea "al instante" en el filtro del Pasajero — mismo
// patrón ya usado en usePaquetes.js: columna `orden` + suscripción de
// Realtime, así CUALQUIER pestaña con esta lista abierta (la del
// propio Admin reordenando, y la Home de cualquier Pasajero) se
// refresca sola en cuanto cambia algo, sin F5.
export function useLocalidades() {
  const [localidades, setLocalidades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("localidades")
      .select("id, nombre, lat, lon, orden")
      .order("orden", { ascending: true });
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

  useEffect(() => subscribeTable("localidades", () => refresh()), [refresh]);

  const crearLocalidad = useCallback(
    async ({ nombre, lat, lon }) => {
      // Nueva localidad entra al FINAL de la lista actual — mismo
      // criterio que ya usa ConfigurarMembresiasModal.jsx: no depender
      // de un default de columna que la haga "saltar" al principio y
      // desordenar lo que el Admin ya armó a mano.
      const maxOrden = localidades.reduce((max, l) => Math.max(max, Number(l.orden) || 0), -1);
      const { error: insertError } = await supabase
        .from("localidades")
        .insert({ nombre, lat, lon, orden: maxOrden + 1 });
      if (!insertError) await refresh();
      return { error: insertError };
    },
    [refresh, localidades]
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

  // Drag & Drop (Admin) — misma lógica que reordenarPaquetes en
  // usePaquetes.js: recibe la lista ya en el orden visual final y
  // persiste 0..N. Van en paralelo porque cada fila recibe un `orden`
  // DISTINTO, no hay forma de mandarlo en un solo .update().
  const reordenarLocalidades = useCallback(
    async (localidadesEnNuevoOrden) => {
      const resultados = await Promise.all(
        localidadesEnNuevoOrden.map((l, index) => supabase.from("localidades").update({ orden: index }).eq("id", l.id))
      );
      const primerError = resultados.find((r) => r.error)?.error;
      if (primerError) return { error: primerError };
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  return {
    localidades,
    loading,
    error,
    refresh,
    crearLocalidad,
    actualizarLocalidad,
    eliminarLocalidad,
    reordenarLocalidades,
  };
}

// Fallback fijo — mismo rol que tenía COORD_DEFAULT en
// localidadesCoords.js: centrar el mapa cuando todavía no cargó
// `localidades` o el navegador niega el GPS. San Ramón, Chanchamayo.
export const COORD_DEFAULT = [-11.1156, -75.3567];

export function coordsDeLocalidad(localidades, nombre) {
  const fila = (localidades ?? []).find((l) => l.nombre === nombre);
  return fila ? [fila.lat, fila.lon] : COORD_DEFAULT;
}
