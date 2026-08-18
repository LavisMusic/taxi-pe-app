import { useState } from "react";
import { Star } from "lucide-react";
import { formatSoles } from "../../utils/format";

const ROLES = [
  { key: "conductores", label: "Conductor" },
  { key: "pasajeros", label: "Pasajero" },
  { key: "recolectores", label: "Recolector" },
];

// Reemplaza al "Producto Estrella" viejo: mismo tz-stat-chip-star, pero
// con un selector de rol (mismas pastillas tz-gasto-tipo-* que ya usa
// el resto del sistema para alternar modos) para ver el mejor
// Conductor, Pasajero o Recolector según el ranking de `ventas`.
export default function UsuarioEstrellaChip({ ranking }) {
  const [rol, setRol] = useState("conductores");
  const top = ranking[rol]?.[0] ?? null;

  return (
    <div className="tz-stat-chip tz-stat-chip-star">
      <span className="tz-stat-label">
        <Star size={13} /> Usuario Estrella
      </span>

      <div className="tz-gasto-tipo-buttons" style={{ margin: "2px 0" }}>
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

      {rol === "pasajeros" ? (
        <span className="tz-stat-value tz-star-text" style={{ fontSize: 13 }}>
          Sin datos suficientes aún
        </span>
      ) : top ? (
        <>
          <span className="tz-stat-value tz-star-text">{top.nombre}</span>
          <span className="tz-stat-sub">
            {formatSoles(top.total)} en {top.ventas} venta{top.ventas === 1 ? "" : "s"}
          </span>
        </>
      ) : (
        <span className="tz-stat-value tz-star-text" style={{ fontSize: 13 }}>
          Aún sin ventas
        </span>
      )}
    </div>
  );
}
