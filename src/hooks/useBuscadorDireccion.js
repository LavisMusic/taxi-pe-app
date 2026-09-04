import { useEffect, useRef, useState } from "react";

// Migración Mapbox (Fase 2 — Geocoding): reemplaza a Nominatim/OSM.
// Token público del `.env` (`VITE_MAPBOX_TOKEN`) — Vite solo expone al
// bundle las variables con prefijo `VITE_`, y al ser un token PÚBLICO de
// Mapbox (no un secret key) no hay problema en que viaje en el bundle
// del cliente, es el uso normal de esta API.
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
const MAPBOX_GEOCODING_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places";
// Mapbox no tiene la política estricta de "1 request/segundo" de
// Nominatim, pero el debounce se mantiene igual — sigue siendo la
// diferencia entre 1 request por búsqueda terminada y una por cada
// tecla mientras el pasajero todavía está escribiendo.
const DEBOUNCE_MS = 800;
// Menos de esto ni se molesta en pegarle a la API — 1-2 letras solo
// generan ruido (resultados inútiles) y gastan cuota.
const LARGO_MINIMO = 2;
// Medio-ancho del cuadro de búsqueda alrededor del centro de la
// localidad filtrada, en grados (~13km) — mismo valor que ya usaba el
// `viewbox` de Nominatim, ahora armado como `bbox` de Mapbox
// (minLon,minLat,maxLon,maxLat).
const BBOX_DELTA_GRADOS = 0.12;

// Autocompletado de direcciones vía Mapbox Geocoding v5 — reemplaza al
// viejo Nominatim (OpenStreetMap). Debounce de 800ms + AbortController
// (cancela la búsqueda anterior si el pasajero sigue escribiendo), igual
// que antes. `localidadFiltro` se suma a la query para acotar resultados
// a la zona que el pasajero ya filtró en la Home (ver RadarGlobal.jsx).
// `viewboxCoords` ({lat,lon}, opcional — el centro de esa MISMA
// localidad, definido por el Admin en AdminLocalidadesModal.jsx): si
// llega, además se manda `bbox` para que Mapbox directamente NO
// devuelva resultados fuera de esa zona (equivalente al
// `viewbox`+`bounded=1` de Nominatim).
//
// Fix de compatibilidad (sin tocar a los consumidores): RadarGlobal.jsx
// y AdminLocalidadesModal.jsx ya esperan `{ place_id, display_name, lat,
// lon }` (la forma de Nominatim) — en vez de salir a actualizar los dos
// componentes, este hook mapea la respuesta GeoJSON de Mapbox a esa
// MISMA forma, así el resto de la app no se entera del cambio de
// proveedor.
export function useBuscadorDireccion(texto, localidadFiltro, viewboxCoords) {
  const [sugerencias, setSugerencias] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const abortRef = useRef(null);
  const lat = viewboxCoords?.lat;
  const lon = viewboxCoords?.lon;

  useEffect(() => {
    const query = (texto ?? "").trim();
    if (query.length < LARGO_MINIMO) {
      setSugerencias([]);
      setBuscando(false);
      return undefined;
    }
    if (!MAPBOX_TOKEN) {
      // Sin token no hay forma de buscar — falla silenciosa (sin
      // resultados) en vez de tirar la app entera, mismo criterio que
      // el resto de los fallos de red de este hook.
      console.error("VITE_MAPBOX_TOKEN no está configurado — el buscador de direcciones no puede funcionar.");
      setSugerencias([]);
      setBuscando(false);
      return undefined;
    }

    setBuscando(true);
    const timeoutId = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Mismo criterio que antes: sumar la localidad filtrada como
      // texto ayuda a Mapbox a priorizar sin depender 100% del `bbox`.
      const partesQuery = [query, localidadFiltro].filter(Boolean).join(", ");
      const params = new URLSearchParams({
        country: "pe",
        language: "es",
        access_token: MAPBOX_TOKEN,
      });
      if (typeof lat === "number" && typeof lon === "number") {
        const izquierda = lon - BBOX_DELTA_GRADOS;
        const derecha = lon + BBOX_DELTA_GRADOS;
        const arriba = lat + BBOX_DELTA_GRADOS;
        const abajo = lat - BBOX_DELTA_GRADOS;
        params.set("bbox", `${izquierda},${abajo},${derecha},${arriba}`);
      }
      const url = `${MAPBOX_GEOCODING_URL}/${encodeURIComponent(partesQuery)}.json?${params.toString()}`;

      fetch(url, { signal: controller.signal })
        .then((res) => res.json())
        .then((data) => {
          const features = Array.isArray(data?.features) ? data.features : [];
          // Inversión de Coordenadas: Mapbox devuelve la geometría en
          // formato GeoJSON — `feature.center` es `[lon, lat]`, al
          // revés de lo que devolvía Nominatim (`lat`/`lon` sueltos) y
          // de lo que espera el resto de la app (Leaflet/React
          // trabajan en `{lat, lon}`). Mapear mal esto acá sería el
          // típico "el pin cae en el medio del océano".
          const mapeadas = features.map((feature) => {
            const lonFeature = feature.center?.[0];
            const latFeature = feature.center?.[1];
            return {
              place_id: feature.id,
              display_name: feature.place_name,
              lat: latFeature,
              lon: lonFeature,
            };
          });
          setSugerencias(mapeadas);
        })
        .catch((err) => {
          if (err.name !== "AbortError") setSugerencias([]);
        })
        .finally(() => setBuscando(false));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [texto, localidadFiltro, lat, lon]);

  return { sugerencias, buscando };
}
