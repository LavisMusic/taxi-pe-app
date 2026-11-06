import { useRef, useState } from "react";
import ContadorCreditos from "./ContadorCreditos";
import GemaRevelada from "./GemaRevelada";

// Saldo de gemas del cliente (Gemas cruzadas): verdes (ganadas comprando,
// se gastan en Taxi-PE) y celestes (ganadas viajando, se gastan en las
// tiendas). Cada una cuenta como casino cuando sube y, al terminar,
// aparece la gema ganada a pantalla completa.
//
// La tienda pinta este recuadro en dos lugares (uno oculto según el
// ancho): solo la copia visible muestra la gema ganada.
// Las gemas empiezan en 0 para todos: la primera vez en un navegador se
// cuenta desde 0 (y se festeja lo que ya tenía), en vez de mostrarlo
// quieto como hace el contador con un saldo que no vio llegar.
function sembrarDesdeCero(clave) {
  try {
    if (window.localStorage.getItem(clave) == null) window.localStorage.setItem(clave, "0");
  } catch {
    // Sin almacenamiento: el contador muestra el saldo quieto.
  }
}

export default function SaldoGemas({ usuarioId, verdes, celestes }) {
  const claveVerdes = `tz-gemas-verdes-visto-${usuarioId}`;
  const claveCelestes = `tz-gemas-celestes-visto-${usuarioId}`;
  useState(() => {
    sembrarDesdeCero(claveVerdes);
    sembrarDesdeCero(claveCelestes);
  });
  const ref = useRef(null);
  const [ganada, setGanada] = useState(null); // { color, cantidad, id }

  const alSubir = (color) => (cuanto) => {
    if (!ref.current || ref.current.offsetParent === null) return;
    setGanada({ color, cantidad: cuanto, id: Date.now() });
  };

  return (
    <div className="tz-stat-chip tz-gemas" ref={ref}>
      <span className="tz-gemas-label tz-gemas-label-dual">Gemas</span>
      <span className="tz-stat-value tz-gemas-fila">
        <ContadorCreditos
          valor={Number(verdes) || 0}
          clave={claveVerdes}
          titulo="Gemas verdes"
          variante="verde"
          className="tz-cc-heredado"
          onSubio={alSubir("verde")}
        />
        <ContadorCreditos
          valor={Number(celestes) || 0}
          clave={claveCelestes}
          titulo="Gemas celestes"
          variante="celeste"
          className="tz-cc-heredado"
          onSubio={alSubir("celeste")}
        />
      </span>
      {ganada && (
        <GemaRevelada
          key={ganada.id}
          color={ganada.color}
          cantidad={ganada.cantidad}
          onCerrar={() => setGanada(null)}
        />
      )}
    </div>
  );
}
