import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { subscribeTable } from "../lib/realtime";
import { ESTADO_CONDUCTOR_ACTIVO, ESTADO_CONDUCTOR_OCUPADO } from "../lib/taxiEnums";

// Fetch público (sin sesión) para la Home del pasajero.
//
// Tres filtros, todos hechos en la query — no en el render:
//   1) .in("estado", [activo, ocupado]) — un conductor 'desconectado'
//      (o 'pendiente'/'rechazado') nunca sale del servidor.
//   2) .eq("aprobado", true) — un conductor recién auto-registrado
//      (self-registro en /login) puede tocar su propio toggle de
//      estado en /conductor ANTES de que el Admin lo revise; sin este
//      filtro se colaría en la Home pública con solo marcarse "Activo",
//      saltándose el Centro de Peticiones por completo.
//   3) select() explícito SIN `creditos` ni `vencimiento_suscripcion`
//      — privacidad real, esos campos ni siquiera llegan al navegador,
//      no es solo "no mostrarlos" en la tarjeta.
export function useConductoresPublicos() {
  const [conductores, setConductores] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Bug reportado: cada evento de Realtime volvía a mostrar la
  // pantalla completa "Buscando conductores…" — porque `refresh()`
  // prendía `loading` en CADA llamada, no solo la primera. Con esto,
  // un conductor que pasa de Libre a En Carrera actualiza el DOM al
  // toque sin tapar la lista con el spinner de nuevo.
  const yaCargoUnaVez = useRef(false);

  const refresh = useCallback(async () => {
    if (!yaCargoUnaVez.current) setLoading(true);
    setError("");
    const [conductoresRes, categoriasRes] = await Promise.all([
      supabase
        .from("conductores")
        .select(
          "id, nombre, placa, telefono, foto_url, foto_portada_url, descripcion, estado, categoria_id, localidad, nivel_servicio, subgrupo_id, asientos_totales, asientos_ocupados"
        )
        .eq("aprobado", true)
        .in("estado", [ESTADO_CONDUCTOR_ACTIVO, ESTADO_CONDUCTOR_OCUPADO]),
      supabase.from("categorias").select("id, nombre, orden, icono_url").order("orden", { ascending: true }),
    ]);

    if (conductoresRes.error || categoriasRes.error) {
      setError("No se pudo cargar el directorio de conductores.");
    } else {
      setConductores(conductoresRes.data ?? []);
      setCategorias(categoriasRes.data ?? []);
    }
    yaCargoUnaVez.current = true;
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Un pasajero mirando la Home tiene que ver "Libre" <-> "En carrera"
  // en vivo, sin F5 — mismo canal que useConductores.js, esta vez del
  // lado público.
  useEffect(() => subscribeTable("conductores", () => refresh()), [refresh]);

  // Fix Contador Congelado (Fase 5): la publicación de Realtime de
  // `conductores` ya está confirmada activa — el "stale" reportado
  // específicamente en pestañas de escritorio dejadas abiertas mucho
  // tiempo encaja con un patrón conocido de los WebSockets de Supabase
  // Realtime: pueden desconectarse en silencio (suspensión del SO,
  // cambio de red, laptop que durmió) SIN disparar ningún evento de
  // error visible — el canal queda "suscrito" en apariencia, pero
  // ningún evento nuevo vuelve a llegar nunca. Un celular tiende a
  // recargar la pestaña solo con más frecuencia (background del
  // navegador/app), lo que disimula el mismo bug — por eso se nota más
  // en PC. Este listener es la red de seguridad: sin importar qué le
  // pasó al WebSocket mientras la pestaña estuvo en segundo plano, un
  // refresh manual (fetch normal, no depende de Realtime) corre apenas
  // el pasajero vuelve a mirarla.
  useEffect(() => {
    const alVolverVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", alVolverVisible);
    return () => document.removeEventListener("visibilitychange", alVolverVisible);
  }, [refresh]);

  return { conductores, categorias, loading, error, refresh };
}
