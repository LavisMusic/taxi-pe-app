import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { subscribeTable } from "../lib/realtime";

// Duración del aviso "Glow Realtime" (ver más abajo) — mismo valor en
// usePaquetesRecolectores.js para que el efecto se sienta idéntico
// desde cualquiera de las dos pantallas.
const GLOW_DURACION_MS = 2600;

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
  // Fase Neón — "Glow Realtime": solo el Admin escribe en esta tabla
  // (Recarga Rápida/Autorecarga la leen nomás), así que cualquier
  // evento de Realtime que llegue acá es, por construcción, un cambio
  // hecho por el Admin. Se prende ~2.6s y se apaga solo — el <select>
  // que lo consuma decide qué hacer con el aviso (ver Styles.jsx,
  // .tz-select-glow-neon), esta parte no sabe nada de CSS.
  const [glow, setGlow] = useState(false);
  const glowTimeoutRef = useRef(null);

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

  // Realtime: sin esto, un paquete que el Admin agrega/edita/reordena
  // mientras un Recolector ya tiene Recarga Rápida abierta nunca le
  // llegaba — se enteraba recién si recargaba la página entera.
  useEffect(
    () =>
      subscribeTable("paquetes", () => {
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

  // Drag & Drop (Configurar Membresías, Admin): recibe la lista YA en
  // el orden visual final (después de soltar) y persiste 0..N como
  // `orden` de cada fila. Se reenumera SOLO dentro del subconjunto que
  // se arrastró (normalmente un tab de tipo_item ya filtrado) — no
  // hace falta que sea único en TODA la tabla, cada pantalla vuelve a
  // filtrar por tipo_item y ordenar antes de mostrar, así que dos
  // paquetes de tipos distintos compartiendo el mismo número de orden
  // no genera ninguna colisión visible.
  //
  // Van en paralelo (Promise.all) en vez de un .update() en lote
  // porque cada fila recibe un `orden` DISTINTO — Supabase-js no tiene
  // forma de mandar "actualiza estas N filas con estos N valores
  // distintos" en una sola llamada .update().
  const reordenarPaquetes = useCallback(
    async (paquetesEnNuevoOrden) => {
      const resultados = await Promise.all(
        paquetesEnNuevoOrden.map((p, index) => supabase.from("paquetes").update({ orden: index }).eq("id", p.id))
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
