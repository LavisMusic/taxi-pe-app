// Migración Mapbox (Fase 1 — Tiles): reemplaza los tiles de
// OpenStreetMap por el estilo oscuro de Mapbox en TODOS los
// `<MapContainer>` de la app (MapaViaje.jsx, RadarGlobal.jsx,
// AdminLocalidadesModal.jsx) — un solo lugar para la URL/token en vez de
// repetirla en cada componente, así un cambio de estilo (ej. pasar de
// 'dark-v11' a otro) se hace una sola vez.
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// Formato estricto pedido: tiles de 256px @2x (retina), estilo
// 'dark-v11' — el oscuro profesional que pidió el usuario para que
// combine con el resto de la UI neón de esta app.
export const MAPBOX_TILE_URL = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/tiles/256/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`;

// Atribución exigida por los términos de uso de Mapbox — reemplaza a la
// de OpenStreetMap sola (Mapbox sigue usando datos de OSM por debajo,
// así que ambas van juntas, es el crédito estándar que pide Mapbox).
export const MAPBOX_ATTRIBUTION =
  '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
