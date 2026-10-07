import { useEffect, useRef, useState } from "react";

// Texto que se escribe letra por letra y luego se borra al revés, para
// pasar al siguiente mensaje (en bucle). Va centrado: a medida que
// crece o se borra, el texto se re-centra solo (efecto "escribiéndose
// desde el centro"). Usado debajo del logo (igual que en la tienda de
// Caja Tonazo): la frase de siempre → descripciones del Admin para ese
// público (pasajeros / conductores).
const VEL_ESCRIBIR = 55; // ms por letra
const VEL_BORRAR = 30;
const PAUSA_LLENO = 2400; // tiempo que el mensaje queda completo
const PAUSA_VACIO = 350;

export default function TextoMaquina({ mensajes, className = "" }) {
  const lista = (mensajes || []).filter(Boolean);
  const clave = lista.join("|");
  const [texto, setTexto] = useState("");
  const estado = useRef({ i: 0, largo: 0, borrando: false });

  useEffect(() => {
    if (lista.length === 0) {
      setTexto("");
      return undefined;
    }
    estado.current = { i: 0, largo: 0, borrando: false };
    let timer;
    const paso = () => {
      const st = estado.current;
      const actual = lista[st.i % lista.length];
      let espera;
      if (!st.borrando) {
        st.largo += 1;
        if (st.largo >= actual.length) {
          st.largo = actual.length;
          // Con un solo mensaje se queda escrito: no hay a dónde pasar.
          if (lista.length === 1) {
            setTexto(actual);
            return;
          }
          st.borrando = true;
          espera = PAUSA_LLENO;
        } else espera = VEL_ESCRIBIR;
      } else {
        st.largo -= 1;
        if (st.largo <= 0) {
          st.largo = 0;
          st.borrando = false;
          st.i = (st.i + 1) % lista.length;
          espera = PAUSA_VACIO;
        } else espera = VEL_BORRAR;
      }
      setTexto(actual.slice(0, st.largo));
      timer = setTimeout(paso, espera);
    };
    timer = setTimeout(paso, PAUSA_VACIO);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  return (
    <p className={`tz-subtitle tz-subtitle-maquina ${className}`} aria-live="polite">
      {texto}
      <span className="tz-subtitle-cursor" aria-hidden="true" />
    </p>
  );
}
