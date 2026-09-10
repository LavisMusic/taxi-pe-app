import { useEffect } from "react";
import { supabase } from "../supabaseClient";
import { CANAL_PRESENCIA_CONDUCTORES } from "../lib/presencia";

// Mismo mecanismo que usePasajeroPresenciaTrack.js, del lado Conductor
// — se trackea mientras ConductorPage.jsx esté montado con sesión real.
// Trackeado por TELÉFONO (no por `usuario.id`) a propósito — bug
// reportado: "hay un conductor sin la sesión abierta y aún así se
// puede visualizar en el radar del pasajero". `conductores.estado`
// (Activo/Ocupado) es un valor GUARDADO en la base, no una señal de
// presencia real — si el conductor cierra la pestaña sin volver a
// tocar el switch, `estado` se queda "activo" para siempre y
// useConductoresPublicos.js lo sigue mostrando. La Presencia de acá es
// la señal real de "tiene la app abierta ahora mismo", y
// useConductoresPublicos.js la cruza directo contra `conductores.telefono`
// (el mismo campo que ya usa como puente con `usuarios`, ver
// useConductorSesion.js) — por eso el teléfono, no el id de usuario:
// así ese cruce no necesita traer la tabla `usuarios` completa a una
// pantalla pública/anónima (algo que ese hook ya evita a propósito).
export function useConductorPresenciaTrack(telefono, nombreMostrado) {
  useEffect(() => {
    if (!telefono) return undefined;
    const channel = supabase.channel(CANAL_PRESENCIA_CONDUCTORES, {
      config: { presence: { key: String(telefono) } },
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channel.track({
          telefono,
          nombre: nombreMostrado ?? null,
          conectado_en: new Date().toISOString(),
        });
      }
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [telefono, nombreMostrado]);
}
