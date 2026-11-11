import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Sanción vigente de la sesión (fase 4a de reportes): { pasajero, conductor }
// con { accion: 'suspension' | 'bloqueo', hasta, motivo } o null. La base ya
// impide lo que no se puede hacer; esto es para avisarlo en la pantalla.
const POLL_MS = 60000;

export function useMiSancion(activo = true) {
  const [sancion, setSancion] = useState({ pasajero: null, conductor: null });
  useEffect(() => {
    if (!activo) {
      setSancion({ pasajero: null, conductor: null });
      return undefined;
    }
    let vivo = true;
    const leer = () =>
      supabase.rpc("taxi_mi_sancion").then(({ data, error }) => {
        if (vivo && !error && data) setSancion({ pasajero: data.pasajero || null, conductor: data.conductor || null });
      });
    leer();
    const t = setInterval(() => document.visibilityState === "visible" && leer(), POLL_MS);
    const alVolver = () => document.visibilityState === "visible" && leer();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vivo = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [activo]);
  return sancion;
}
