import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

// Reemplaza los <select> nativos (Registro de Conductores, filtro de
// localidad de la Home) por un dropdown propio con la misma estética
// del Buscador Inteligente (.tz-buscador-dropdown/.tz-buscador-item,
// ver HomePage.jsx) — un <select> nativo abre el picker del sistema
// operativo (rueda de iOS, modal plano de Android/Chrome), que rompe
// por completo la estética neón del resto de la app.
//
// `options`: [{ value, label }]. `value`/`onChange` funcionan igual que
// en un <select> controlado — se compara con String() para no fallar
// si `value` llega como número y las opciones como string o viceversa.
export default function Dropdown({
  value,
  onChange,
  options,
  placeholder = "Seleccionar…",
  disabled = false,
  ariaLabel,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    // 'mousedown' (no 'click'): así se cierra ANTES de que un click
    // sobre otro control interactivo de atrás llegue a disparar su
    // propio handler, mismo criterio que ya usa el blur del Buscador.
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const seleccionado = (options ?? []).find((o) => String(o.value) === String(value));

  return (
    <div className={`tz-dropdown ${className}`} ref={wrapRef}>
      <button
        type="button"
        className="tz-dropdown-trigger"
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <span className={seleccionado ? "tz-dropdown-valor" : "tz-dropdown-placeholder"}>
          {seleccionado ? seleccionado.label : placeholder}
        </span>
        <ChevronDown size={16} className={`tz-dropdown-chevron ${open ? "tz-dropdown-chevron-open" : ""}`} />
      </button>
      {open && (
        <ul className="tz-dropdown-list" role="listbox">
          {(options ?? []).length === 0 ? (
            <li className="tz-buscador-empty">Sin opciones disponibles.</li>
          ) : (
            (options ?? []).map((o) => (
              <li key={o.value} role="option" aria-selected={String(o.value) === String(value)}>
                <button
                  type="button"
                  className={`tz-buscador-item tz-dropdown-item ${
                    String(o.value) === String(value) ? "tz-dropdown-item-activo" : ""
                  }`}
                  onClick={() => {
                    onChange?.(o.value);
                    setOpen(false);
                  }}
                >
                  <span>{o.label}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
