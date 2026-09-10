import { useEffect, useRef } from "react";
import { supabase } from "../supabaseClient";
import { ESTADO_VERIFICACION_PERMANENTE } from "../lib/taxiEnums";

// Pedido: "al aceptar la petición de verificación al conductor, le debe
// salir un aviso... en tiempo real". El Admin aprueba desde SU PROPIA
// sesión (PeticionesModal.jsx -> useConductores.js `aprobar()`), que
// escribe `usuarios.estado_verificacion = 'permanente'` en la fila del
// conductor — eso pasa en OTRO navegador/pestaña, así que la única
// forma de enterarse sin F5 es una suscripción Realtime propia a esa
// fila (a diferencia de `conductor.estado`/`aprobado`, que ya llegan en
// vivo vía useConductorSesion.js porque leen la tabla `conductores`, no
// `usuarios`).
//
// Detecta la transición HACIA 'permanente' comparando el valor nuevo
// contra el que YA teníamos (guardado en un ref, no en el estado de
// React) — no contra `payload.old`, que Supabase Realtime no siempre
// manda (depende de REPLICA IDENTITY en la tabla, que acá no está
// garantizada) — así solo dispara el aviso la primera vez que de
// verdad pasa a 'permanente', nunca en updates posteriores donde ya lo
// era.
//
// `onAprobado`/`onActualizar` viajan por ref (no como dependencias del
// efecto) a propósito: son callbacks que el caller normalmente pasa
// como funciones nuevas en cada render (`() => mostrar(...)`) — sin
// esto, el canal de Realtime se recrearía en cada render de
// ConductorPage.jsx en vez de abrirse una sola vez por sesión.
export function useVerificacionAprobadaRealtime(usuario, onAprobado, onActualizar) {
  const estadoRef = useRef(usuario?.estado_verificacion);
  const onAprobadoRef = useRef(onAprobado);
  const onActualizarRef = useRef(onActualizar);

  useEffect(() => {
    estadoRef.current = usuario?.estado_verificacion;
    onAprobadoRef.current = onAprobado;
    onActualizarRef.current = onActualizar;
  });

  useEffect(() => {
    if (!usuario?.id) return undefined;
    const channel = supabase
      .channel(`usuario-verificacion-${usuario.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "usuarios", filter: `id=eq.${usuario.id}` },
        ({ new: fila }) => {
          if (!fila) return;
          if (
            fila.estado_verificacion === ESTADO_VERIFICACION_PERMANENTE &&
            estadoRef.current !== ESTADO_VERIFICACION_PERMANENTE
          ) {
            onAprobadoRef.current?.();
          }
          onActualizarRef.current?.(fila);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [usuario?.id]);
}
