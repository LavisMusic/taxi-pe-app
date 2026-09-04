import { MAPBOX_TOKEN } from "./mapboxConfig";

const MAPBOX_GEOCODING_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places";

// Migración Mapbox (cierre de la infraestructura — Nominatim apagado
// del todo): geocodificación inversa vía Mapbox — el pin manual del
// Radar (ver RadarGlobal.jsx) solo tiene lat/lon; esto le pone un
// nombre real para que lo use el mensaje automático de contacto
// ("...hasta {nombre}?", ver ChatModal.jsx).
//
// Firma idéntica a la versión Nominatim de antes — `(lat, lon)` en ese
// orden, devuelve un `string` corto — a propósito, para no tener que
// tocar RadarGlobal.jsx (el único consumidor): sigue llamando
// `reverseGeocode(lat, lon)` y esperando de vuelta un nombre de lugar
// listo para mostrar.
//
// Inversión de Coordenadas: Mapbox exige la URL en orden `lon,lat`
// (al revés del `(lat, lon)` de esta función y de Nominatim) — armar
// mal esto acá sería pedir la geocodificación de un punto en las
// antípodas.
export async function reverseGeocode(lat, lon) {
  if (!MAPBOX_TOKEN) throw new Error("VITE_MAPBOX_TOKEN no está configurado.");

  const url = `${MAPBOX_GEOCODING_URL}/${lon},${lat}.json?language=es&access_token=${MAPBOX_TOKEN}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Mapbox reverse geocoding respondió ${res.status}`);

  const data = await res.json();
  const feature = data?.features?.[0];
  if (!feature) throw new Error("Mapbox no devolvió ningún resultado para ese punto");

  // Mismo criterio que la versión Nominatim: preferir el nombre CORTO
  // y reconocible (`text` — ej. el nombre de la calle/lugar puntual)
  // antes que `place_name`, que trae la dirección entera con
  // distrito/provincia/país incluidos.
  const nombreCorto = feature.text;
  if (nombreCorto) return nombreCorto;

  const placeName = feature.place_name;
  if (!placeName) throw new Error("Mapbox no devolvió un nombre de lugar");
  // Sin ningún campo corto reconocible, al menos recortamos el primer
  // tramo de `place_name` en vez de mandar la dirección completa.
  return placeName.split(",")[0].trim();
}
