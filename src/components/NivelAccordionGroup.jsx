import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { NIVEL_COLOR } from "../lib/nivelServicio";

// Grupo desplegable por nivel_servicio: encabezado con puntito de
// color + nombre + cantidad + flecha, contenido oculto hasta que se
// expande. Genérico a propósito (recibe `children`, no arma las
// tarjetas él mismo) — lo usan tanto el Directorio del Admin
// (tarjetas editables) como la Home pública (tarjetas de solo
// lectura), mismo look, distinto contenido.
export default function NivelAccordionGroup({ nivel, label, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="tz-vis-category">
      <div className="tz-vis-header-row">
        <button type="button" className="tz-vis-category-header" onClick={() => setOpen((prev) => !prev)}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: NIVEL_COLOR[nivel] ?? "var(--text-dim)",
                flexShrink: 0,
              }}
            />
            {label}
          </span>
          <span className="tz-vis-category-meta">
            {count} {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </button>
      </div>

      {open && <div className="tz-vis-accordion-inner">{children}</div>}
    </div>
  );
}
