import { useEffect } from "react";
import { supabase } from "../supabaseClient";
import { CANAL_PRESENCIA_CONDUCTORES } from "../lib/presencia";

// Mismo mecanismo que usePasajeroPresenciaTrack.js, del lado Conductor:
// mientras ConductorPage.jsx esté montado con sesión, el conductor se
// "trackea" en el canal de Presencia (no escribe nada en la base). Lo usa
// el visor "Usuarios Conectados" del Admin. Va por el id de su cuenta
// (`usuarios.id`), NO por su teléfono: el canal de Presencia lo puede
// escuchar cualquiera con la llave pública, y el teléfono del conductor
// no debe ser público.
export function useConductorPresenciaTrack(usuarioId) {
  useEffect(() => {
    if (!usuarioId) return undefined;
    const channel = supabase.channel(CANAL_PRESENCIA_CONDUCTORES, {
      config: { presence: { key: String(usuarioId) } },
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channel.track({ usuario_id: usuarioId, conectado_en: new Date().toISOString() });
      }
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [usuarioId]);
}
