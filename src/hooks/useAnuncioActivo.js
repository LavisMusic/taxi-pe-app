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

// Con sesión, lo visto es por PERSONA (anuncios_vistos): "Una sola vez" no
// vuelve a salir en otro navegador ni en una ventana privada, y
// "Programado (una vez al día)" sale cada 24 h hasta su fecha de fin. Sin
// sesión, por navegador como antes.
async function vistosDeLaPersona(ids) {
  const { data: sesion } = await supabase.auth.getSession();
  const uid = sesion?.session?.user?.id;
  if (!uid || ids.length === 0) return null;
  const { data, error } = await supabase.from("anuncios_vistos").select("anuncio_id, visto_at").in("anuncio_id", ids);
  if (error) return null;
  return Object.fromEntries((data || []).map((v) => [v.anuncio_id, new Date(v.visto_at).getTime()]));
}

function tocaMostrarA(anuncio, vistos) {
  if (!vistos) return tocaMostrar(anuncio);
  const visto = vistos[anuncio.id];
  if (anuncio.frecuencia_mostrar === "una_vez_total") return !visto;
  if (anuncio.frecuencia_mostrar === "una_vez_dia") return !visto || Date.now() - visto >= VEINTICUATRO_HORAS_MS;
  return true;
}

// Se llama apenas el anuncio se ve en pantalla (no al cerrarlo: si la
// persona se va sin cerrar, igual cuenta como visto).
async function registrarVisto(anuncio) {
  marcarComoVisto(anuncio);
  const { data: sesion } = await supabase.auth.getSession();
  if (!sesion?.session?.user?.id) return;
  await supabase
    .from("anuncios_vistos")
    .upsert({ anuncio_id: anuncio.id, visto_at: new Date().toISOString() }, { onConflict: "anuncio_id,usuario_id" })
    .then(() => {}, () => {});
}

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
            .select("id, titulo, descripcion, imagen_url, video_url, boton_url, boton_texto, fecha_inicio, fecha_fin, frecuencia_mostrar, orden")
            .eq("activo", true)
            .or(`fecha_inicio.is.null,fecha_inicio.lte.${ahora}`)
            .or(`fecha_fin.is.null,fecha_fin.gte.${ahora}`)
            .order("orden", { ascending: true })
            .order("created_at", { ascending: true });
          if (filtro === "roles") q = q.contains("roles", [ROL_DE_PUBLICO[publico] ?? "pasajero"]);
          if (filtro === "publico") q = q.in("publico", [publico, "todos"]);
          return q;
        };
        let { data, error } = await consultar("roles");
        if (error) ({ data, error } = await consultar("publico"));

        if (cancelado) return;
        const lista = error || !data ? [] : data;
        const vistos = await vistosDeLaPersona(lista.map((a) => a.id));
        if (cancelado) return;
        setAnuncios(lista.filter((a) => tocaMostrarA(a, vistos)));
      } catch {
        if (!cancelado) setAnuncios([]);
      }
      if (!cancelado) setLoading(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [publico]);

  const cerrar = () => setAnuncios([]);

  // `alVer`: para AnuncioPopupModal (cada anuncio del carrusel al mostrarse).
  return { anuncio: anuncios[0] ?? null, anuncios, loading, cerrar, alVer: registrarVisto };
}
