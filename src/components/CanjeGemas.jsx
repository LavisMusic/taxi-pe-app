import IconoGema from "./IconoGema";

// Canje de gemas cobradas al renovar (fase 3a de gemas) — MISMO archivo en
// Caja y Taxi-PE (src/components/CanjeGemas.jsx): mantener iguales.
//   - Negocio (Caja): celestes al renovar su plan.
//   - Conductor (Taxi): verdes al comprar membresía (él, el admin o el
//     recolector).
// Encendido por defecto; apagado, guarda sus gemas para después.
// `canje`: { n, monto } que calculó la base; `precio`: lo que cuesta.
export default function CanjeGemas({ color = "celeste", canje, precio, activo, onCambiar, quien = "tus" }) {
  const n = Number(canje?.n) || 0;
  if (n < 1) return null;
  const monto = Number(canje?.monto) || 0;
  const pagar = Math.max(Number(precio || 0) - (activo ? monto : 0), 0);
  return (
    <div className={`tz-canje-gemas tz-canje-${color} ${activo ? "is-on" : ""}`}>
      <style>{ESTILO}</style>
      <button type="button" role="switch" aria-checked={activo} onClick={() => onCambiar(!activo)}>
        <span className="tz-canje-ico">
          <IconoGema color={color} size={20} />
          <b>{n}</b>
        </span>
        <span className="tz-canje-textos">
          <strong>
            Canjear {quien} {n} {n === 1 ? "gema" : "gemas"} {color === "verde" ? "verdes" : "celestes"} (−S/ {monto.toFixed(2)})
          </strong>
          <small>
            {activo ? `Pagas S/ ${pagar.toFixed(2)} en vez de S/ ${Number(precio || 0).toFixed(2)}` : "Apagado: las gemas se guardan para después"}
          </small>
        </span>
        <span className={`tz-canje-switch ${activo ? "is-on" : ""}`} aria-hidden="true">
          <span />
        </span>
      </button>
    </div>
  );
}

const ESTILO = `
.tz-canje-gemas { margin: 12px 0 6px; }
.tz-canje-gemas { --cg: #2be8ff; --cg-rgb: 43,232,255; }
.tz-canje-gemas.tz-canje-verde { --cg: #39ffb0; --cg-rgb: 57,255,176; }
.tz-canje-gemas > button {
  width: 100%; display: flex; align-items: center; gap: 12px; text-align: left; cursor: pointer;
  padding: 11px 13px; border-radius: 16px; color: inherit;
  border: 1px solid rgba(var(--cg-rgb), 0.35); background: rgba(var(--cg-rgb), 0.06);
  transition: background 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease, transform 0.25s cubic-bezier(.34,1.56,.64,1);
  animation: tz-canje-in 0.5s cubic-bezier(.34,1.56,.64,1) both;
}
@keyframes tz-canje-in { from { opacity: 0; transform: translateY(6px) scale(0.97); filter: blur(2px); } to { opacity: 1; transform: none; filter: none; } }
.tz-canje-gemas > button:active { transform: scale(0.98); }
.tz-canje-gemas.is-on > button {
  border-color: var(--cg);
  background: linear-gradient(110deg, rgba(var(--cg-rgb), 0.2), rgba(var(--cg-rgb), 0.05));
  box-shadow: 0 0 20px rgba(var(--cg-rgb), 0.35), inset 0 0 14px rgba(var(--cg-rgb), 0.12);
}
.tz-canje-ico { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; }
.tz-canje-gemas.is-on .tz-canje-ico svg { animation: tz-canje-late 1.5s ease-in-out infinite; }
@keyframes tz-canje-late { 0%, 100% { transform: scale(1) rotate(0); } 50% { transform: scale(1.18) rotate(-8deg); } }
.tz-canje-ico b {
  position: absolute; right: -4px; bottom: -3px; min-width: 18px; padding: 0 4px; border-radius: 999px;
  font-size: 10px; line-height: 16px; text-align: center; color: #05141a; background: var(--cg);
  box-shadow: 0 0 8px rgba(var(--cg-rgb), 0.8);
}
.tz-canje-textos { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.tz-canje-textos strong { font-size: 13px; }
.tz-canje-textos small { font-size: 11.5px; opacity: 0.75; }
.tz-canje-gemas.is-on .tz-canje-textos small { color: var(--cg); opacity: 1; font-weight: 700; }
.tz-canje-switch {
  position: relative; flex-shrink: 0; width: 46px; height: 26px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08);
  transition: background 0.35s ease, border-color 0.35s ease, box-shadow 0.35s ease;
}
.tz-canje-switch > span {
  position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: rgba(255,255,255,0.55);
  transition: transform 0.45s cubic-bezier(0.2, 1.6, 0.4, 1), background 0.3s ease, box-shadow 0.3s ease;
}
.tz-canje-switch.is-on { background: linear-gradient(110deg, rgba(var(--cg-rgb), 0.45), rgba(var(--cg-rgb), 0.2)); border-color: var(--cg); box-shadow: 0 0 12px rgba(var(--cg-rgb), 0.5); }
.tz-canje-switch.is-on > span { transform: translateX(20px); background: #fff; box-shadow: 0 0 10px var(--cg); }
`;
