import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { subscribeTable } from "../lib/realtime";

// Mismo valor que usePaquetes.js — ver el comentario de ahí, el efecto
// tiene que sentirse idéntico desde cualquiera de las dos pantallas.
const GLOW_DURACION_MS = 2600;

// Lista de paquetes/membresías para RECOLECTORES — misma forma que
// usePaquetes.js (paquetes de conductor), tabla separada
// (`paquetes_recolectores`) porque el catálogo de un recolector no
// tiene nada que ver con el de un conductor (créditos de recarga
// propios, no créditos/membresía que se le venden a un chofer).
//
// Fase Membresías (tabs de audiencia en Configurar Membresías): antes
// esto era SOLO lectura ("el admin los siembra por SQL a mano, no hay
// UI de edición todavía") — ahora tiene el mismo CRUD completo que
// usePaquetes.js, así el modal del Admin puede administrar los dos
// catálogos (Conductores/Recolectores) desde un solo lugar sin tocar
// la base a mano nunca más.
export function usePaquetesRecolectores() {
  const [paquetes, setPaquetes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [glow, setGlow] = useState(false);
  const glowTimeoutRef = useRef(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("paquetes_recolectores")
      .select("id, tipo_item, nombre, precio, dias_membresia, creditos, descripcion, activo, orden")
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

  // Realtime + Glow (ver usePaquetes.js para el razonamiento completo,
  // es idéntico acá): el Recolector nunca escribe en esta tabla, así
  // que cualquier evento es un cambio del Admin.
  useEffect(
    () =>
      subscribeTable("paquetes_recolectores", () => {
        refresh();
        setGlow(true);
        clearTimeout(glowTimeoutRef.current);
        glowTimeoutRef.current = setTimeout(() => setGlow(false), GLOW_DURACION_MS);
      }),
    [refresh]
  );
  useEffect(() => () => clearTimeout(glowTimeoutRef.current), []);

  // Antes esto se filtraba por `.eq("activo", true)` directo en la
  // consulta — el Admin no podía ver (ni reactivar) un paquete
  // desactivado. Ahora trae todo y el que arma UI de administración
  // filtra si quiere: RecolectorPage.jsx/AutorecargaRecolectorModal.jsx
  // siguen queriendo SOLO los activos, así que ese filtro se movió a
  // los consumidores públicos (ver `.filter((p) => p.activo !== false)`
  // ya usado del lado de RecargaRapidaForm.jsx para paquetes normales).
  const crearPaquete = useCallback(
    async (patch) => {
      const { error: insertError } = await supabase.from("paquetes_recolectores").insert(patch);
      if (!insertError) await refresh();
      return { error: insertError };
    },
    [refresh]
  );

  const actualizarPaquete = useCallback(
    async (id, patch) => {
      const { data, error: updateError } = await supabase
        .from("paquetes_recolectores")
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
      const { error: deleteError } = await supabase.from("paquetes_recolectores").delete().eq("id", id);
      if (!deleteError) await refresh();
      return { error: deleteError };
    },
    [refresh]
  );

  // Drag & Drop — ver el comentario largo en usePaquetes.js, es la
  // misma lógica contra la tabla de recolectores.
  const reordenarPaquetes = useCallback(
    async (paquetesEnNuevoOrden) => {
      const resultados = await Promise.all(
        paquetesEnNuevoOrden.map((p, index) =>
          supabase.from("paquetes_recolectores").update({ orden: index }).eq("id", p.id)
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
