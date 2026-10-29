import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

// Celebración "¡Viaje finalizado!" fuera del chat: si el viaje se cierra
// (la oferta pasa a 'finalizado') mientras el chat está cerrado —o con la
// app cerrada—, se festeja al volver a la pantalla principal. Con el chat
// abierto la celebración la hace ChatWindow; acá solo se marca como vista.
// `campo`: 'pasajero_id' (pasajero) o 'conductor_id' (conductor).
// Lo ya festejado se recuerda por usuario en este navegador.
const DIAS_ATRAS = 2;

function leer(clave) {
  try {
    const v = window.localStorage.getItem(clave);
    return v == null ? null : new Set(JSON.parse(v));
  } catch {
    return null;
  }
}
function guardar(clave, ids) {
  try {
    window.localStorage.setItem(clave, JSON.stringify([...ids].slice(-200)));
  } catch {
    // Sin almacenamiento: a lo sumo se repite un festejo.
  }
}

export function useViajeFinalizadoAviso({ campo, valor, chatAbierto }) {
  const [pendiente, setPendiente] = useState(null);
  const chatAbiertoRef = useRef(chatAbierto);
  chatAbiertoRef.current = chatAbierto;
  const clave = valor ? `tz-viajes-festejados-${campo}-${valor}` : null;

  const revisar = useCallback(async () => {
    if (!clave) return;
    const desde = new Date(Date.now() - DIAS_ATRAS * 86400000).toISOString();
    const { data, error } = await supabase
      .from("chat_mensajes")
      .select("id")
      .eq(campo, valor)
      .eq("tipo", "oferta")
      .eq("estado_oferta", "finalizado")
      .gte("created_at", desde);
    if (error || !data) return;
    let vistos = leer(clave);
    if (!vistos) {
      // Primera vez en este navegador: lo anterior no se festeja.
      guardar(clave, new Set(data.map((f) => f.id)));
      return;
    }
    const nuevo = data.find((f) => !vistos.has(f.id));
    if (!nuevo) return;
    vistos.add(nuevo.id);
    guardar(clave, vistos);
    if (!chatAbiertoRef.current) setPendiente(nuevo.id);
  }, [campo, valor, clave]);

  useEffect(() => {
    if (!clave) return undefined;
    revisar();
    const channel = supabase
      .channel(`viaje-fin-${campo}-${valor}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "chat_mensajes", filter: `${campo}=eq.${valor}` },
        ({ new: fila }) => {
          if (fila?.tipo === "oferta" && fila?.estado_oferta === "finalizado") revisar();
        }
      )
      .subscribe();
    const alVolver = () => {
      if (document.visibilityState === "visible") revisar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      supabase.removeChannel(channel);
    };
  }, [campo, valor, clave, revisar]);

  return { festejar: !!pendiente, cerrar: () => setPendiente(null) };
}
