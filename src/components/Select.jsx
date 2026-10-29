import { Children, isValidElement, useState } from "react";
import Dropdown from "./Dropdown";

// Reemplazo directo de <select> (mismo archivo en Taxi-PE y Caja Tonazo):
// se usa igual — <Select value onChange={(e) => …e.target.value}> con
// <option> adentro (sueltas, en .map() o en fragmentos) — pero se dibuja
// con el desplegable propio de la app (Dropdown.jsx), nunca con el del
// navegador. La clase del <select> (tz-text-input, tz-admin-filter-select…)
// pasa al botón, así conserva su tamaño y color en cada pantalla; los
// atributos data-* también (ej. data-estado).
//
// Una <option value="" disabled> se toma como texto de "elige una opción".

function texto(nodo) {
  if (nodo == null || typeof nodo === "boolean") return "";
  if (typeof nodo === "string" || typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(texto).join("");
  if (isValidElement(nodo)) return texto(nodo.props.children);
  return "";
}

function aplanar(children, out = []) {
  Children.forEach(children, (hijo) => {
    if (!isValidElement(hijo)) return;
    if (hijo.type === "option") {
      const label = texto(hijo.props.children);
      out.push({
        value: hijo.props.value != null ? String(hijo.props.value) : label,
        label,
        disabled: !!hijo.props.disabled,
      });
    } else if (hijo.props?.children) {
      aplanar(hijo.props.children, out);
    }
  });
  return out;
}

export default function Select({
  value,
  defaultValue,
  onChange,
  children,
  disabled = false,
  className = "",
  style,
  id,
  name,
  title,
  "aria-label": ariaLabel,
  ...resto
}) {
  const opciones = aplanar(children);
  const guia = opciones.find((o) => o.disabled && o.value === "");
  const lista = opciones.filter((o) => o !== guia);
  const controlado = value !== undefined;
  const [interno, setInterno] = useState(() => String(defaultValue ?? lista[0]?.value ?? ""));
  const actual = controlado ? (value == null ? "" : String(value)) : interno;
  const dataAttrs = Object.fromEntries(Object.entries(resto).filter(([k]) => k.startsWith("data-")));

  return (
    <Dropdown
      id={id}
      value={actual}
      options={lista}
      placeholder={guia?.label ?? lista[0]?.label ?? "Seleccionar…"}
      disabled={disabled}
      ariaLabel={ariaLabel || title}
      style={style}
      triggerClassName={className || "tz-text-input"}
      triggerProps={{ ...dataAttrs, title }}
      onChange={(v) => {
        const valor = String(v);
        if (!controlado) setInterno(valor);
        const objetivo = { value: valor, name };
        onChange?.({ target: objetivo, currentTarget: objetivo });
      }}
    />
  );
}
