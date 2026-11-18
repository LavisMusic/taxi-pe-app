// Pestañas en píldora centrada con una luz que se desliza — MISMO archivo en
// Taxi-PE y Caja (src/components/PestanasPildora.jsx). Las usan los modales
// de configuración de planes (Caja) y de membresías (Taxi-PE), con el mismo
// estilo que la píldora "Por mes | Por año" del modal de pago.
// `opciones`: [{ id, label }]; `valor`: id activo.
export default function PestanasPildora({ opciones, valor, onCambio }) {
  const indice = Math.max(0, opciones.findIndex((o) => o.id === valor));
  return (
    <div className="tz-pp" role="tablist" style={{ "--tz-pp-n": opciones.length }}>
      <style>{ESTILO}</style>
      <span className="tz-pp-luz" style={{ transform: `translateX(${indice * 100}%)` }} aria-hidden="true" />
      {opciones.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={valor === o.id}
          className={valor === o.id ? "is-activo" : ""}
          onClick={() => onCambio(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const ESTILO = `
.tz-pp {
  position: relative; align-self: center; display: grid; grid-template-columns: repeat(var(--tz-pp-n), 1fr);
  margin: 4px auto 12px; padding: 4px; border-radius: 999px; min-width: 240px; width: fit-content;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(43,232,255,0.3);
  box-shadow: 0 0 18px rgba(43,232,255,0.12) inset;
}
.tz-pp-luz {
  position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc((100% - 8px) / var(--tz-pp-n));
  border-radius: 999px; background: linear-gradient(90deg, #2be8ff, #39ffb0);
  box-shadow: 0 0 16px rgba(43,232,255,0.6);
  transition: transform 0.5s cubic-bezier(.34,1.56,.64,1);
}
.tz-pp button {
  position: relative; z-index: 1; border: 0; background: transparent; cursor: pointer; white-space: nowrap;
  padding: 8px 18px; border-radius: 999px; font: inherit; font-size: 13px; font-weight: 800;
  color: var(--text-dim, #a9a3c9); transition: color 0.3s ease;
}
.tz-pp button.is-activo { color: #06121a; }
`;
