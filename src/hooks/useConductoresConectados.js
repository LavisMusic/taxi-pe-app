import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { CANAL_PRESENCIA_CONDUCTORES } from "../lib/presencia";

// Espejo de usePasajerosConectados.js, para el canal de Presencia de
// Conductores (ver useConductorPresenciaTrack.js) — clave por
// TELÉFONO, no por id de usuario (ver el comentario largo en ese
// hook). Devuelve además `loaded` (pedido implícito por el bug de
// visibilidad, ver useConductoresPublicos.js): el primer evento
// "sync" de Presencia tarda un instante en llegar después de
// `subscribe()` — sin esta bandera, un consumidor que filtre por
// "está conectado" vería a TODOS como desconectados durante ese
// primer instante (antes de que llegue el primer sync), así que
// conviene distinguir "todavía no sincronizó" de "sincronizó y no
// hay nadie".
export function useConductoresConectados() {
  const [conectados, setConectados] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const channel = supabase.channel(CANAL_PRESENCIA_CONDUCTORES);
    const sincronizar = () => {
      const estado = channel.presenceState();
      const lista = Object.values(estado)
        .map((metas) => metas[0])
        .filter(Boolean)
        .map((meta) => ({ telefono: String(meta.telefono), nombre: meta.nombre ?? null }));
      setConectados(lista);
      setLoaded(true);
    };
    channel.on("presence", { event: "sync" }, sincronizar);
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { conectados, loaded };
}
