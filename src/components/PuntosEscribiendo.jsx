// Los tres puntitos de "escribiendo…" — mismo dibujo en todos los chats
// (mismo archivo en Taxi-PE y Caja Tonazo). Ver useEscribiendo.js.
export default function PuntosEscribiendo({ quien }) {
  return (
    <div className="tz-escribiendo" role="status" aria-label={quien ? `${quien} está escribiendo` : "Escribiendo…"}>
      <span className="tz-escribiendo-puntos">
        <i />
        <i />
        <i />
      </span>
      {quien && <span className="tz-escribiendo-quien">{quien} está escribiendo</span>}
    </div>
  );
}
