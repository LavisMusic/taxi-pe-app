// Campo del código de activación de un solo uso (ver taxi_crear_pin): lo
// genera el Admin o el recolector para una cuenta que se creó sin PIN, y la
// persona lo escribe en su primer ingreso para crear el suyo.
export default function CampoCodigoActivacion({ value, onChange, autoFocus = false }) {
  return (
    <div className="tz-login-field">
      <label className="tz-field-label" htmlFor="codigo-activacion">
        Código de activación
      </label>
      <input
        id="codigo-activacion"
        type="text"
        autoFocus={autoFocus}
        autoCapitalize="characters"
        autoComplete="one-time-code"
        className="tz-text-input tz-codigo-activacion-input"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder="K7Q-29M"
        maxLength={8}
      />
      <p className="tz-field-hint">Te lo dio quien creó tu cuenta (por WhatsApp o en persona).</p>
    </div>
  );
}

export const codigoCompleto = (codigo) => (codigo || "").replace(/[^0-9a-z]/gi, "").length === 6;
