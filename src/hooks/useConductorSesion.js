import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Puente entre el login (`usuarios`, sin FK propia hacia `conductores`)
// y la fila operativa del conductor: se busca por `telefono`, el único
// campo presente en ambas tablas — hasta que exista un flujo explícito
// de "reclamar" el pre-registro que hizo el Recolector (ver Paso 3).
// Devuelve `conductor: null` (sin error) cuando el teléfono no matchea
// ninguna fila todavía — la pantalla lo muestra como "aún sin vincular",
// no como una falla.
export function useConductorSesion(usuario) {
  const [conductor, setConductor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!usuario?.telefono) {
      setConductor(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("conductores")
      .select(
        "id, nombre, placa, telefono, foto_url, foto_portada_url, descripcion, estado, creditos, vencimiento_suscripcion, categoria_id, nivel_servicio, aprobado"
      )
      .eq("telefono", usuario.telefono)
      .maybeSingle();

    if (fetchError) {
      setError("No se pudo cargar tu perfil de conductor.");
      setConductor(null);
    } else {
      setConductor(data);
    }
    setLoading(false);
  }, [usuario?.telefono]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Update optimista (sin esperar el refetch) — en /conductor el switch
  // de estado tiene que sentirse instantáneo, es literalmente el único
  // control que el chofer toca mientras maneja.
  const setEstado = useCallback(
    async (estado) => {
      if (!conductor) return { error: new Error("Sin conductor vinculado") };
      const { error: updateError } = await supabase
        .from("conductores")
        .update({ estado })
        .eq("id", conductor.id);
      if (!updateError) setConductor((c) => (c ? { ...c, estado } : c));
      return { error: updateError };
    },
    [conductor]
  );

  // Genérico (foto de perfil, etc.) — misma forma (id, patch) => {error}
  // que `updateConductor` del admin, para poder reusar GestionImagenModal
  // tal cual acá con "Editar Perfil".
  const actualizar = useCallback(
    async (_id, patch) => {
      if (!conductor) return { error: new Error("Sin conductor vinculado") };
      const { error: updateError } = await supabase
        .from("conductores")
        .update(patch)
        .eq("id", conductor.id);
      if (!updateError) setConductor((c) => (c ? { ...c, ...patch } : c));
      return { error: updateError };
    },
    [conductor]
  );

  return { conductor, loading, error, refresh, setEstado, actualizar };
}
