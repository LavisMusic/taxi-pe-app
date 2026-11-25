import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

// Ajustes del panel del administrador ("Ajustes" del pie de página).
// Se guardan en la cuenta (mi_guia_guardar con la clave "ajustes": la misma
// columna jsonb de preferencias de Don Peje, también para el admin sin fila
// en usuarios) y en este equipo, para que carguen al instante.
export const AJUSTES_PANEL_DEFECTO = {
  ocultarMontos: false,
  dirLocalidad: "", // "" = todas
  dirOcultarSinSaldo: false,
  dirOrden: "nivel", // nivel | vence | nuevos | nombre
  avisoSonido: true,
  avisoNotificacion: false,
  cierreHora: "", // "HH:MM" o "" (sin recordatorio)
};

const CLAVE = "tz-ajustes-panel-admin";
const EVENTO = "tz-ajustes-panel-cambio";

const leerLocal = () => {
  try {
    return { ...AJUSTES_PANEL_DEFECTO, ...JSON.parse(localStorage.getItem(CLAVE) || "{}") };
  } catch {
    return { ...AJUSTES_PANEL_DEFECTO };
  }
};

export function useAjustesPanel() {
  const [ajustes, setAjustes] = useState(leerLocal);
  const espera = useRef(null);

  // La cuenta manda (otro equipo pudo cambiarlos).
  useEffect(() => {
    let vivo = true;
    supabase.rpc("mi_guia_leer").then(({ data, error }) => {
      if (!vivo || error || !data?.ajustes) return;
      const desdeCuenta = { ...AJUSTES_PANEL_DEFECTO, ...data.ajustes };
      setAjustes(desdeCuenta);
      try {
        localStorage.setItem(CLAVE, JSON.stringify(desdeCuenta));
      } catch {
        /* sin almacenamiento */
      }
    });
    // Varias partes del panel usan los ajustes: se mantienen iguales.
    const f = (e) => setAjustes(e.detail);
    window.addEventListener(EVENTO, f);
    return () => {
      vivo = false;
      window.removeEventListener(EVENTO, f);
    };
  }, []);

  const cambiar = useCallback((parcial) => {
    setAjustes((prev) => {
      const nuevo = { ...prev, ...parcial };
      try {
        localStorage.setItem(CLAVE, JSON.stringify(nuevo));
      } catch {
        /* sin almacenamiento */
      }
      // Avisar a las demás partes después de este render.
      setTimeout(() => window.dispatchEvent(new CustomEvent(EVENTO, { detail: nuevo })), 0);
      clearTimeout(espera.current);
      espera.current = setTimeout(() => {
        supabase.rpc("mi_guia_guardar", { p_rol: "ajustes", p_estado: nuevo });
      }, 600);
      return nuevo;
    });
  }, []);

  return [ajustes, cambiar];
}
