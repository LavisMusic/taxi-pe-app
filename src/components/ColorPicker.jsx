import { Palette } from "lucide-react";

/* Paleta neón acotada — coherente con el tema oscuro de Tonazo y
   pensada para distinguirse rápido a simple vista (rojo/verde/azul de
   los Zaphitos, etc.). El admin puede salirse de la paleta con el
   selector nativo si necesita un color exacto. */
export const VARIANT_COLOR_PRESETS = [
  "#ff4d6d", // rojo
  "#ff9f43", // naranja
  "#ffe066", // amarillo
  "#7bed9f", // verde
  "#2be8ff", // cyan (marca)
  "#4d7bff", // azul
  "#b98bff", // violeta
  "#ff7ac6", // rosa
  "#ffffff", // blanco / neutro
];

/* Selector de "Color Identificador" de una variante: fila de swatches
   predefinidos + un selector de color nativo para un tono exacto. Se
   usa en Crear Producto, Editar Producto y Añadir Variante — siempre
   el mismo valor de vuelta (string hex o null). */
export default function ColorPicker({ value, onChange, label = "Color identificador" }) {
  const isCustom = value && !VARIANT_COLOR_PRESETS.includes(value);
  return (
    <div className="tz-color-picker">
      {label && <span className="tz-field-label">{label}</span>}
      <div className="tz-color-swatches">
        {VARIANT_COLOR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            className={`tz-color-swatch ${value === c ? "tz-color-swatch-active" : ""}`}
            style={{ background: c }}
            onClick={() => onChange(value === c ? null : c)}
            aria-label={`Color ${c}`}
            title={c}
          />
        ))}
        <label
          className={`tz-color-swatch tz-color-swatch-custom ${isCustom ? "tz-color-swatch-active" : ""}`}
          style={isCustom ? { background: value } : undefined}
          title="Color personalizado"
        >
          {!isCustom && <Palette size={12} />}
          <input
            type="color"
            value={isCustom ? value : "#2be8ff"}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Color personalizado"
          />
        </label>
      </div>
    </div>
  );
}
