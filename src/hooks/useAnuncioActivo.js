import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { FRECUENCIA_UNA_VEZ_DIA, FRECUENCIA_UNA_VEZ_TOTAL } from "../lib/taxiEnums";

const VEINTICUATRO_HORAS_MS = 24 * 60 * 60 * 1000;
const keyVisto = (id) => `tz-anuncio-${id}-visto`;
const keyUltimaVez = (id) => `tz-anuncio-${id}-ts`;

// Decide si a ESTE visitante (localStorage, por dispositivo/navegador,
// no hay cuenta de por medio para un invitado anónimo) le toca ver de
// nuevo un anuncio puntual, según su `frecuencia_mostrar`:
//   - 'una_vez_total': una vez en la vida — si ya lo vio, nunca más.
//   - 'una_vez_dia': una vez cada 24h reales desde la última vez que
//     se le mostró (no "una vez por día calendario").
//   - 'siempre' (o cualquier otro valor): sin freno, se re-evalúa en
//     cada carga — la única condición que importa es la vigencia
//     (fecha_inicio/fecha_fin), ya filtrada antes de llegar acá.
function tocaMostrar(anuncio) {
  if (anuncio.frecuencia_mostrar === FRECUENCIA_UNA_VEZ_TOTAL) {
    return localStorage.getItem(keyVisto(anuncio.id)) !== "1";
  }
  if (anuncio.frecuencia_mostrar === FRECUENCIA_UNA_VEZ_DIA) {
    const ultima = Number(localStorage.getItem(keyUltimaVez(anuncio.id)) || 0);
    return Date.now() - ultima >= VEINTICUATRO_HORAS_MS;
  }
  return true;
}

// Marca que este anuncio YA se mostró — lo llama el modal apenas se
// monta (no al cerrarlo: si el pop-up se muestra, cuenta como "visto",
// cerrarlo con la X o dejándolo abierto es indistinto para la regla de
// frecuencia).
function marcarComoVisto(anuncio) {
  if (anuncio.frecuencia_mostrar === FRECUENCIA_UNA_VEZ_TOTAL) {
    localStorage.setItem(keyVisto(anuncio.id), "1");
  } else if (anuncio.frecuencia_mostrar === FRECUENCIA_UNA_VEZ_DIA) {
    localStorage.setItem(keyUltimaVez(anuncio.id), String(Date.now()));
  }
}

// Vista Cliente: busca, entre los anuncios activos y vigentes AHORA
// (fecha_inicio/fecha_fin, ambos opcionales — sin tope de un lado
// significa "sin límite" de ese lado), el primero (por `orden`) al que
// todavía le toque aparecer según su frecuencia — si el primero ya se
// agotó (ej. 'una_vez_total' ya visto), prueba con el siguiente en vez
// de no mostrar nada.
// `publico`: "pasajeros" (Home) o "conductores" (pantalla del conductor);
// también entran los anuncios para "todos". Sin la migración
// 20261007100000 (sin columna "publico") los anuncios son solo de
// pasajeros, como antes.
const ROL_DE_PUBLICO = { pasajeros: "pasajero", conductores: "conductor", recolectores: "recolector" };

export function useAnuncioActivo(publico = "pasajeros") {
  // Todos los que tocan ahora (carrusel, AnuncioPopupModal `anuncios`).
  const [anuncios, setAnuncios] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const ahora = new Date().toISOString();
        // Vigencia en la propia query (menos filas que traer): sin
        // fecha_inicio/fecha_fin en la fila, esa cota no aplica —
        // `.or()` con "is.null" cubre ese caso por cada extremo.
        // Por rol (anuncios.roles, migración 20261022120000; los crea el
        // superadmin desde Caja). Sin esa columna, por `publico` como antes.
        const consultar = (filtro) => {
          let q = supabase
            .from("anuncios")
            .select("id, titulo, descripcion, imagen_url, video_url, fecha_inicio, fecha_fin, frecuencia_mostrar, orden")
            .eq("activo", true)
            .or(`fecha_inicio.is.null,fecha_inicio.lte.${ahora}`)
            .or(`fecha_fin.is.null,fecha_fin.gte.${ahora}`)
            .order("orden", { ascending: true })
            .order("created_at", { ascending: false });
          if (filtro === "roles") q = q.contains("roles", [ROL_DE_PUBLICO[publico] ?? "pasajero"]);
          if (filtro === "publico") q = q.in("publico", [publico, "todos"]);
          return q;
        };
        let { data, error } = await consultar("roles");
        if (error) ({ data, error } = await consultar("publico"));

        if (cancelado) return;
        setAnuncios(error || !data ? [] : data.filter((a) => tocaMostrar(a)));
      } catch {
        if (!cancelado) setAnuncios([]);
      }
      if (!cancelado) setLoading(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [publico]);

  // Cerrar el carrusel cuenta como visto para todos los que mostró.
  const cerrar = () => {
    anuncios.forEach(marcarComoVisto);
    setAnuncios([]);
  };

  return { anuncio: anuncios[0] ?? null, anuncios, loading, cerrar };
}
