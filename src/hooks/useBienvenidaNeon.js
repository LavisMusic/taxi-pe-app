import { useCallback, useEffect, useState } from "react";

const PREFIJO = "tz-bienvenida-neon-";

// Decide si a ESTE usuario le toca ver la Animación de Bienvenida, y
// expone `marcarVista` para que <AnimacionNeonBienvenida> la marque
// como vista recién cuando termina de verdad (fade-out incluido).
//
// Pedido: "la bienvenida debe aparecer cada vez que se accede, en todos
// los roles". Antes era "una sola vez por cuenta, para siempre"
// (localStorage) y después de la primera vez no volvía a salir nunca.
// Ahora es UNA VEZ POR ACCESO: el flag vive en sessionStorage, que se
// borra solo al cerrar la pestaña/app — volver a abrir la app = nueva
// bienvenida; un F5 en medio del uso NO la repite. Y al cerrar sesión se
// limpia a mano (reiniciarBienvenidas, llamado desde el logout), así
// que volver a iniciar sesión en la misma pestaña también la muestra.
//
// `storageKey` identifica AL USUARIO (normalmente `usuario.id`).
// `disponible` es aparte porque suele depender de datos que todavía
// están cargando — mientras no haya nada que mostrar, no se "gasta".
//
// Empieza asumiendo "ya vista" a propósito: así no se alcanza a pintar
// un frame de animación antes de poder leer el storage.
export function useBienvenidaNeon(storageKey, disponible) {
  const [yaVista, setYaVista] = useState(true);

  useEffect(() => {
    if (!storageKey) return;
    try {
      setYaVista(window.sessionStorage.getItem(PREFIJO + storageKey) === "1");
    } catch {
      // Storage bloqueado: mejor no mostrarla a que rompa algo.
      setYaVista(true);
    }
  }, [storageKey]);

  const marcarVista = useCallback(() => {
    if (!storageKey) return;
    // Apaga 'mostrar' en ESTA sesión ya mismo (sin depender de releer
    // el storage en un próximo mount).
    setYaVista(true);
    try {
      window.sessionStorage.setItem(PREFIJO + storageKey, "1");
    } catch {
      // No es crítico — en el peor caso, se vuelve a mostrar.
    }
  }, [storageKey]);

  return { mostrar: !!disponible && !!storageKey && !yaVista, marcarVista };
}

// Llamar al cerrar sesión: la próxima vez que alguien inicie sesión en
// esta misma pestaña vuelve a ver su bienvenida.
export function reiniciarBienvenidas() {
  try {
    Object.keys(window.sessionStorage)
      .filter((k) => k.startsWith(PREFIJO))
      .forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    // Storage bloqueado: nada que limpiar.
  }
}
