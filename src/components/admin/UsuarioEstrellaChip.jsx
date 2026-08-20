import { useState } from "react";
import { Star, Trophy } from "lucide-react";
import { formatSoles } from "../../utils/format";

const ROLES = [
  { key: "conductores", label: "Conductor" },
  { key: "pasajeros", label: "Pasajero" },
  { key: "recolectores", label: "Recolector" },
];

// Tarjeta "Usuario Estrella" — el doble de ancha que un .tz-stat-chip
// normal (col-span-2, ver .tz-stat-chip-star en Styles.jsx: llena el
// hueco que quedaba vacío a la derecha cuando StatsSection ya ocupó
// las otras 3 columnas + 1). Horizontal y plana a propósito: selector
// de rol en una sola fila, y debajo un carrusel Top 5 (scroll-snap,
// una tarjeta = 100% del ancho visible) en vez de la lista vertical
// vieja de un solo puesto — desliza para ver del #1 al #5.
export default function UsuarioEstrellaChip({ ranking }) {
  const [rol, setRol] = useState("conductores");
  const top5 = (ranking[rol] ?? []).slice(0, 5);
  const sinDatosPasajeros = rol === "pasajeros";

  return (
    <div className="tz-stat-chip tz-stat-chip-star">
      <span className="tz-stat-label">
        <Star size={13} /> Usuario Estrella
      </span>

      <div className="tz-gasto-tipo-buttons tz-star-roles" style={{ margin: "2px 0" }}>
        {ROLES.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`tz-gasto-tipo-btn ${rol === r.key ? "tz-gasto-tipo-active" : ""}`}
            onClick={() => setRol(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {sinDatosPasajeros ? (
        <span className="tz-stat-sub">Sin datos suficientes aún</span>
      ) : top5.length === 0 ? (
        <span className="tz-stat-sub">Aún sin ventas</span>
      ) : (
        <div className="tz-star-carousel">
          {top5.map((u, i) => (
            <div key={u.id} className="tz-star-carousel-item">
              <span className="tz-star-carousel-rank">
                {i === 0 ? <Trophy size={14} /> : `#${i + 1}`}
              </span>
              <span className="tz-star-carousel-info">
                <span className="tz-star-text tz-star-carousel-name">{u.nombre}</span>
                <span className="tz-stat-sub">
                  {formatSoles(u.total)} en {u.ventas} venta{u.ventas === 1 ? "" : "s"}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
