import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import ContadorCreditos from "./ContadorCreditos";
import GemaRevelada from "./GemaRevelada";

// Saldo de gemas del cliente (Gemas cruzadas): verdes (ganadas comprando,
// se gastan en Taxi-PE) y celestes (ganadas viajando, se gastan en las
// tiendas). Cada una cuenta como casino cuando sube y, al terminar,
// aparece la gema ganada a pantalla completa.
//
// La tienda pinta este recuadro en dos lugares (uno oculto según el
// ancho): solo la copia visible muestra la gema ganada.
//
// Cuántas ya vio se guarda en la base (tabla gemas_vistas, una fila por
// cuenta): así la gema a pantalla completa sale una sola vez por cambio
// aunque entre desde otro navegador o teléfono. La primera vez (sin fila)
// se toma lo que ya tiene como visto: no se festeja lo de antes. El
// contador además lo recuerda en este navegador (`clave`), y se arranca
// desde lo que diga la base. MISMO archivo en Taxi-PE y Caja.
function guardarLocal(clave, valor) {
  try {
    window.localStorage.setItem(clave, String(Math.max(0, Math.round(Number(valor) || 0))));
  } catch {
    // Sin almacenamiento: el contador muestra el saldo quieto.
  }
}

export default function SaldoGemas({ usuarioId, verdes, celestes }) {
  const claveVerdes = `tz-gemas-verdes-visto-${usuarioId}`;
  const claveCelestes = `tz-gemas-celestes-visto-${usuarioId}`;
  const actuales = useRef({ verdes, celestes });
  actuales.current = { verdes: Number(verdes) || 0, celestes: Number(celestes) || 0 };
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let vivo = true;
    setListo(false);
    (async () => {
      const { data, error } = await supabase
        .from("gemas_vistas")
        .select("verdes, celestes")
        .eq("usuario_id", usuarioId)
        .maybeSingle();
      if (!vivo) return;
      if (!error && data) {
        guardarLocal(claveVerdes, data.verdes);
        guardarLocal(claveCelestes, data.celestes);
      } else if (!error) {
        // Primera vez en cualquier dispositivo: lo que ya tiene cuenta como visto.
        const { verdes: v, celestes: c } = actuales.current;
        guardarLocal(claveVerdes, v);
        guardarLocal(claveCelestes, c);
        await supabase
          .from("gemas_vistas")
          .upsert({ usuario_id: usuarioId, verdes: v, celestes: c }, { onConflict: "usuario_id", ignoreDuplicates: true });
      }
      // Con error (sin conexión): queda lo de este navegador.
      if (vivo) setListo(true);
    })();
    return () => {
      vivo = false;
    };
  }, [usuarioId, claveVerdes, claveCelestes]);

  const guardarVisto = (color) => (valor) => {
    supabase
      .from("gemas_vistas")
      .upsert({ usuario_id: usuarioId, [color]: valor, updated_at: new Date().toISOString() }, { onConflict: "usuario_id" })
      .then(({ error }) => error && console.error("[SaldoGemas] no se pudo guardar lo visto:", error.message));
  };

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
        {listo && (
          <>
            <ContadorCreditos
              valor={Number(verdes) || 0}
              clave={claveVerdes}
              titulo="Gemas verdes"
              variante="verde"
              className="tz-cc-heredado"
              onSubio={alSubir("verde")}
              onVisto={guardarVisto("verdes")}
            />
            <ContadorCreditos
              valor={Number(celestes) || 0}
              clave={claveCelestes}
              titulo="Gemas celestes"
              variante="celeste"
              className="tz-cc-heredado"
              onSubio={alSubir("celeste")}
              onVisto={guardarVisto("celestes")}
            />
          </>
        )}
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
