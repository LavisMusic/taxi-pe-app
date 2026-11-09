import { useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Flame } from "lucide-react";

/* Piezas de los dashboards (fase 5c) — MISMO archivo en Taxi-PE y Caja
   (src/components/DashboardPiezas.jsx): mantener iguales. Las usan
   DashboardCaja y DashboardTaxi para que un medidor que sirve en una app
   se vea igual en la otra:
     - useContador / Delta: número animado y flecha ↑↓ contra el periodo
       anterior.
     - TarjetaDesglose: un total y sus partes (membresías de conductores y
       recolectores, o lo cobrado por cada plan), con una barra repartida.
     - AnilloEstados: anillo neón de estados (planes o membresías).
     - HorasPico: grilla día × hora (conductores conectados o ventas).
   Colores en rgba literales: Taxi-PE no tiene las variables --*-rgb. */

export const DIAS_SEMANA = [
  { dow: 1, label: "Lun" }, { dow: 2, label: "Mar" }, { dow: 3, label: "Mié" }, { dow: 4, label: "Jue" },
  { dow: 5, label: "Vie" }, { dow: 6, label: "Sáb" }, { dow: 0, label: "Dom" },
];
export const PALETA = ["#2be8ff", "#39ffb0", "#d7ff3b", "#ff2f9e", "#ff9500", "#b621ff"];

export const solesDp = (n, dec = 2) =>
  `S/ ${Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
const entero = (n) => Math.round(Number(n || 0)).toLocaleString("es-PE");

// Número que sube con un rebote corto cada vez que cambia.
export function useContador(valor, dur = 900) {
  const [v, setV] = useState(0);
  const desde = useRef(0);
  useEffect(() => {
    const ini = desde.current;
    const fin = Number(valor || 0);
    let raf;
    const t0 = performance.now();
    const paso = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const actual = ini + (fin - ini) * (1 - Math.pow(1 - p, 3));
      setV(actual);
      desde.current = actual;
      if (p < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [valor, dur]);
  return v;
}

// Flecha contra el periodo anterior. `invertido`: bajar es bueno (bajas).
export function Delta({ actual, anterior, invertido = false, chico = false }) {
  const a = Number(actual || 0);
  const b = Number(anterior || 0);
  const cls = `tz-dp-delta ${chico ? "is-chico" : ""}`;
  if (!a && !b) return <span className={`${cls} is-igual`}>— igual</span>;
  if (!b) return <span className={`${cls} is-sube`}>nuevo</span>;
  const pct = Math.round(((a - b) / b) * 100);
  if (pct === 0) return <span className={`${cls} is-igual`}>= igual</span>;
  const sube = pct > 0;
  const Icono = sube ? TrendingUp : TrendingDown;
  return (
    <span className={`${cls} ${(invertido ? !sube : sube) ? "is-sube" : "is-baja"}`}>
      <Icono size={chico ? 11 : 13} /> {sube ? "+" : ""}{pct}%
    </span>
  );
}

function MontoAnimado({ valor, formato }) {
  const v = useContador(valor);
  return <>{formato(v)}</>;
}

// Un total con sus partes. partes: [{ key, label, monto, ant, cantidad, detalle, color }]
export function TarjetaDesglose({ icono: Icono, titulo, partes, formato = solesDp, nota, i = 0, maxPartes = 4 }) {
  const [dibujado, setDibujado] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDibujado(true), 160);
    return () => clearTimeout(t);
  }, []);
  const lista = useMemo(() => {
    const ordenadas = [...partes];
    if (ordenadas.length <= maxPartes) return ordenadas;
    const resto = ordenadas.slice(maxPartes - 1);
    return [
      ...ordenadas.slice(0, maxPartes - 1),
      {
        key: "otros", label: "Otros", color: "#9c93c2",
        monto: resto.reduce((a, p) => a + Number(p.monto || 0), 0),
        ant: resto.reduce((a, p) => a + Number(p.ant || 0), 0),
        cantidad: resto.reduce((a, p) => a + Number(p.cantidad || 0), 0),
        detalle: resto[0]?.detalle,
      },
    ];
  }, [partes, maxPartes]);
  const total = lista.reduce((a, p) => a + Number(p.monto || 0), 0);
  const totalAnt = lista.reduce((a, p) => a + Number(p.ant || 0), 0);
  return (
    <div className="tz-dp-desglose" style={{ animationDelay: `${i * 70}ms` }}>
      <div className="tz-dp-desglose-cab">
        {Icono && <span className="tz-dp-desglose-icono"><Icono size={18} /></span>}
        <span className="tz-dp-desglose-titulo">{titulo}</span>
      </div>
      <div className="tz-dp-desglose-total">
        <strong><MontoAnimado valor={total} formato={formato} /></strong>
        <Delta actual={total} anterior={totalAnt} />
        {nota && <span className="tz-dp-nota">{nota}</span>}
      </div>
      <div className="tz-dp-desglose-barra">
        {total > 0 ? (
          lista.map((p, k) => (
            <span
              key={p.key}
              style={{
                flexGrow: dibujado ? Number(p.monto || 0) : 0.0001,
                background: p.color,
                boxShadow: `0 0 12px ${p.color}`,
                transitionDelay: `${k * 90}ms`,
              }}
            />
          ))
        ) : (
          <span className="is-vacia" />
        )}
      </div>
      <ul className="tz-dp-desglose-partes">
        {lista.map((p, k) => (
          <li key={p.key} style={{ animationDelay: `${i * 70 + 120 + k * 70}ms` }}>
            <i style={{ background: p.color, color: p.color }} />
            <span className="tz-dp-parte-label">
              {p.label}
              {p.cantidad != null && <small>{entero(p.cantidad)} {p.detalle || ""}</small>}
            </span>
            <span className="tz-dp-parte-monto">
              <MontoAnimado valor={p.monto} formato={formato} />
              {total > 0 && <small>{Math.round((Number(p.monto || 0) / total) * 100)}%</small>}
            </span>
            <Delta actual={p.monto} anterior={p.ant} chico />
          </li>
        ))}
      </ul>
    </div>
  );
}

// Anillo neón de estados. items: [{ key, label, color, valor }]
export function AnilloEstados({ items, sub }) {
  const [dibujado, setDibujado] = useState(false);
  useEffect(() => {
    setDibujado(false);
    const t = setTimeout(() => setDibujado(true), 150);
    return () => clearTimeout(t);
  }, [items.map((x) => x.valor).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const R = 52, C = 2 * Math.PI * R;
  const suma = items.reduce((a, b) => a + Number(b.valor || 0), 0);
  const base = suma || 1;
  let acum = 0;
  return (
    <div className="tz-dp-estados">
      <svg viewBox="0 0 140 140" className="tz-dp-anillo">
        <circle cx="70" cy="70" r={R} className="tz-dp-anillo-fondo" />
        {items.map((it) => {
          const largo = (Number(it.valor || 0) / base) * C;
          const el = (
            <circle
              key={it.key} cx="70" cy="70" r={R} className="tz-dp-anillo-tramo"
              stroke={it.color}
              strokeDasharray={`${dibujado ? Math.max(largo - 2, 0) : 0} ${C}`}
              strokeDashoffset={-acum}
              style={{ color: it.color }}
            />
          );
          acum += largo;
          return el;
        })}
        <text x="70" y="68" textAnchor="middle" className="tz-dp-anillo-num">{entero(suma)}</text>
        <text x="70" y="86" textAnchor="middle" className="tz-dp-anillo-sub">{sub}</text>
      </svg>
      <ul className="tz-dp-leyenda">
        {items.map((it) => (
          <li key={it.key}>
            <i style={{ background: it.color, color: it.color }} />
            {it.label}
            <b>{entero(it.valor)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Pestañas pequeñas dentro de una tarjeta.
export function PestanasDp({ opciones, valor, onCambiar }) {
  return (
    <div className="tz-dp-pestanas" role="tablist">
      {opciones.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={valor === o.id}
          className={valor === o.id ? "is-activa" : ""} onClick={() => onCambiar(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Grilla día × hora. datos: [{ dow, hora, valor | conductores }]
export function HorasPico({ datos, unidad = "conductores", vacio = "Sin datos en el periodo." }) {
  const [hover, setHover] = useState(null);
  const mapa = useMemo(() => {
    const m = new Map();
    (datos || []).forEach((d) => m.set(`${d.dow}:${d.hora}`, Number(d.valor ?? d.conductores ?? 0)));
    return m;
  }, [datos]);
  const max = Math.max(...mapa.values(), 0.01);
  let pico = null;
  mapa.forEach((v, k) => { if (!pico || v > pico.v) pico = { k, v }; });
  const etiqueta = (k) => {
    const [dow, hora] = k.split(":").map(Number);
    return `${DIAS_SEMANA.find((d) => d.dow === dow)?.label} ${String(hora).padStart(2, "0")}:00`;
  };
  const num = (v) => v.toLocaleString("es-PE", { maximumFractionDigits: 1 });
  return (
    <div className="tz-dp-pico">
      <div className="tz-dp-pico-info">
        {hover ? (
          <span><b>{etiqueta(hover)}</b> · {num(mapa.get(hover) || 0)} {unidad} en promedio</span>
        ) : pico ? (
          <span><Flame size={13} /> Pico: <b>{etiqueta(pico.k)}</b> · {num(pico.v)} {unidad}</span>
        ) : (
          <span>{vacio}</span>
        )}
      </div>
      <div className="tz-dp-pico-grid" onMouseLeave={() => setHover(null)}>
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="tz-dp-pico-hora">{h % 3 === 0 ? h : ""}</span>
        ))}
        {DIAS_SEMANA.map((d, fila) => (
          <FilaPico key={d.dow} d={d} fila={fila} mapa={mapa} max={max} pico={pico} setHover={setHover} />
        ))}
      </div>
    </div>
  );
}

function FilaPico({ d, fila, mapa, max, pico, setHover }) {
  return (
    <>
      <span className="tz-dp-pico-dia">{d.label}</span>
      {Array.from({ length: 24 }, (_, h) => {
        const k = `${d.dow}:${h}`;
        const v = mapa.get(k) || 0;
        const f = v / max;
        return (
          <span
            key={h}
            className={`tz-dp-pico-celda ${pico && pico.k === k ? "is-pico" : ""}`}
            style={{
              background: v ? `rgba(${Math.round(43 + f * 212)}, ${Math.round(232 - f * 185)}, ${Math.round(255 - f * 97)}, ${0.18 + f * 0.82})` : undefined,
              boxShadow: f > 0.6 ? `0 0 ${Math.round(f * 12)}px rgba(255, 47, 158, ${f * 0.7})` : undefined,
              animationDelay: `${fila * 40 + h * 12}ms`,
            }}
            onMouseEnter={() => setHover(k)}
            onClick={() => setHover(k)}
          />
        );
      })}
    </>
  );
}

export const ESTILO_PIEZAS = `
.tz-dp-delta { display: inline-flex; align-items: center; gap: 3px; font-size: 11.5px; font-weight: 800; padding: 2px 8px; border-radius: 999px;
  animation: tz-dp-pop .5s .35s cubic-bezier(.34,1.56,.64,1) both; white-space: nowrap; }
.tz-dp-delta.is-chico { font-size: 10.5px; padding: 1px 6px; }
.tz-dp-delta.is-sube { color: #39ffb0; background: rgba(57,255,176,0.12); }
.tz-dp-delta.is-baja { color: #ff5470; background: rgba(255,84,112,0.12); }
.tz-dp-delta.is-igual { color: var(--text-dim); background: rgba(255,255,255,0.06); }
.tz-dp-nota { font-size: 11.5px; color: var(--text-dim); }

.tz-dp-desglose { grid-column: span 2; position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 8px;
  padding: 14px; border-radius: 18px; background: var(--panel); border: 1px solid rgba(57,255,176,0.3);
  box-shadow: 0 0 22px rgba(57,255,176,0.08), inset 0 1px 0 rgba(255,255,255,0.05);
  animation: tz-dp-in .6s cubic-bezier(.34,1.56,.64,1) both; transition: transform .35s cubic-bezier(.34,1.56,.64,1), box-shadow .35s ease; }
.tz-dp-desglose:hover { transform: translateY(-3px); box-shadow: 0 0 28px rgba(57,255,176,0.22); }
.tz-dp-desglose::after { content: ""; position: absolute; inset: -40% -60%; pointer-events: none;
  background: linear-gradient(105deg, transparent 42%, rgba(57,255,176,0.13) 50%, transparent 58%); animation: tz-dp-brillo 5.5s ease-in-out infinite; }
@media (max-width: 480px) { .tz-dp-desglose { grid-column: auto; } }
.tz-dp-desglose-cab { display: flex; align-items: center; gap: 8px; }
.tz-dp-desglose-icono { width: 32px; height: 32px; border-radius: 11px; display: grid; place-items: center; color: #39ffb0;
  background: rgba(57,255,176,0.12); box-shadow: 0 0 14px rgba(57,255,176,0.3); }
.tz-dp-desglose-titulo { font-size: 12px; font-weight: 700; color: var(--text-dim); letter-spacing: .03em; }
.tz-dp-desglose-total { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tz-dp-desglose-total strong { font-size: 26px; font-weight: 900; color: var(--text); font-variant-numeric: tabular-nums;
  text-shadow: 0 0 16px rgba(57,255,176,0.45); line-height: 1.1; }
.tz-dp-desglose-barra { display: flex; gap: 3px; height: 9px; border-radius: 99px; overflow: hidden; background: rgba(255,255,255,0.06); }
.tz-dp-desglose-barra span { flex-basis: 0; border-radius: 99px; transition: flex-grow 1.1s cubic-bezier(.34,1.4,.64,1); }
.tz-dp-desglose-barra .is-vacia { flex-grow: 1; background: transparent; }
.tz-dp-desglose-partes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.tz-dp-desglose-partes li { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 12px;
  background: rgba(255,255,255,0.03); animation: tz-dp-in .5s cubic-bezier(.34,1.56,.64,1) both; }
.tz-dp-desglose-partes i { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; box-shadow: 0 0 8px currentColor; }
.tz-dp-parte-label { flex: 1; min-width: 0; display: flex; flex-direction: column; text-align: left; font-size: 12.5px; font-weight: 700; color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tz-dp-parte-label small, .tz-dp-parte-monto small { font-size: 10.5px; font-weight: 600; color: var(--text-dim); }
.tz-dp-parte-monto { display: flex; flex-direction: column; align-items: flex-end; font-size: 13px; font-weight: 800; color: var(--text);
  font-variant-numeric: tabular-nums; white-space: nowrap; }

.tz-dp-estados { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.tz-dp-anillo { width: 170px; height: 170px; transform: rotate(-90deg); overflow: visible; }
.tz-dp-anillo text { transform: rotate(90deg); transform-origin: 70px 70px; }
.tz-dp-anillo-fondo { fill: none; stroke: rgba(255,255,255,0.06); stroke-width: 13; }
.tz-dp-anillo-tramo { fill: none; stroke-width: 13; stroke-linecap: round; filter: drop-shadow(0 0 5px currentColor);
  transition: stroke-dasharray 1.2s cubic-bezier(.34,1.4,.64,1), stroke-dashoffset 1.2s cubic-bezier(.34,1.4,.64,1); }
.tz-dp-anillo-num { fill: var(--text); font-size: 26px; font-weight: 900; }
.tz-dp-anillo-sub { fill: var(--text-dim); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
.tz-dp-leyenda { list-style: none; margin: 0; padding: 0; width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; font-size: 12px; color: var(--text-dim); }
.tz-dp-leyenda li { display: flex; align-items: center; gap: 6px; }
.tz-dp-leyenda i { width: 9px; height: 9px; border-radius: 50%; box-shadow: 0 0 8px currentColor; }
.tz-dp-leyenda b { margin-left: auto; color: var(--text); }

.tz-dp-pestanas { display: inline-flex; gap: 3px; padding: 3px; border-radius: 999px; background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1); margin-left: auto; }
.tz-dp-pestanas button { border: 0; background: transparent; color: var(--text-dim); font-size: 11px; font-weight: 700; padding: 4px 10px;
  border-radius: 999px; cursor: pointer; text-transform: none; letter-spacing: 0;
  transition: color .25s ease, background .35s cubic-bezier(.34,1.56,.64,1), box-shadow .35s ease; }
.tz-dp-pestanas button.is-activa { color: #06131a; background: linear-gradient(110deg, #2be8ff, #39ffb0); box-shadow: 0 0 12px rgba(43,232,255,0.45); }

.tz-dp-pico-info { font-size: 12px; color: var(--text-dim); min-height: 18px; margin-bottom: 8px; }
.tz-dp-pico-info span { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.tz-dp-pico-info b { color: var(--text); }
.tz-dp-pico-grid { display: grid; grid-template-columns: 30px repeat(24, minmax(0, 1fr)); gap: 3px; align-items: center; }
.tz-dp-pico-hora { font-size: 9px; color: var(--text-dim); text-align: left; }
.tz-dp-pico-dia { font-size: 10.5px; font-weight: 700; color: var(--text-dim); }
.tz-dp-pico-celda { aspect-ratio: 1; border-radius: 4px; background: rgba(255,255,255,0.04); cursor: pointer;
  animation: tz-dp-pop .45s cubic-bezier(.34,1.56,.64,1) both; transition: transform .2s cubic-bezier(.34,1.56,.64,1); }
.tz-dp-pico-celda:hover { transform: scale(1.35); position: relative; z-index: 1; outline: 1px solid rgba(255,255,255,0.6); }
.tz-dp-pico-celda.is-pico { animation: tz-dp-pop .45s cubic-bezier(.34,1.56,.64,1) both, tz-dp-late 1.6s 1s ease-in-out infinite; }

@keyframes tz-dp-in { from { opacity: 0; transform: translateY(12px) scale(.97); filter: blur(3px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes tz-dp-pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: scale(1); } }
@keyframes tz-dp-brillo { 0%, 70% { transform: translateX(-60%); } 100% { transform: translateX(60%); } }
@keyframes tz-dp-late { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }
`;
