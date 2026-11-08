// Diamante punta a punta (misma forma que el contador de gemas) en SVG —
// MISMO archivo en Taxi-PE y Caja (src/components/IconoGema.jsx). Reemplaza
// a los emojis 💚/🩵: el 🩵 no existe en Windows 10 y salía un cuadrito.
const TONOS = {
  verde: ["#b6ffe2", "#39ffb0", "#0c9e6c"],
  celeste: ["#d6fbff", "#2be8ff", "#0a86b0"],
};

export default function IconoGema({ color = "celeste", size = 16, className = "" }) {
  const [claro, medio, oscuro] = TONOS[color] || TONOS.celeste;
  const id = `tz-ig-${color}`;
  return (
    <svg
      className={`tz-icono-gema ${className}`}
      width={size}
      height={size * 1.15}
      viewBox="0 0 20 23"
      aria-hidden="true"
      style={{ filter: `drop-shadow(0 0 ${Math.max(2, size / 4)}px ${medio})`, flexShrink: 0, verticalAlign: "middle" }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={claro} />
          <stop offset="0.5" stopColor={medio} />
          <stop offset="1" stopColor={oscuro} />
        </linearGradient>
      </defs>
      {/* corona (arriba) y pabellón (abajo), punta a punta */}
      <polygon points="10,0 20,9 10,23 0,9" fill={`url(#${id})`} />
      <polygon points="10,0 20,9 10,9" fill={claro} opacity="0.55" />
      <polygon points="10,0 0,9 10,9" fill={claro} opacity="0.25" />
      <polygon points="0,9 10,9 10,23" fill={oscuro} opacity="0.35" />
      <polyline points="0,9 20,9" stroke={claro} strokeWidth="0.8" opacity="0.8" fill="none" />
    </svg>
  );
}
