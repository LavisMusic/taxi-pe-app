import { useCallback, useEffect, useState } from "react";

const PREFIJO = "tz-membresia-activada-";

// Bienvenida en 2 partes (bug/pedido): esto es la SEGUNDA parte — un
// aviso que aparece cada vez que se activa o cambia (upgrade/downgrade)
// la MEMBRESÍA de un conductor, como "señal en tiempo real" separada
// de la bienvenida de cuenta nueva (ver useBienvenidaNeon.js, la
// primera parte). Nunca se dispara por una compra de créditos —
// depende de `conductores.membresia_paquete_id`, que
// useRecargas.js/registrarRecarga solo toca cuando `tipoItem` es
// membresía.
//
// Se dispara comparando el id ACTUAL contra el último que quedó
// guardado en localStorage para ESTE conductor — no un simple booleano
// "ya lo vi", porque acá lo que importa es DETECTAR UN CAMBIO, no
// "mostrar una vez en la vida": la primera activación (null → id) y
// cualquier cambio posterior a otro paquete (id-A → id-B) cuentan
// igual. La primera vez que este navegador ve a este conductor
// (todavía no hay nada guardado) NO dispara nada — solo establece el
// punto de partida; sin esto, un conductor que YA tenía una membresía
// activa desde antes (de otra sesión, otro dispositivo, o de antes de
// que existiera esta función) vería el cartel apenas abre la app, como
// si acabara de activar algo que en realidad ya tenía hace rato.
//
// Bug reportado: el cartel salía en CADA recarga de página, no solo
// una vez. Causa real: `paquetes.id`/`membresia_paquete_id` son
// `bigint` en la base — Supabase los devuelve como NUMBER de JS, pero
// `localStorage` solo guarda/lee STRINGS. La comparación de abajo
// hacía `3 !== "3"` (número contra string) — SIEMPRE distintos, aunque
// fueran "el mismo" paquete — así que disparaba de nuevo cada vez que
// `membresiaPaqueteId` llegaba con algo. `normalizar()` fuerza los dos
// lados a string ANTES de comparar/guardar, para que de verdad se
// comparen valores, no tipos.
const normalizar = (id) => (id === null || id === undefined ? "" : String(id));

export function useMembresiaActivadaNeon(conductorId, membresiaPaqueteId) {
  const [paqueteIdActivado, setPaqueteIdActivado] = useState(null);

  useEffect(() => {
    if (!conductorId) return;

    let ultimoVisto;
    try {
      ultimoVisto = window.localStorage.getItem(PREFIJO + conductorId);
    } catch {
      return; // Sin localStorage no hay forma segura de comparar — mejor no disparar nada.
    }

    const idActual = normalizar(membresiaPaqueteId);

    if (ultimoVisto === null) {
      try {
        window.localStorage.setItem(PREFIJO + conductorId, idActual);
      } catch {
        // no-op — no es crítico, en el peor caso se vuelve a intentar en el próximo render.
      }
      return;
    }

    if (idActual && idActual !== ultimoVisto) {
      setPaqueteIdActivado(idActual);
    }
  }, [conductorId, membresiaPaqueteId]);

  // Recién al TERMINAR la animación (no antes) se guarda como "visto"
  // — mismo criterio que useBienvenidaNeon.js: un refresh a mitad de
  // camino no debe perder el aviso para siempre.
  const marcarVista = useCallback(() => {
    if (!conductorId || !paqueteIdActivado) return;
    try {
      window.localStorage.setItem(PREFIJO + conductorId, paqueteIdActivado);
    } catch {
      // no-op
    }
    setPaqueteIdActivado(null);
  }, [conductorId, paqueteIdActivado]);

  return { paqueteIdActivado, marcarVista };
}
