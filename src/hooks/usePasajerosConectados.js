import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { CANAL_PRESENCIA_PASAJEROS } from "../lib/presencia";

// Se suscribe al canal de Presencia de Pasajeros (ver
// usePasajeroPresenciaTrack.js) SIN trackearse a sí mismo — solo
// escucha el evento "sync" para reconstruir, en cada cambio, quién está
// conectado ahora mismo. Devuelve un array de `{ usuarioId, nombreUsuario }`
// (no un Set pelado de ids): el propio payload de presencia YA trae el
// nombre de usuario, así un consumidor sin acceso a la lista completa
// de `usuarios` (el Conductor, ver ConductorPage.jsx) puede mostrar la
// lista directo. Un consumidor CON la lista completa (el Admin, ver
// UsuariosConectadosModal.jsx) simplemente arma su propio Set de ids
// desde acá para cruzar contra su roster y decidir el punto de color.
export function usePasajerosConectados() {
  const [conectados, setConectados] = useState([]);

  useEffect(() => {
    const channel = supabase.channel(CANAL_PRESENCIA_PASAJEROS);
    const sincronizar = () => {
      const estado = channel.presenceState();
      const lista = Object.values(estado)
        .map((metas) => metas[0])
        .filter(Boolean)
        .map((meta) => ({ usuarioId: String(meta.usuario_id), nombreUsuario: meta.nombre_usuario ?? null }));
      setConectados(lista);
    };
    channel.on("presence", { event: "sync" }, sincronizar);
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return conectados;
}
