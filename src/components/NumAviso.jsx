/* Número de avisos dentro de un modal (pestañas, filtros): el mismo
   círculo rojo que el de los botones de la cabecera, hasta "+9" — MISMO
   archivo en Taxi-PE y Caja (src/components/NumAviso.jsx): mantener iguales.
   No pinta nada con 0. */
export const textoAviso = (n) => (n > 9 ? "+9" : String(n));

export default function NumAviso({ n, className = "" }) {
  const v = Number(n) || 0;
  if (v <= 0) return null;
  return (
    <>
      <style>{ESTILO}</style>
      <b key={v} className={`tz-num-aviso ${className}`}>{textoAviso(v)}</b>
    </>
  );
}

const ESTILO = `
.tz-num-aviso { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; margin-left: 6px;
  padding: 0 5px 1px; box-sizing: border-box; border-radius: 999px; vertical-align: middle; flex-shrink: 0;
  font-size: 10.5px; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: 0;
  color: #fff; background: #ff2d55; box-shadow: 0 0 10px rgba(255,45,85,0.6);
  animation: tz-num-aviso-pop .5s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes tz-num-aviso-pop { from { transform: scale(.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
`;
