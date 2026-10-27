import { useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";

// Avisos en vivo de foto / nombre de usuario cambiados (migración
// 20261027150000: la base los manda por Broadcast al canal 'perfiles', venga
// el cambio de Taxi-PE o de Caja) y el evento local "tz-perfil-actualizado"
// (el que guardó en esta misma pestaña). `alCambiar` vuelve a pedir lo suyo.
//
// Una sola suscripción al canal para toda la app (dos canales con el mismo
// nombre chocan en Realtime), compartida por todos los que escuchan.
const oyentes = new Set();
let canal = null;

function avisarATodos() {
  oyentes.forEach((fn) => fn());
}

export function usePerfilesEnVivo(alCambiar, activo = true) {
  const ref = useRef(alCambiar);
  ref.current = alCambiar;
  useEffect(() => {
    if (!activo) return undefined;
    const oyente = () => ref.current?.();
    oyentes.add(oyente);
    if (!canal) {
      canal = supabase.channel("perfiles").on("broadcast", { event: "perfil" }, avisarATodos).subscribe();
    }
    window.addEventListener("tz-perfil-actualizado", oyente);
    return () => {
      oyentes.delete(oyente);
      window.removeEventListener("tz-perfil-actualizado", oyente);
      if (oyentes.size === 0 && canal) {
        supabase.removeChannel(canal);
        canal = null;
      }
    };
  }, [activo]);
}
