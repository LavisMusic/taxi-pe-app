import { useEffect } from "react";
import { supabase } from "../supabaseClient";
import { CANAL_PRESENCIA_PASAJEROS } from "../lib/presencia";

// Lado Pasajero del visor de conectados (Admin: UsuariosConectadosModal.jsx
// / Conductor: el desplegable de su header izquierdo, ver
// ConductorPage.jsx) — mientras HomePage.jsx esté montado con una
// sesión de Pasajero real, esto se "trackea" a sí mismo en el canal de
// Presencia de Supabase Realtime — NO escribe nada en la base, es una
// lista en memoria que vive del lado del servidor de Realtime mientras
// el WebSocket siga conectado. Suelta la conexión sola al desmontar
// (cerrar sesión, cambiar de pestaña a otra ruta) — Supabase también la
// suelta sola si el socket se cae (cerrar la pestaña, perder internet),
// así que "conectado" siempre refleja una sesión con la app REALMENTE
// abierta, no un simple login guardado en localStorage.
//
// `nombreUsuario` viaja en el payload de presencia (no solo el id) para
// que un consumidor SIN acceso a la lista completa de `usuarios` (como
// el Conductor, ver usePasajerosConectados.js) pueda mostrar el nombre
// directo, sin necesitar una consulta aparte.
export function usePasajeroPresenciaTrack(usuarioId, nombreUsuario) {
  useEffect(() => {
    if (!usuarioId) return undefined;
    const channel = supabase.channel(CANAL_PRESENCIA_PASAJEROS, {
      config: { presence: { key: String(usuarioId) } },
    });
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channel.track({
          usuario_id: usuarioId,
          nombre_usuario: nombreUsuario ?? null,
          conectado_en: new Date().toISOString(),
        });
      }
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [usuarioId, nombreUsuario]);
}
