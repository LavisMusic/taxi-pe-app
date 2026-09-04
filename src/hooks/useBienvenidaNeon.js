import { useCallback, useEffect, useState } from "react";

const PREFIJO = "tz-bienvenida-neon-";

// Decide si a ESTE usuario (localStorage, mismo patrón que
// useAnuncioActivo.js — "una sola vez, total", sin fecha de
// vencimiento) le toca ver la Animación Épica de Bienvenida, y expone
// `marcarVista` para que <AnimacionNeonBienvenida> la marque como ya
// vista recién cuando termina de verdad (fade-out incluido) — así, si
// el usuario recarga la página a la mitad de la animación, la vuelve a
// ver completa en vez de quedar "a medias" para siempre.
//
// `storageKey` identifica AL USUARIO (normalmente `usuario.id`, ver
// TaxiAuthContext.jsx) — no al rol ni al dispositivo — para que la
// bienvenida sea de verdad "por cuenta", igual en cualquier celular en
// el que inicie sesión. `disponible` es aparte (no una condición
// interna) porque normalmente depende de datos que todavía están
// cargando (el paquete destacado a mostrar) — mientras no haya nada
// que mostrar, tampoco tiene sentido "gastar" el flag de una vez.
//
// Empieza asumiendo `false` (no mostrar) a propósito: sin esto, en el
// primer render — antes de poder leer localStorage — se podría alcanzar
// a pintar la animación un instante de más para alguien que ya la había
// visto. Un usuario NUEVO de verdad simplemente la ve aparecer con un
// parpadeo de un frame de diferencia, imperceptible.
export function useBienvenidaNeon(storageKey, disponible) {
  const [yaVista, setYaVista] = useState(true);

  useEffect(() => {
    if (!storageKey) return;
    try {
      setYaVista(window.localStorage.getItem(PREFIJO + storageKey) === "1");
    } catch {
      // Modo privado / cuota llena: mejor no mostrarla a que rompa algo.
      setYaVista(true);
    }
  }, [storageKey]);

  const marcarVista = useCallback(() => {
    if (!storageKey) return;
    try {
      window.localStorage.setItem(PREFIJO + storageKey, "1");
    } catch {
      // No es crítico — en el peor caso, se vuelve a mostrar la
      // próxima vez en este mismo navegador.
    }
  }, [storageKey]);

  return { mostrar: !!disponible && !!storageKey && !yaVista, marcarVista };
}
