import { useEffect, useState } from "react";
import { Check, Sparkles, Clock } from "lucide-react";

// Selector de planes / membresías de los modales de pago — MISMO archivo en
// Taxi-PE y Caja (src/components/TarjetasPlanes.jsx). Lo usan la renovación
// del negocio (Caja), la membresía del conductor y la del recolector.
//   * Píldora centrada "Por mes | Por año" (solo si hay de los dos).
//   * Tarjetas: nombre, duración, precio; con descuento vigente el precio
//     anterior tachado, "−X %" brillante, "Ahorras S/ …", hasta cuándo, y la
//     tarjeta latiendo con un borde de luz.
// `items`: [{ id, nombre, detalle, grupo: "mensual" | "anual", precio,
//   precioBase, descuento (pct vigente), descuentoHasta (iso), etiqueta }]

const GRUPOS = [
  { id: "mensual", label: "Por mes" },
  { id: "anual", label: "Por año" },
];

const soles = (n) => {
  const v = Math.round(Number(n || 0) * 100) / 100;
  return `S/ ${Number.isInteger(v) ? v : v.toFixed(2)}`;
};
const fechaCorta = (iso) => new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit" });

// Descuento vigente (0 fuera de su ventana). Mismo cálculo que la base
// (caja__descuento_vigente / taxi__descuento_vigente).
export function descuentoVigente(item, ahora = Date.now()) {
  const pct = Number(item?.descuento_pct || 0);
  if (pct <= 0) return 0;
  if (item.descuento_desde && ahora < new Date(item.descuento_desde).getTime()) return 0;
  if (item.descuento_hasta && ahora >= new Date(item.descuento_hasta).getTime()) return 0;
  return Math.min(pct, 99);
}

export default function TarjetasPlanes({ items, seleccionado, onElegir, vacio = null }) {
  const grupos = GRUPOS.filter((g) => items.some((i) => i.grupo === g.id));
  const claveGrupos = grupos.map((g) => g.id).join(",");
  const grupoElegido = items.find((i) => String(i.id) === String(seleccionado))?.grupo;
  const [grupo, setGrupo] = useState(grupoElegido || grupos[0]?.id || "mensual");
  useEffect(() => {
    if (grupoElegido) setGrupo(grupoElegido);
  }, [grupoElegido]);
  useEffect(() => {
    if (!grupos.some((g) => g.id === grupo) && grupos[0]) setGrupo(grupos[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveGrupos]);

  if (!items.length) return vacio;
  const indice = Math.max(0, grupos.findIndex((g) => g.id === grupo));
  const visibles = items.filter((i) => i.grupo === grupo);

  return (
    <div className="tz-tp">
      <style>{ESTILO}</style>
      {grupos.length > 1 && (
        <div className="tz-tp-pildora" role="tablist" style={{ "--tz-tp-n": grupos.length }}>
          <span className="tz-tp-pildora-luz" style={{ transform: `translateX(${indice * 100}%)` }} aria-hidden="true" />
          {grupos.map((g) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={grupo === g.id}
              className={grupo === g.id ? "is-activo" : ""}
              onClick={() => setGrupo(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}
      <div className="tz-tp-grid" key={grupo}>
        {visibles.map((it, k) => {
          const base = Number(it.precioBase ?? it.precio);
          const precio = Number(it.precio);
          const conDescuento = Number(it.descuento) > 0 && base > precio;
          const elegido = String(it.id) === String(seleccionado);
          return (
            <button
              key={it.id}
              type="button"
              className={`tz-tp-card ${elegido ? "is-elegido" : ""} ${conDescuento ? "is-oferta" : ""}`}
              style={{ animationDelay: `${k * 70}ms` }}
              onClick={() => onElegir(it.id)}
            >
              {conDescuento && (
                <span className="tz-tp-badge">
                  <Sparkles size={12} /> −{Number(it.descuento)}%
                </span>
              )}
              {it.etiqueta && <span className="tz-tp-etiqueta">{it.etiqueta}</span>}
              <span className="tz-tp-nombre">{it.nombre}</span>
              {it.detalle && <span className="tz-tp-detalle">{it.detalle}</span>}
              <span className="tz-tp-precios">
                {conDescuento && <s>{soles(base)}</s>}
                <strong>{soles(precio)}</strong>
              </span>
              {conDescuento && (
                <span className="tz-tp-ahorro">
                  Ahorras {soles(base - precio)}
                  {it.descuentoHasta && (
                    <span className="tz-tp-hasta">
                      <Clock size={11} /> hasta el {fechaCorta(it.descuentoHasta)}
                    </span>
                  )}
                </span>
              )}
              {elegido && (
                <span className="tz-tp-check" aria-hidden="true">
                  <Check size={14} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ESTILO = `
.tz-tp { display: flex; flex-direction: column; gap: 12px; margin: 6px 0 4px; }
.tz-tp-pildora {
  position: relative; align-self: center; display: grid; grid-template-columns: repeat(var(--tz-tp-n), 1fr);
  padding: 4px; border-radius: 999px; min-width: 220px;
  background: rgba(255,255,255,0.05); border: 1px solid rgba(43,232,255,0.3);
  box-shadow: 0 0 18px rgba(43,232,255,0.12) inset;
}
.tz-tp-pildora-luz {
  position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc((100% - 8px) / var(--tz-tp-n));
  border-radius: 999px; background: linear-gradient(90deg, #2be8ff, #39ffb0);
  box-shadow: 0 0 16px rgba(43,232,255,0.6);
  transition: transform 0.5s cubic-bezier(.34,1.56,.64,1);
}
.tz-tp-pildora button {
  position: relative; z-index: 1; border: 0; background: transparent; cursor: pointer;
  padding: 8px 18px; border-radius: 999px; font: inherit; font-size: 13px; font-weight: 800;
  color: var(--text-dim, #a9a3c9); transition: color 0.3s ease;
}
.tz-tp-pildora button.is-activo { color: #06121a; }
.tz-tp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; padding: 4px; }
@media (max-width: 380px) { .tz-tp-grid { grid-template-columns: 1fr 1fr; gap: 9px; } }
.tz-tp-card {
  position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; text-align: left;
  padding: 14px 12px 12px; border-radius: 16px; cursor: pointer; font: inherit; color: var(--text, #fff);
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12);
  animation: tz-tp-entra 0.55s cubic-bezier(.34,1.56,.64,1) both;
  transition: transform 0.35s cubic-bezier(.34,1.56,.64,1), border-color 0.3s ease, box-shadow 0.3s ease;
}
.tz-tp-card:hover { transform: translateY(-2px); }
.tz-tp-card:active { transform: scale(0.97); }
.tz-tp-card.is-elegido { border-color: #2be8ff; box-shadow: 0 0 0 1px #2be8ff, 0 0 22px rgba(43,232,255,0.4); }
@keyframes tz-tp-entra {
  from { opacity: 0; transform: translateY(12px) scale(0.92); filter: blur(3px); }
  to { opacity: 1; transform: none; filter: none; }
}
/* Con descuento: la tarjeta late con un borde de luz. */
.tz-tp-card.is-oferta {
  border-color: rgba(255,47,158,0.6);
  background: linear-gradient(160deg, rgba(255,47,158,0.12), rgba(215,255,59,0.05));
  animation: tz-tp-entra 0.55s cubic-bezier(.34,1.56,.64,1) both, tz-tp-late 1.8s ease-in-out 0.6s infinite;
}
.tz-tp-card.is-oferta.is-elegido { border-color: #2be8ff; }
@keyframes tz-tp-late {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255,47,158,0.0), 0 0 10px rgba(255,47,158,0.25); }
  50% { box-shadow: 0 0 0 3px rgba(255,47,158,0.18), 0 0 26px rgba(255,47,158,0.55); }
}
.tz-tp-badge {
  position: absolute; top: -10px; right: 10px; display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px; border-radius: 999px; font-size: 12px; font-weight: 900; color: #fff;
  background: linear-gradient(90deg, #ff2f9e, #ff8a3d); box-shadow: 0 0 14px rgba(255,47,158,0.7);
  animation: tz-tp-badge 1.8s ease-in-out infinite;
}
@keyframes tz-tp-badge { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
.tz-tp-etiqueta {
  font-size: 10px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase;
  padding: 2px 7px; border-radius: 999px; color: #39ffb0; border: 1px solid rgba(57,255,176,0.45);
}
.tz-tp-nombre { font-size: 15px; font-weight: 800; line-height: 1.2; }
.tz-tp-detalle { font-size: 12px; color: var(--text-dim, #a9a3c9); line-height: 1.3; }
.tz-tp-precios { display: flex; align-items: baseline; gap: 7px; margin-top: 4px; flex-wrap: wrap; }
.tz-tp-precios s { font-size: 13px; color: var(--text-dim, #a9a3c9); }
.tz-tp-precios strong { font-size: 22px; font-weight: 900; color: #39ffb0; text-shadow: 0 0 12px rgba(57,255,176,0.45); }
.tz-tp-card.is-oferta .tz-tp-precios strong { color: #d7ff3b; text-shadow: 0 0 14px rgba(215,255,59,0.55); }
.tz-tp-ahorro { display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; font-weight: 700; color: #ff7ac4; }
.tz-tp-hasta { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--text-dim, #a9a3c9); }
.tz-tp-check {
  position: absolute; bottom: 10px; right: 10px; width: 22px; height: 22px; border-radius: 999px;
  display: flex; align-items: center; justify-content: center; color: #06121a;
  background: #2be8ff; box-shadow: 0 0 12px rgba(43,232,255,0.8);
  animation: tz-tp-entra 0.4s cubic-bezier(.34,1.56,.64,1) both;
}
`;
