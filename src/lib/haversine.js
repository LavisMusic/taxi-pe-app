// Distancia en línea recta entre dos coordenadas GPS, en metros —
// fórmula estándar de Haversine (suficiente para "¿ya llegó?", no hace
// falta la distancia real por calle). Usada para la alerta de
// proximidad al destino (MapaViaje.jsx / ChatWindow.jsx).
const RADIO_TIERRA_M = 6371000;

function aRadianes(grados) {
  return (grados * Math.PI) / 180;
}

export function distanciaMetros(lat1, lon1, lat2, lon2) {
  const dLat = aRadianes(lat2 - lat1);
  const dLon = aRadianes(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(aRadianes(lat1)) * Math.cos(aRadianes(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return RADIO_TIERRA_M * c;
}
