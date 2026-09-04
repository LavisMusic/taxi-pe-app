import { useCallback, useEffect, useRef, useState } from "react";

const DURACION_MS = 3200;

// Aviso chico en la parte superior ("sesión iniciada correctamente" /
// "no se pudo iniciar sesión") — se usa en los 3 logins (Pasajero,
// Conductor/Recolector, Admin). Se apaga solo después de unos segundos,
// como pidió el bug reportado; `ocultar` además existe para el caso
// éxito, donde conviene sacarlo apenas arranca la navegación a la
// pantalla siguiente en vez de dejarlo correr de fondo.
export function useAvisoTop() {
  const [aviso, setAviso] = useState(null);
  const timeoutRef = useRef(null);

  const mostrar = useCallback((texto, tipo = "exito") => {
    setAviso({ texto, tipo });
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setAviso(null), DURACION_MS);
  }, []);

  const ocultar = useCallback(() => {
    clearTimeout(timeoutRef.current);
    setAviso(null);
  }, []);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  return { aviso, mostrar, ocultar };
}
