import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

// Desplegable propio de la app (mismo archivo en Taxi-PE y Caja Tonazo):
// reemplaza a TODOS los <select> nativos, que abren el selector del
// sistema operativo (rueda de iOS, lista plana de Android/Chrome) y
// rompen la estética neón. Ver también Select.jsx (mismo uso que un
// <select> con <option>).
//
// `options`: [{ value, label, disabled? }]. `value`/`onChange` como un
// <select> controlado — se compara con String() (número o texto da igual).
//
// La lista se dibuja en una capa flotante sobre todo (portal, posición
// fija junto al botón): no la recorta el scroll de un modal ni de una
// tabla, y se abre hacia arriba si abajo no hay lugar.
//
// `triggerClassName`: el botón toma el aspecto de esa clase (ej. la del
// <select> que reemplaza: tz-text-input, tz-admin-filter-select…); sin
// ella usa el estilo propio .tz-dropdown-trigger.
const ALTO_MAX = 280;

export default function Dropdown({
  value,
  onChange,
  options,
  placeholder = "Seleccionar…",
  disabled = false,
  ariaLabel,
  className = "",
  triggerClassName = "",
  triggerProps,
  style,
  id,
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);

  const ubicar = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const alto = window.innerHeight;
    const abajo = alto - r.bottom - 12;
    const arriba = r.top - 12;
    const haciaArriba = abajo < 180 && arriba > abajo;
    const maxHeight = Math.max(120, Math.min(ALTO_MAX, haciaArriba ? arriba : abajo));
    setPos({
      left: r.left,
      width: r.width,
      maxHeight,
      ...(haciaArriba ? { bottom: alto - r.top + 6 } : { top: r.bottom + 6 }),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) ubicar();
  }, [open, ubicar]);

  useEffect(() => {
    if (!open) return undefined;
    const fuera = (e) => {
      if (wrapRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const tecla = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    // El scroll de la página o de un modal mueve el botón: la lista lo sigue
    // (el scroll dentro de la propia lista no cuenta).
    const alMover = (e) => {
      if (listRef.current && e.target instanceof Node && listRef.current.contains(e.target)) return;
      ubicar();
    };
    // 'mousedown' (no 'click'): se cierra ANTES de que un click sobre otro
    // control de atrás dispare su propio handler.
    document.addEventListener("mousedown", fuera);
    document.addEventListener("touchstart", fuera, { passive: true });
    document.addEventListener("keydown", tecla);
    window.addEventListener("resize", ubicar);
    window.addEventListener("scroll", alMover, true);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("touchstart", fuera);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", ubicar);
      window.removeEventListener("scroll", alMover, true);
    };
  }, [open, ubicar]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const lista = options ?? [];
  const seleccionado = lista.find((o) => String(o.value) === String(value ?? ""));

  return (
    <div className={`tz-dropdown ${className}`} ref={wrapRef} style={style}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={triggerClassName ? `tz-dropdown-nativo ${triggerClassName}` : "tz-dropdown-trigger"}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        {...triggerProps}
      >
        <span className={seleccionado ? "tz-dropdown-valor" : "tz-dropdown-placeholder"}>
          {seleccionado ? seleccionado.label : placeholder}
        </span>
        <ChevronDown size={16} className={`tz-dropdown-chevron ${open ? "tz-dropdown-chevron-open" : ""}`} />
      </button>
      {open &&
        pos &&
        createPortal(
          <ul
            ref={listRef}
            className="tz-dropdown-list tz-dropdown-flotante tz-portal"
            role="listbox"
            style={{
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              top: pos.top,
              bottom: pos.bottom,
            }}
          >
            {lista.length === 0 ? (
              <li className="tz-buscador-empty">Sin opciones disponibles.</li>
            ) : (
              lista.map((o) => (
                <li key={String(o.value)} role="option" aria-selected={String(o.value) === String(value ?? "")}>
                  <button
                    type="button"
                    disabled={o.disabled}
                    className={`tz-buscador-item tz-dropdown-item ${
                      String(o.value) === String(value ?? "") ? "tz-dropdown-item-activo" : ""
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
          </ul>,
          document.body
        )}
    </div>
  );
}
