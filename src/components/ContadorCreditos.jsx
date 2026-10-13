import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

// Contador de créditos del cliente (Créditos, fase C) — mismo archivo en
// Caja Tonazo (tienda) y Taxi-PE (pasajero).
//
// Un diamante y el número, sin recuadro. Los créditos que llegan NO se
// muestran al instante: el número espera a que el cliente esté viendo la
// interfaz principal (pestaña visible, sin modales ni animaciones a
// pantalla completa encima). Ahí corre como un contador de casino —cada
// dígito es un rodillo que gira y frena uno tras otro— y, si subió, al
// final saltan gotas del mismo color hacia ambos lados. Si bajó (compra
// anulada) los rodillos giran al revés hasta el valor nuevo, sin gotas.
// El último valor visto se recuerda por usuario en este navegador
// (`clave`), así la animación sale una sola vez por cambio aunque los
// créditos hayan llegado con la app cerrada.

const CAPAS_ENCIMA = ".tz-modal-backdrop, .tz-exito-overlay, .tz-neon-bienvenida-overlay";
const ALTO_DIGITO = 1.2; // em
const GOTAS = 12;

function leerVisto(clave) {
  try {
    const v = window.localStorage.getItem(clave);
    return v == null ? null : Number(v);
  } catch {
    return null;
  }
}
function guardarVisto(clave, valor) {
  try {
    window.localStorage.setItem(clave, String(valor));
  } catch {
    // Sin almacenamiento: la animación simplemente puede repetirse.
  }
}

function principalALaVista() {
  return document.visibilityState === "visible" && !document.querySelector(CAPAS_ENCIMA);
}

function useInterfazPrincipalVisible() {
  const [visible, setVisible] = useState(() => (typeof document === "undefined" ? false : principalALaVista()));
  useEffect(() => {
    let pendiente = 0;
    const revisar = () => {
      if (pendiente) return;
      pendiente = requestAnimationFrame(() => {
        pendiente = 0;
        setVisible(principalALaVista());
      });
    };
    const obs = new MutationObserver(revisar);
    obs.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("visibilitychange", revisar);
    revisar();
    return () => {
      obs.disconnect();
      document.removeEventListener("visibilitychange", revisar);
      if (pendiente) cancelAnimationFrame(pendiente);
    };
  }, []);
  return visible;
}

// Un rodillo por posición. Sube: la tira avanza hacia arriba; baja: la
// tira retrocede (el rodillo gira al revés). Los dígitos que no cambian
// a la izquierda quedan quietos; desde el primero que cambia, giran y
// frenan de izquierda a derecha.
function armarRodillos(desde, hasta) {
  const a = String(Math.max(0, desde));
  const b = String(Math.max(0, hasta));
  const largo = Math.max(a.length, b.length);
  const pa = a.padStart(largo, "0");
  const pb = b.padStart(largo, "0");
  const sube = hasta >= desde;
  let primeroQueCambia = -1;
  for (let i = 0; i < largo; i++) {
    if (pa[i] !== pb[i]) {
      primeroQueCambia = i;
      break;
    }
  }
  return Array.from({ length: largo }, (_, i) => {
    const d0 = Number(pa[i]);
    const d1 = Number(pb[i]);
    const ceroInicial = largo - i > a.length;
    const ceroFinal = largo - i > b.length;
    if (primeroQueCambia === -1 || i < primeroQueCambia) {
      return { tira: [d1], quieto: true, ceroInicial, ceroFinal, dur: 0 };
    }
    const orden = i - primeroQueCambia;
    const vueltas = 1 + orden;
    const pasos = sube ? (d1 - d0 + 10) % 10 : (d0 - d1 + 10) % 10;
    const total = vueltas * 10 + pasos;
    // La tira siempre crece hacia abajo; al bajar se recorre al revés.
    const tira = Array.from({ length: total + 1 }, (_, k) =>
      sube ? (d0 + k) % 10 : (d1 + k) % 10
    );
    return { tira, quieto: false, sube, ceroInicial, ceroFinal, dur: 900 + orden * 260 };
  });
}

function Gotas({ semilla }) {
  const gotas = useMemo(
    () =>
      Array.from({ length: GOTAS }, (_, i) => {
        const lado = i % 2 === 0 ? -1 : 1;
        return {
          dx: lado * (10 + Math.random() * 34),
          alto: -(16 + Math.random() * 26),
          caida: 18 + Math.random() * 18,
          tam: 4 + Math.random() * 3,
          retraso: Math.random() * 90,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [semilla]
  );
  return (
    <span className="tz-cc-gotas" aria-hidden="true">
      {gotas.map((g, i) => (
        <span
          key={i}
          className="tz-cc-gota"
          style={{
            "--dx": `${g.dx}px`,
            "--alto": `${g.alto}px`,
            "--caida": `${g.caida}px`,
            width: `${g.tam}px`,
            height: `${g.tam * 1.35}px`,
            animationDelay: `${g.retraso}ms`,
          }}
        />
      ))}
    </span>
  );
}

function Diamante() {
  // Ids propios por contador: la tienda pinta el contador en dos lugares
  // (uno oculto según el ancho) y un degradado dentro de un SVG oculto
  // dejaría sin pintar al otro.
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const gema = `tz-cc-g-${base}`;
  const brillo = `tz-cc-b-${base}`;
  const recorte = `tz-cc-c-${base}`;
  return (
    <span className="tz-cc-diamante" aria-hidden="true">
      <span className="tz-cc-aura" />
      <svg viewBox="0 0 32 28" className="tz-cc-gema">
        <defs>
          <linearGradient id={gema} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f2feff" />
            <stop offset="0.45" stopColor="currentColor" />
            <stop offset="1" stopColor="#8f7bff" />
          </linearGradient>
          <linearGradient id={brillo} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <clipPath id={recorte}>
            <path d="M8 1h16l7 8.5L16 27 1 9.5z" />
          </clipPath>
        </defs>
        <path d="M8 1h16l7 8.5L16 27 1 9.5z" fill={`url(#${gema})`} opacity="0.92" />
        <g fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.8" strokeLinejoin="round">
          <path d="M1 9.5h30M8 1l4 8.5L16 1l4 8.5L24 1M12 9.5 16 27l4-17.5" />
        </g>
        <g clipPath={`url(#${recorte})`}>
          <rect className="tz-cc-destello" x="-14" y="0" width="10" height="28" fill={`url(#${brillo})`} />
        </g>
        <path d="M8 1h16l7 8.5L16 27 1 9.5z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      </svg>
      <span className="tz-cc-chispa" />
    </span>
  );
}

export default function ContadorCreditos({ valor, clave, titulo = "Créditos" }) {
  const actual = Math.max(0, Math.round(Number(valor) || 0));
  const visible = useInterfazPrincipalVisible();
  const [mostrado, setMostrado] = useState(() => {
    const visto = leerVisto(clave);
    if (visto == null) {
      guardarVisto(clave, actual);
      return actual;
    }
    return visto;
  });
  const [giro, setGiro] = useState(null); // { desde, hasta, rodillos, id }
  const [arrancado, setArrancado] = useState(false);
  const [gotas, setGotas] = useState(0);
  const claveRef = useRef(clave);

  // Otro usuario en el mismo navegador: empieza desde lo que él vio.
  useEffect(() => {
    if (claveRef.current === clave) return;
    claveRef.current = clave;
    const visto = leerVisto(clave);
    if (visto == null) guardarVisto(clave, actual);
    setGiro(null);
    setMostrado(visto == null ? actual : visto);
  }, [clave, actual]);

  // Arranca el giro cuando hay diferencia y la interfaz principal está a la vista.
  useEffect(() => {
    if (giro || !visible || actual === mostrado) return;
    setArrancado(false);
    setGiro({ desde: mostrado, hasta: actual, rodillos: armarRodillos(mostrado, actual), id: Date.now() });
  }, [actual, mostrado, visible, giro]);

  // Un cuadro después de montar los rodillos en su posición inicial, se
  // los manda a la final (así corre la transición).
  useLayoutEffect(() => {
    if (!giro || arrancado) return undefined;
    const r = requestAnimationFrame(() => requestAnimationFrame(() => setArrancado(true)));
    return () => cancelAnimationFrame(r);
  }, [giro, arrancado]);

  useEffect(() => {
    if (!giro || !arrancado) return undefined;
    const dur = Math.max(0, ...giro.rodillos.map((r) => r.dur)) + 120;
    const t = setTimeout(() => {
      guardarVisto(clave, giro.hasta);
      if (giro.hasta > giro.desde) setGotas((g) => g + 1);
      setMostrado(giro.hasta);
      setGiro(null);
    }, dur);
    return () => clearTimeout(t);
  }, [giro, arrancado, clave]);

  useEffect(() => {
    if (!gotas) return undefined;
    const t = setTimeout(() => setGotas(0), 1400);
    return () => clearTimeout(t);
  }, [gotas]);

  return (
    <span className="tz-cc" title={`${titulo}: ${giro ? giro.hasta : mostrado}`} aria-label={`${titulo}: ${actual}`}>
      <style>{ESTILO}</style>
      <Diamante />
      <span className="tz-cc-numero">
        {giro ? (
          giro.rodillos.map((r, i) => {
            const pasos = r.tira.length - 1;
            const inicio = r.quieto ? 0 : r.sube ? 0 : -pasos * ALTO_DIGITO;
            const fin = r.quieto ? 0 : r.sube ? -pasos * ALTO_DIGITO : 0;
            const opacidad = arrancado ? (r.ceroFinal ? 0 : 1) : r.ceroInicial ? 0 : 1;
            return (
              <span key={`${giro.id}-${i}`} className="tz-cc-rodillo" style={{ opacity: opacidad }}>
                <span
                  className="tz-cc-tira"
                  style={{
                    transform: `translateY(${arrancado ? fin : inicio}em)`,
                    transition: arrancado && !r.quieto ? `transform ${r.dur}ms cubic-bezier(0.14, 0.82, 0.22, 1.05)` : "none",
                  }}
                >
                  {r.tira.map((d, k) => (
                    <span key={k} className="tz-cc-dig">
                      {d}
                    </span>
                  ))}
                </span>
              </span>
            );
          })
        ) : (
          String(mostrado)
            .split("")
            .map((d, i) => (
              <span key={i} className="tz-cc-celda">
                <span className="tz-cc-fijo">{d}</span>
              </span>
            ))
        )}
        {gotas > 0 && <Gotas key={gotas} semilla={gotas} />}
      </span>
    </span>
  );
}

const ESTILO = `
.tz-cc {
  --tz-cc-color: var(--cyan, #2be8ff);
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--tz-cc-color);
  font-family: 'Orbitron', 'Rajdhani', sans-serif;
  font-weight: 800;
  font-size: 19px;
  line-height: 1;
  letter-spacing: 0.04em;
  user-select: none;
}
.tz-cc-diamante {
  position: relative;
  display: inline-flex;
  width: 26px;
  height: 23px;
  flex-shrink: 0;
  color: var(--tz-cc-color);
}
.tz-cc-gema {
  position: relative;
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 4px var(--tz-cc-color)) drop-shadow(0 0 9px rgba(143, 123, 255, 0.55));
  animation: tz-cc-flotar 3.6s ease-in-out infinite;
}
.tz-cc-aura {
  position: absolute;
  inset: -9px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(43, 232, 255, 0.38), rgba(143, 123, 255, 0.18) 45%, transparent 70%);
  animation: tz-cc-aura 3.6s ease-in-out infinite;
  pointer-events: none;
}
.tz-cc-destello { animation: tz-cc-destello 4.2s ease-in-out infinite; }
.tz-cc-chispa {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 7px;
  height: 7px;
  background:
    linear-gradient(#fff, #fff) center / 1.5px 100% no-repeat,
    linear-gradient(#fff, #fff) center / 100% 1.5px no-repeat;
  filter: drop-shadow(0 0 3px #fff) drop-shadow(0 0 5px var(--tz-cc-color));
  animation: tz-cc-chispa 2.8s ease-in-out infinite;
  pointer-events: none;
}
.tz-cc-numero {
  position: relative;
  display: inline-flex;
  height: ${ALTO_DIGITO}em;
  align-items: flex-start;
  overflow: visible;
}
.tz-cc-fijo,
.tz-cc-dig {
  display: block;
  height: ${ALTO_DIGITO}em;
  line-height: ${ALTO_DIGITO}em;
  background: linear-gradient(180deg, #f2feff 8%, var(--tz-cc-color) 55%, #a08cff 100%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 5px rgba(43, 232, 255, 0.55));
}
/* Mismo ancho para cada cifra (quieta o girando): sin saltos al terminar. */
.tz-cc-celda,
.tz-cc-rodillo {
  width: 0.86em;
  text-align: center;
}
.tz-cc-celda { display: inline-block; height: ${ALTO_DIGITO}em; }
.tz-cc-rodillo {
  display: inline-block;
  height: ${ALTO_DIGITO}em;
  overflow: hidden;
  text-align: center;
  transition: opacity 0.3s ease;
  -webkit-mask-image: linear-gradient(180deg, transparent 0, #000 22%, #000 78%, transparent 100%);
  mask-image: linear-gradient(180deg, transparent 0, #000 22%, #000 78%, transparent 100%);
}
.tz-cc-tira { display: block; will-change: transform; }
.tz-cc-gotas {
  position: absolute;
  left: 50%;
  top: 30%;
  width: 0;
  height: 0;
  pointer-events: none;
}
.tz-cc-gota {
  position: absolute;
  left: 0;
  top: 0;
  border-radius: 50% 50% 50% 50% / 62% 62% 38% 38%;
  background: radial-gradient(circle at 35% 30%, #f2feff, var(--tz-cc-color) 60%);
  box-shadow: 0 0 6px var(--tz-cc-color);
  opacity: 0;
  animation: tz-cc-gota 1.05s cubic-bezier(0.3, 0.6, 0.55, 1) forwards;
}
@keyframes tz-cc-gota {
  0% { opacity: 0; transform: translate(0, 0) scale(0.4); }
  10% { opacity: 1; }
  40% { opacity: 1; transform: translate(calc(var(--dx) * 0.55), var(--alto)) scale(1); }
  100% { opacity: 0; transform: translate(var(--dx), var(--caida)) scale(0.6); }
}
@keyframes tz-cc-flotar {
  0%, 100% { transform: translateY(0) rotate(-3deg); }
  50% { transform: translateY(-2px) rotate(3deg); }
}
@keyframes tz-cc-aura {
  0%, 100% { opacity: 0.55; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.12); }
}
@keyframes tz-cc-destello {
  0%, 55% { transform: translateX(0); }
  85%, 100% { transform: translateX(46px); }
}
@keyframes tz-cc-chispa {
  0%, 60%, 100% { opacity: 0; transform: scale(0.3) rotate(0deg); }
  72% { opacity: 1; transform: scale(1) rotate(45deg); }
  86% { opacity: 0; transform: scale(0.5) rotate(90deg); }
}
`;
