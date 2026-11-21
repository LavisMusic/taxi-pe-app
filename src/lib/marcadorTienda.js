/* Marcador de la tienda en los mapas — MISMO archivo en Taxi-PE y Caja
   (src/lib/marcadorTienda.js): mantener iguales.
   El logo del negocio dentro de un círculo con luz que late (o 🏪 si no
   tiene logo) y el nombre de la sucursal debajo, sin cuadro: solo el
   texto con sombra para que se lea sobre el mapa.
   Devuelve la especificación de un L.divIcon ({ className, html,
   iconSize, iconAnchor }): sirve tal cual con L.divIcon o con divIconLuz
   (RutaNeon.jsx), que le suma la luz de la ruta. */

const CSS = `
.tz-mt-wrap { background: none; border: 0; }
.tz-mt { position: relative; width: var(--tam); height: var(--tam); animation: tz-mt-entra .7s cubic-bezier(.34,1.56,.64,1) both; }
.tz-mt-cara { width: 100%; height: 100%; box-sizing: border-box; border-radius: 50%; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: #120c22; border: 2px solid var(--pink, #ff2f9e);
  box-shadow: 0 0 0 4px rgba(var(--pink-rgb, 255,47,158), .18), 0 0 14px rgba(var(--pink-rgb, 255,47,158), .55);
  animation: tz-mt-luz 2.6s ease-in-out .7s infinite; }
.tz-mt-cara img { width: 100%; height: 100%; object-fit: cover; }
.tz-mt-emoji { font-size: calc(var(--tam) * .5); line-height: 1; }
.tz-mt-nombre { position: absolute; top: calc(100% + 3px); left: 50%; transform: translateX(-50%);
  white-space: nowrap; max-width: 170px; overflow: hidden; text-overflow: ellipsis;
  font: 800 11px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; letter-spacing: .01em;
  text-shadow: 0 0 2px #000, 0 0 4px #000, 0 1px 6px rgba(0,0,0,.9); pointer-events: none; }
@keyframes tz-mt-entra { from { opacity: 0; transform: scale(.3) translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes tz-mt-luz {
  0%, 100% { box-shadow: 0 0 0 4px rgba(var(--pink-rgb, 255,47,158), .18), 0 0 14px rgba(var(--pink-rgb, 255,47,158), .55); }
  50% { box-shadow: 0 0 0 7px rgba(var(--pink-rgb, 255,47,158), .08), 0 0 22px rgba(var(--pink-rgb, 255,47,158), .8); }
}
`;

function asegurarEstilo() {
  if (typeof document === "undefined" || document.getElementById("tz-marcador-tienda-css")) return;
  const s = document.createElement("style");
  s.id = "tz-marcador-tienda-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

const escapar = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function iconoTienda({ nombre = "", logo = null, tam = 38 } = {}) {
  asegurarEstilo();
  const cara = logo ? `<img src="${escapar(logo)}" alt="" />` : '<span class="tz-mt-emoji">🏪</span>';
  return {
    className: "tz-mt-wrap",
    html: `<div class="tz-mt" style="--tam:${tam}px"><div class="tz-mt-cara">${cara}</div>${
      nombre ? `<span class="tz-mt-nombre">${escapar(nombre)}</span>` : ""
    }</div>`,
    iconSize: [tam, tam],
    iconAnchor: [tam / 2, tam / 2], // al centro: la ruta empieza/termina en el medio
  };
}
