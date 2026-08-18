import { useState } from "react";
import { Trophy, X } from "lucide-react";
import { formatSoles } from "../../utils/format";

const TABS = [
  { key: "pasajeros", label: "Top Pasajeros" },
  { key: "conductores", label: "Top Conductores" },
  { key: "recolectores", label: "Top Recolectores" },
];

// Reemplaza al modal "Top Clientes" viejo: mismo tz-modal/tz-modal-wide
// y misma lista tz-top-clientes-list, ahora con 3 pestañas
// (tz-gasto-tipo-buttons, igual patrón que el toggle admin/cajero del
// login) en vez de un único ranking de clientes.
export default function TopUsuariosModal({ ranking, onClose }) {
  const [tab, setTab] = useState("conductores");
  const rows = ranking[tab] ?? [];

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Trophy size={17} /> Top Usuarios
          </h2>

          <div className="tz-gasto-tipo-buttons" style={{ marginBottom: 14 }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`tz-gasto-tipo-btn ${tab === t.key ? "tz-gasto-tipo-active" : ""}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "pasajeros" ? (
            <p className="tz-method-history-empty">
              Sin datos suficientes aún: `ventas` no tiene ninguna columna que la vincule a un
              pasajero. Este ranking se activa cuando exista esa relación (viajes, contactos, etc.).
            </p>
          ) : rows.length === 0 ? (
            <p className="tz-method-history-empty">Todavía no hay ventas registradas.</p>
          ) : (
            <ol className="tz-top-clientes-list">
              {rows.map((row, idx) => (
                <li key={row.id} className="tz-top-cliente-row">
                  <div className="tz-top-cliente-main">
                    <span className="tz-top-cliente-rank">#{idx + 1}</span>
                    <div className="tz-top-cliente-info">
                      <span className="tz-top-cliente-nombre">{row.nombre}</span>
                      <span className="tz-top-cliente-sub">
                        {row.ventas} venta{row.ventas === 1 ? "" : "s"}
                      </span>
                    </div>
                    <strong className="tz-top-cliente-monto">{formatSoles(row.total)}</strong>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
