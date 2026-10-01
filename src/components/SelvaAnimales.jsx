// Secuencia de fauna y flora de la selva central del Perú para la
// Animación de Bienvenida (AnimacionNeonBienvenida.jsx). Pedido: "cada
// animal tiene su tiempo de brillar, ninguno compite por atención" —
// por eso cada uno vive en su PROPIA ventana de tiempo (TIEMPOS, en
// segundos desde que se monta la bienvenida) y está invisible fuera de
// ella. Todo es CSS puro (keyframes con animation-delay): nada de JS
// por cuadro, y como en cada momento solo se anima UN animal, aguanta
// bien en celulares modestos. Siluetas de neón dibujadas a mano, mismo
// lenguaje que las hojas/lianas de la escena.
//
// Mismo archivo en Caja Tonazo y Taxi-PE — mantener las dos copias
// iguales.

// Ventanas de la secuencia (s). La bienvenida empieza a cerrarse a los
// 9 s (ver MS_CIERRE en AnimacionNeonBienvenida.jsx).
const TIEMPOS = {
  heliconias: 0.45, // brotan y quedan colgando toda la animación
  loros: 1.25,
  mono: 2.4,
  tigrillo: 3.5,
  gallito: 4.8,
  serpiente: 5.9,
  rio: 6.7, // aparece y queda hasta el cierre
  caiman: 7.0,
  barbones: 7.95,
};

// ---------------------------------------------------------------------
// Pico de loro (Heliconia rostrata): inflorescencia colgante en zigzag,
// brácteas rojas con punta amarilla que brotan una tras otra.
// ---------------------------------------------------------------------
const BRACTEAS = Array.from({ length: 7 }, (_, i) => {
  const s = 1 - i * 0.085;
  const y = 12 + i * 16.5;
  const izq = i % 2 === 0;
  const x = (dx) => (izq ? 25 - dx : 25 + dx);
  return {
    i,
    izq,
    d: `M25,${y} C${x(6 * s)},${y + 2 * s} ${x(18 * s)},${y + 6 * s} ${x(21 * s)},${y + 15 * s} C${x(14 * s)},${y + 14 * s} ${x(6 * s)},${y + 12 * s} 25,${y + 9 * s} Z`,
  };
});

function Heliconia({ className, delay }) {
  return (
    <svg className={`tz-selva-heliconia ${className}`} viewBox="0 0 50 140" aria-hidden="true">
      <defs>
        <linearGradient id="tz-hel-izq" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0%" stopColor="#ff2f5e" />
          <stop offset="72%" stopColor="#ff4d3d" />
          <stop offset="100%" stopColor="#ffe066" />
        </linearGradient>
        <linearGradient id="tz-hel-der" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ff2f5e" />
          <stop offset="72%" stopColor="#ff4d3d" />
          <stop offset="100%" stopColor="#ffe066" />
        </linearGradient>
      </defs>
      <g className="tz-selva-heliconia-sway" style={{ animationDelay: `${delay + 1.2}s` }}>
        <path className="tz-selva-heliconia-tallo" d="M25,0 C24,40 26,90 25,130" />
        {BRACTEAS.map((b) => (
          <path
            key={b.i}
            d={b.d}
            className={`tz-selva-bractea ${b.izq ? "tz-selva-bractea-izq" : "tz-selva-bractea-der"}`}
            fill={b.izq ? "url(#tz-hel-izq)" : "url(#tz-hel-der)"}
            style={{ animationDelay: `${delay + b.i * 0.09}s` }}
          />
        ))}
      </g>
    </svg>
  );
}

// ---------------------------------------------------------------------
// Loro / guacamayo en vuelo (rojo, alas amarillo-azul, cola larga).
// ---------------------------------------------------------------------
function Loro({ className, delay }) {
  return (
    <div className={`tz-selva-animal tz-selva-loro ${className}`} style={{ animationDelay: `${delay}s` }}>
      <svg viewBox="0 0 120 64" aria-hidden="true">
        <defs>
          <linearGradient id="tz-loro-ala" x1="0" y1="1" x2="0.4" y2="0">
            <stop offset="0%" stopColor="#ffd23f" />
            <stop offset="55%" stopColor="#2bb8ff" />
            <stop offset="100%" stopColor="#3d5bff" />
          </linearGradient>
          <linearGradient id="tz-loro-cola" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor="#ff3b5c" />
            <stop offset="100%" stopColor="#2bb8ff" />
          </linearGradient>
        </defs>
        <path className="tz-selva-loro-ala tz-selva-loro-ala-lejana" d="M60,30 C62,14 72,4 86,0 C82,12 76,24 74,32 Z" />
        <path className="tz-selva-loro-cola" d="M4,44 C22,40 36,36 48,33 L48,39 C36,41 22,44 4,44 Z" />
        <path className="tz-selva-loro-cuerpo" d="M46,32 C56,22 76,21 88,27 C93,30 93,36 88,38 C77,43 57,42 46,38 Z" />
        <circle className="tz-selva-loro-cuerpo" cx="92" cy="27" r="9" />
        <ellipse cx="95.5" cy="27" rx="4" ry="3.6" fill="rgba(255,255,255,0.88)" />
        <circle cx="95.5" cy="26.2" r="1.5" fill="#120a05" />
        <path className="tz-selva-loro-pico" d="M100,23 C108,22 111,30 104,35 C103,31 101,29 99,29 Z" />
        <path className="tz-selva-loro-ala" d="M60,30 C62,14 72,4 86,0 C82,12 76,24 74,32 Z" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------
// Mono pequeño colgado de una liana por la cola — baja, se mece, saluda
// y vuelve a subir.
// ---------------------------------------------------------------------
function Mono() {
  return (
    <div className="tz-selva-animal tz-selva-mono" style={{ animationDelay: `${TIEMPOS.mono}s` }}>
      <svg viewBox="0 0 80 150" aria-hidden="true">
        <path className="tz-selva-mono-cola" d="M40,0 C40,8 52,10 50,18 C48,26 36,24 38,32 C40,40 40,46 40,54" />
        <path className="tz-selva-mono-linea" d="M33,58 C27,52 29,45 34,42" />
        <path className="tz-selva-mono-linea" d="M47,58 C53,52 51,45 46,42" />
        <ellipse className="tz-selva-mono-cuerpo" cx="40" cy="72" rx="12" ry="18" />
        <path className="tz-selva-mono-linea" d="M30,76 C22,88 22,98 28,106" />
        <g className="tz-selva-mono-saludo" style={{ animationDelay: `${TIEMPOS.mono + 0.5}s` }}>
          <path className="tz-selva-mono-linea" d="M50,76 C60,84 66,92 64,102" />
          <circle className="tz-selva-mono-cuerpo" cx="64" cy="104" r="3.4" />
        </g>
        <circle className="tz-selva-mono-cuerpo" cx="26" cy="104" r="4.6" />
        <circle className="tz-selva-mono-cuerpo" cx="54" cy="104" r="4.6" />
        <circle className="tz-selva-mono-cuerpo" cx="40" cy="104" r="13" />
        <ellipse cx="40" cy="106" rx="8.6" ry="7.6" fill="rgba(255,224,176,0.9)" />
        <circle cx="36.6" cy="104" r="1.7" fill="#1a0c02" />
        <circle cx="43.4" cy="104" r="1.7" fill="#1a0c02" />
        <path d="M37,109.5 Q40,111.8 43,109.5" fill="none" stroke="#1a0c02" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------
// Tigrillo (ocelote): camina por la maleza, se detiene y le brillan los
// ojos, sigue su camino.
// ---------------------------------------------------------------------
const ROSETAS = [
  [50, 30, 5, 3],
  [66, 27, 5, 3],
  [82, 26, 5, 3],
  [98, 28, 5, 3],
  [58, 38, 4, 2.5],
  [76, 37, 4, 2.5],
  [94, 38, 4, 2.5],
  [112, 33, 4, 2.5],
];

function Tigrillo() {
  return (
    <div className="tz-selva-animal tz-selva-tigrillo" style={{ animationDelay: `${TIEMPOS.tigrillo}s` }}>
      <svg viewBox="0 0 170 80" aria-hidden="true">
        <path className="tz-selva-tigrillo-cola" d="M34,34 C20,32 10,40 8,52 C7,58 12,60 14,55" />
        <g className="tz-selva-pasos-b">
          <line className="tz-selva-tigrillo-pata" x1="44" y1="44" x2="42" y2="66" />
          <line className="tz-selva-tigrillo-pata" x1="104" y1="44" x2="106" y2="66" />
        </g>
        <path className="tz-selva-tigrillo-cuerpo" d="M32,30 C46,20 104,18 122,26 C130,30 130,42 122,46 C104,50 52,50 36,46 C28,44 26,34 32,30 Z" />
        <g className="tz-selva-pasos-a">
          <line className="tz-selva-tigrillo-pata" x1="54" y1="44" x2="56" y2="66" />
          <line className="tz-selva-tigrillo-pata" x1="114" y1="42" x2="112" y2="66" />
        </g>
        {ROSETAS.map(([cx, cy, rx, ry]) => (
          <ellipse key={`${cx}-${cy}`} className="tz-selva-tigrillo-roseta" cx={cx} cy={cy} rx={rx} ry={ry} />
        ))}
        <path className="tz-selva-tigrillo-cuerpo" d="M126,16 L127,6 L134,13 Z" />
        <path className="tz-selva-tigrillo-cuerpo" d="M140,13 L146,5 L148,16 Z" />
        <path className="tz-selva-tigrillo-cuerpo" d="M120,22 C126,13 144,12 152,20 C157,26 154,36 146,39 C138,42 126,38 121,32 Z" />
        <path className="tz-selva-tigrillo-roseta" d="M150,30 C155,31 156,35 152,36" />
        <ellipse className="tz-selva-tigrillo-ojo" cx="140" cy="24" rx="2.6" ry="1.7" style={{ animationDelay: `${TIEMPOS.tigrillo}s` }} />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------
// Gallito de las rocas (ave nacional del Perú): llega volando, se posa
// en una rama, abre las alas y mueve la cresta.
// ---------------------------------------------------------------------
function Gallito() {
  return (
    <div className="tz-selva-animal tz-selva-gallito" style={{ animationDelay: `${TIEMPOS.gallito}s` }}>
      <svg viewBox="0 0 110 120" aria-hidden="true">
        <defs>
          <linearGradient id="tz-gallito-cuerpo" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffa31a" />
            <stop offset="100%" stopColor="#ff5a00" />
          </linearGradient>
        </defs>
        <path className="tz-selva-rama" d="M0,100 C30,94 70,98 110,90" />
        <path className="tz-selva-rama-hoja" d="M86,94 C92,84 102,84 104,88 C98,94 92,96 86,94 Z" />
        <path className="tz-selva-gallito-oscuro" d="M44,84 L36,104 L50,100 Z" />
        <path className="tz-selva-gallito-pata" d="M48,88 L46,99 M56,88 L56,98" />
        <path className="tz-selva-gallito-cuerpo" d="M32,64 C30,46 42,36 56,37 C72,38 80,52 78,66 C76,82 62,90 50,88 C40,86 33,78 32,64 Z" />
        <path
          className="tz-selva-gallito-oscuro tz-selva-gallito-ala"
          d="M58,52 C74,54 86,68 82,86 C72,78 62,68 58,52 Z"
          style={{ animationDelay: `${TIEMPOS.gallito + 0.55}s` }}
        />
        <g className="tz-selva-gallito-cresta" style={{ animationDelay: `${TIEMPOS.gallito + 0.55}s` }}>
          <path className="tz-selva-gallito-cuerpo" d="M40,40 C34,22 46,8 62,10 C74,12 79,26 71,38 C63,44 48,46 40,40 Z" />
          <path d="M74,30 L80,32 L74,34 Z" fill="#ffe066" />
          <circle cx="63" cy="26" r="2.3" fill="#fff4d6" />
          <circle cx="63.4" cy="26.2" r="1.1" fill="#1a0c02" />
        </g>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------
// Serpiente bajando enroscada por una liana. El cuerpo es un tramo de
// trazo (stroke-dasharray con pathLength=100) que "viaja" por el camino
// en espiral; la cabeza es un segundo tramo más grueso en la punta.
// ---------------------------------------------------------------------
const CAMINO_SERPIENTE =
  "M20,0 C34,10 34,24 20,30 C6,36 6,50 20,56 C34,62 34,76 20,82 C6,88 6,102 20,108 C34,114 34,128 20,134 C6,140 6,154 20,160 C34,166 34,180 20,186";

function Serpiente() {
  const d = { animationDelay: `${TIEMPOS.serpiente}s` };
  return (
    <div className="tz-selva-animal tz-selva-serpiente" style={d}>
      <svg viewBox="0 0 40 200" preserveAspectRatio="none" aria-hidden="true">
        <path className="tz-selva-serpiente-liana" d="M20,0 C18,50 22,100 20,200" vectorEffect="non-scaling-stroke" />
        <path className="tz-selva-serpiente-cuerpo" d={CAMINO_SERPIENTE} pathLength="100" vectorEffect="non-scaling-stroke" style={d} />
        <path className="tz-selva-serpiente-dibujo" d={CAMINO_SERPIENTE} pathLength="100" vectorEffect="non-scaling-stroke" style={d} />
        <path className="tz-selva-serpiente-cabeza" d={CAMINO_SERPIENTE} pathLength="100" vectorEffect="non-scaling-stroke" style={d} />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------
// Río (aparece al final y queda), caimán y barbones saltando.
// ---------------------------------------------------------------------
function Rio() {
  return (
    <svg className="tz-selva-rio" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true" style={{ animationDelay: `${TIEMPOS.rio}s` }}>
      <defs>
        <linearGradient id="tz-rio-agua" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(43,232,255,0.38)" />
          <stop offset="100%" stopColor="rgba(10,40,80,0.05)" />
        </linearGradient>
      </defs>
      <path d="M0,4 C12,2 22,6 34,4 C46,2 56,6 68,4 C80,2 90,6 100,4 L100,20 L0,20 Z" fill="url(#tz-rio-agua)" />
      <path className="tz-selva-rio-onda" d="M0,4 C12,2 22,6 34,4 C46,2 56,6 68,4 C80,2 90,6 100,4" vectorEffect="non-scaling-stroke" />
      <path className="tz-selva-rio-onda tz-selva-rio-onda-2" d="M0,10 C10,8 24,12 36,10 C48,8 58,12 72,10 C84,8 92,12 100,10" vectorEffect="non-scaling-stroke" />
      <path className="tz-selva-rio-onda tz-selva-rio-onda-3" d="M0,15 C14,13 26,17 40,15 C52,13 64,17 76,15 C88,13 94,17 100,15" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Caiman() {
  return (
    <div className="tz-selva-animal tz-selva-caiman" style={{ animationDelay: `${TIEMPOS.caiman}s` }}>
      <svg viewBox="0 0 170 44" aria-hidden="true">
        <defs>
          <clipPath id="tz-caiman-agua">
            <rect x="0" y="0" width="170" height="30" />
          </clipPath>
        </defs>
        <g clipPath="url(#tz-caiman-agua)">
          <g className="tz-selva-caiman-cuerpo" style={{ animationDelay: `${TIEMPOS.caiman}s` }}>
            <path className="tz-selva-caiman-forma" d="M14,30 L20,23 L26,30 L32,22 L38,30 L44,22 L50,30 L56,22 L62,30 L68,23 L74,30 Z" />
            <path className="tz-selva-caiman-forma" d="M84,30 C86,20 98,17 104,25 C114,21 142,21 160,27 C163,28 163,30 161,30 Z" />
            <ellipse className="tz-selva-caiman-ojo" cx="95" cy="22" rx="3.6" ry="2.4" />
            <circle cx="156" cy="25.4" r="1.2" fill="#39ff8a" />
          </g>
        </g>
        <ellipse className="tz-selva-onda-agua" cx="95" cy="31" rx="40" ry="3" style={{ animationDelay: `${TIEMPOS.caiman + 0.15}s` }} />
      </svg>
    </div>
  );
}

// Barbones (bagre de río, con sus "barbas"): saltan con el MISMO ritmo
// pero desfasados y a distintas alturas — sincronía asimétrica.
const BARBONES = [
  { left: 46, alto: 11, delay: 0, dur: 0.82 },
  { left: 54, alto: 16, delay: 0.17, dur: 0.78 },
  { left: 62, alto: 9, delay: 0.07, dur: 0.86 },
  { left: 70, alto: 14, delay: 0.26, dur: 0.8 },
  { left: 79, alto: 18, delay: 0.12, dur: 0.84 },
];

function Barbon({ left, alto, delay, dur }) {
  const t = `${TIEMPOS.barbones + delay}s`;
  return (
    <>
      <span className="tz-selva-salpicadura" style={{ left: `calc(${left}% + 2vmin)`, animationDelay: t, animationDuration: `${dur}s` }} />
      <div
        className="tz-selva-animal tz-selva-barbon"
        style={{ left: `${left}%`, animationDelay: t, animationDuration: `${dur}s`, "--tz-barbon-alto": `-${alto}vh` }}
      >
        <svg viewBox="-6 0 72 34" aria-hidden="true">
          <path className="tz-selva-barbon-aleta" d="M24,8 L30,1 L35,8 Z" />
          <path className="tz-selva-barbon-aleta" d="M8,16 L0,8 L2,16 L0,24 Z" />
          <path className="tz-selva-barbon-cuerpo" d="M6,16 C12,7 32,5 46,11 C50,13 52,15 52,16 C52,17 50,19 46,21 C32,27 12,25 6,16 Z" />
          <circle cx="44" cy="13.4" r="1.6" fill="#eafcff" />
          <path className="tz-selva-barbon-barba" d="M51,18 C56,22 59,26 61,30 M51,14 C56,10 59,6 62,3 M48,19 C51,24 53,28 53,31" />
        </svg>
      </div>
    </>
  );
}

export default function SelvaAnimales() {
  return (
    <div className="tz-selva" aria-hidden="true">
      <Heliconia className="tz-selva-heliconia-1" delay={TIEMPOS.heliconias} />
      <Heliconia className="tz-selva-heliconia-2" delay={TIEMPOS.heliconias + 0.25} />
      <Heliconia className="tz-selva-heliconia-3" delay={TIEMPOS.heliconias + 0.12} />

      <Loro className="tz-selva-loro-1" delay={TIEMPOS.loros} />
      <Loro className="tz-selva-loro-2" delay={TIEMPOS.loros + 0.12} />
      <Loro className="tz-selva-loro-3" delay={TIEMPOS.loros + 0.26} />

      <Mono />
      <Tigrillo />
      <Gallito />
      <Serpiente />

      <Rio />
      <Caiman />
      {BARBONES.map((b) => (
        <Barbon key={b.left} {...b} />
      ))}

      <style>{`
        .tz-selva {
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          overflow: hidden;
        }
        .tz-selva svg { display: block; width: 100%; height: auto; overflow: visible; }
        .tz-selva-animal {
          position: absolute;
          opacity: 0;
          will-change: transform, opacity;
          animation-fill-mode: both;
          animation-timing-function: ease-in-out;
        }

        /* ---- Pico de loro (heliconias colgantes) ---- */
        /* .tz-selva delante para ganarle a ".tz-selva svg" (width 100%). */
        .tz-selva .tz-selva-heliconia {
          position: absolute;
          top: 0;
          height: clamp(110px, 24vh, 230px);
          width: auto;
          aspect-ratio: 50 / 140;
          filter: drop-shadow(0 0 6px rgba(255,47,94,0.55));
        }
        .tz-selva .tz-selva-heliconia-1 { left: 13%; }
        .tz-selva .tz-selva-heliconia-2 { left: 63%; height: clamp(90px, 19vh, 190px); }
        .tz-selva .tz-selva-heliconia-3 { right: 9%; }
        .tz-selva-heliconia-tallo { fill: none; stroke: #39ff8a; stroke-width: 2; }
        .tz-selva-bractea {
          stroke: rgba(255,224,102,0.85);
          stroke-width: 0.7;
          transform-box: fill-box;
          transform: scale(0);
          animation: tz-selva-brote 0.45s cubic-bezier(.34,1.56,.64,1) both;
        }
        .tz-selva-bractea-izq { transform-origin: 100% 0%; }
        .tz-selva-bractea-der { transform-origin: 0% 0%; }
        @keyframes tz-selva-brote { from { transform: scale(0); } to { transform: scale(1); } }
        .tz-selva-heliconia-sway {
          transform-box: view-box;
          transform-origin: 25px 0px;
          animation: tz-selva-mecer 3.4s ease-in-out infinite;
        }
        @keyframes tz-selva-mecer {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }

        /* ---- Loros ---- */
        .tz-selva-loro { width: clamp(92px, 20vmin, 210px); animation-name: tz-selva-loro-vuelo; animation-duration: 1.55s; animation-timing-function: linear; }
        .tz-selva-loro-1 { top: 7%; }
        .tz-selva-loro-2 { top: 17%; width: clamp(70px, 15vmin, 160px); }
        .tz-selva-loro-3 { top: 11%; width: clamp(80px, 17vmin, 180px); }
        @keyframes tz-selva-loro-vuelo {
          0% { opacity: 0; transform: translate(-22vw, 3vh) rotate(-6deg); }
          10% { opacity: 1; }
          50% { transform: translate(48vw, -2vh) rotate(2deg); }
          90% { opacity: 1; }
          100% { opacity: 0; transform: translate(112vw, 2vh) rotate(-4deg); }
        }
        .tz-selva-loro-cuerpo { fill: #ff3b5c; stroke: #ffb3c1; stroke-width: 1; filter: drop-shadow(0 0 5px rgba(255,59,92,0.8)); }
        .tz-selva-loro-cola { fill: url(#tz-loro-cola); filter: drop-shadow(0 0 4px rgba(43,184,255,0.7)); }
        .tz-selva-loro-pico { fill: #f4f4f4; stroke: #cfcfcf; stroke-width: 0.6; }
        .tz-selva-loro-ala {
          fill: url(#tz-loro-ala);
          stroke: rgba(255,255,255,0.6);
          stroke-width: 0.6;
          transform-box: view-box;
          transform-origin: 67px 31px;
          animation: tz-selva-aleteo 0.24s ease-in-out infinite alternate;
          filter: drop-shadow(0 0 5px rgba(43,184,255,0.8));
        }
        .tz-selva-loro-ala-lejana { opacity: 0.45; animation-direction: alternate-reverse; }
        @keyframes tz-selva-aleteo {
          from { transform: scaleY(1); }
          to { transform: scaleY(-0.75); }
        }

        /* ---- Mono ---- */
        .tz-selva-mono {
          left: 25%;
          top: 0;
          width: clamp(84px, 19vmin, 180px);
          transform-origin: 50% 0%;
          animation-name: tz-selva-mono-baja;
          animation-duration: 1.45s;
        }
        @keyframes tz-selva-mono-baja {
          0% { opacity: 0; transform: translateY(-105%) rotate(0deg); }
          8% { opacity: 1; }
          30% { transform: translateY(6%) rotate(-6deg); }
          42% { transform: translateY(-2%) rotate(7deg); }
          58% { transform: translateY(0) rotate(-5deg); }
          74% { transform: translateY(0) rotate(4deg); }
          92% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-105%) rotate(0deg); }
        }
        .tz-selva-mono-cuerpo { fill: rgba(48,24,6,0.95); stroke: #ffb347; stroke-width: 1.6; filter: drop-shadow(0 0 5px rgba(255,179,71,0.75)); }
        .tz-selva-mono-cola, .tz-selva-mono-linea {
          fill: none;
          stroke: #ffb347;
          stroke-width: 3.2;
          stroke-linecap: round;
          filter: drop-shadow(0 0 4px rgba(255,179,71,0.75));
        }
        .tz-selva-mono-saludo {
          transform-box: view-box;
          transform-origin: 50px 76px;
          animation: tz-selva-saludo 0.22s ease-in-out 4 alternate both;
        }
        @keyframes tz-selva-saludo {
          from { transform: rotate(0deg); }
          to { transform: rotate(-38deg); }
        }

        /* ---- Tigrillo ---- */
        .tz-selva-tigrillo {
          bottom: 9vh;
          left: 0;
          width: clamp(170px, 38vmin, 360px);
          animation-name: tz-selva-tigrillo-camina;
          animation-duration: 1.7s;
          animation-timing-function: linear;
        }
        @keyframes tz-selva-tigrillo-camina {
          0% { opacity: 0; transform: translateX(-30vmin); }
          10% { opacity: 1; }
          45% { transform: translateX(26vw); }
          68% { transform: translateX(28vw); }
          92% { opacity: 1; }
          100% { opacity: 0; transform: translateX(52vw); }
        }
        .tz-selva-tigrillo-cuerpo { fill: rgba(44,24,4,0.95); stroke: #ffae2b; stroke-width: 1.8; filter: drop-shadow(0 0 6px rgba(255,174,43,0.8)); }
        .tz-selva-tigrillo-cola { fill: none; stroke: #ffae2b; stroke-width: 5; stroke-linecap: round; stroke-dasharray: 6 3; filter: drop-shadow(0 0 4px rgba(255,174,43,0.8)); }
        .tz-selva-tigrillo-pata { stroke: #ffae2b; stroke-width: 6; stroke-linecap: round; filter: drop-shadow(0 0 4px rgba(255,174,43,0.7)); }
        .tz-selva-tigrillo-roseta { fill: none; stroke: #ffe08a; stroke-width: 1.4; }
        .tz-selva-tigrillo-ojo {
          fill: #fff36b;
          animation: tz-selva-ojos 1.7s linear both;
        }
        @keyframes tz-selva-ojos {
          0%, 44% { filter: none; }
          52%, 66% { filter: drop-shadow(0 0 4px #fff36b) drop-shadow(0 0 10px #ffe600); }
          74%, 100% { filter: none; }
        }
        .tz-selva-pasos-a, .tz-selva-pasos-b { transform-box: view-box; }
        .tz-selva-pasos-a { animation: tz-selva-paso-a 0.36s ease-in-out infinite; }
        .tz-selva-pasos-b { animation: tz-selva-paso-b 0.36s ease-in-out infinite; }
        @keyframes tz-selva-paso-a { 0%, 100% { transform: translateY(-2.5px); } 50% { transform: translateY(2.5px); } }
        @keyframes tz-selva-paso-b { 0%, 100% { transform: translateY(2.5px); } 50% { transform: translateY(-2.5px); } }

        /* ---- Gallito de las rocas ---- */
        .tz-selva-gallito {
          right: 5%;
          top: 33%;
          width: clamp(110px, 25vmin, 240px);
          animation-name: tz-selva-gallito-llega;
          animation-duration: 1.45s;
        }
        @keyframes tz-selva-gallito-llega {
          0% { opacity: 0; transform: translate(22vw, -24vh) scale(0.55) rotate(-14deg); }
          10% { opacity: 1; }
          36% { transform: translate(0, 0) scale(1) rotate(0deg); }
          42% { transform: translate(0, 2%) scale(1.03, 0.97); }
          50%, 86% { transform: translate(0, 0) scale(1); }
          92% { opacity: 1; }
          100% { opacity: 0; transform: translate(0, -4%) scale(0.96); }
        }
        .tz-selva-gallito-cuerpo { fill: url(#tz-gallito-cuerpo); stroke: #ffd38a; stroke-width: 1; filter: drop-shadow(0 0 7px rgba(255,122,26,0.85)); }
        .tz-selva-gallito-oscuro { fill: #1c1c22; stroke: #c9c9d6; stroke-width: 1.1; }
        .tz-selva-gallito-pata { fill: none; stroke: #ffd38a; stroke-width: 2; stroke-linecap: round; }
        .tz-selva-gallito-ala {
          transform-box: view-box;
          transform-origin: 60px 54px;
          animation: tz-selva-gallito-ala 0.32s ease-in-out 2 alternate both;
        }
        @keyframes tz-selva-gallito-ala {
          from { transform: rotate(0deg); }
          to { transform: rotate(-48deg) scale(1.15); }
        }
        .tz-selva-gallito-cresta {
          transform-box: view-box;
          transform-origin: 56px 40px;
          animation: tz-selva-cresta 0.3s ease-in-out 3 alternate both;
        }
        @keyframes tz-selva-cresta {
          from { transform: rotate(0deg); }
          to { transform: rotate(-9deg) translateY(-1.5px); }
        }
        .tz-selva-rama { fill: none; stroke: #8b5a2b; stroke-width: 4; stroke-linecap: round; filter: drop-shadow(0 0 3px rgba(57,255,138,0.5)); }
        .tz-selva-rama-hoja { fill: rgba(57,255,138,0.75); filter: drop-shadow(0 0 4px #39ff8a); }

        /* ---- Serpiente ---- */
        .tz-selva-serpiente {
          right: 23%;
          top: 0;
          width: clamp(44px, 10vmin, 92px);
          height: 70vh;
          animation-name: tz-selva-aparece-y-va;
          animation-duration: 1.5s;
          animation-timing-function: linear;
        }
        .tz-selva-serpiente svg { height: 100%; }
        @keyframes tz-selva-aparece-y-va {
          0% { opacity: 0; }
          10%, 88% { opacity: 1; }
          100% { opacity: 0; }
        }
        .tz-selva-serpiente-liana { fill: none; stroke: rgba(57,255,138,0.55); stroke-width: 3; }
        .tz-selva-serpiente-cuerpo,
        .tz-selva-serpiente-dibujo,
        .tz-selva-serpiente-cabeza {
          fill: none;
          stroke-linecap: round;
          animation-duration: 1.5s;
          animation-timing-function: linear;
          animation-fill-mode: both;
        }
        .tz-selva-serpiente-cuerpo {
          stroke: #a6ff4d;
          stroke-width: 11;
          stroke-dasharray: 26 200;
          animation-name: tz-selva-serpiente-cuerpo;
          filter: drop-shadow(0 0 6px rgba(166,255,77,0.85));
        }
        .tz-selva-serpiente-dibujo {
          stroke: #14330a;
          stroke-width: 4;
          stroke-dasharray: 26 200;
          animation-name: tz-selva-serpiente-cuerpo;
          opacity: 0.55;
        }
        .tz-selva-serpiente-cabeza {
          stroke: #e8ff7a;
          stroke-width: 16;
          stroke-dasharray: 2.4 200;
          animation-name: tz-selva-serpiente-cabeza;
          filter: drop-shadow(0 0 6px #e8ff7a);
        }
        @keyframes tz-selva-serpiente-cuerpo { from { stroke-dashoffset: 26; } to { stroke-dashoffset: -104; } }
        @keyframes tz-selva-serpiente-cabeza { from { stroke-dashoffset: 2.4; } to { stroke-dashoffset: -127.6; } }

        /* ---- Río ---- */
        .tz-selva-rio {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 6vh;
          width: 100% !important;
          height: 13vh !important;
          opacity: 0;
          animation: tz-selva-rio-sube 0.6s ease-out both;
        }
        @keyframes tz-selva-rio-sube {
          from { opacity: 0; transform: translateY(4vh); }
          to { opacity: 1; transform: translateY(0); }
        }
        .tz-selva-rio-onda {
          fill: none;
          stroke: rgba(150,240,255,0.75);
          stroke-width: 1.6;
          stroke-dasharray: 10 6;
          animation: tz-selva-corriente 1.6s linear infinite;
          filter: drop-shadow(0 0 4px rgba(43,232,255,0.8));
        }
        .tz-selva-rio-onda-2 { opacity: 0.6; animation-duration: 2.1s; }
        .tz-selva-rio-onda-3 { opacity: 0.35; animation-duration: 2.7s; }
        @keyframes tz-selva-corriente { to { stroke-dashoffset: -32; } }

        /* ---- Caimán ---- */
        .tz-selva-caiman {
          left: 24%;
          bottom: 13vh;
          width: clamp(180px, 42vmin, 400px);
          animation-name: tz-selva-aparece-y-va;
          animation-duration: 1.3s;
        }
        .tz-selva-caiman-cuerpo {
          transform-box: view-box;
          animation: tz-selva-caiman-asoma 1.3s ease-in-out both;
        }
        @keyframes tz-selva-caiman-asoma {
          0% { transform: translate(0, 16px); }
          28% { transform: translate(0, 0); }
          72% { transform: translate(14px, 0); }
          100% { transform: translate(18px, 16px); }
        }
        .tz-selva-caiman-forma { fill: rgba(8,40,20,0.95); stroke: #39ff8a; stroke-width: 1.4; filter: drop-shadow(0 0 5px rgba(57,255,138,0.8)); }
        .tz-selva-caiman-ojo { fill: #fff36b; filter: drop-shadow(0 0 4px #fff36b) drop-shadow(0 0 8px #ffe600); }
        .tz-selva-onda-agua {
          fill: none;
          stroke: rgba(150,240,255,0.8);
          stroke-width: 1;
          transform-box: fill-box;
          transform-origin: center;
          animation: tz-selva-onda 1.1s ease-out both;
        }
        @keyframes tz-selva-onda {
          0% { opacity: 0; transform: scale(0.3); }
          30% { opacity: 1; }
          100% { opacity: 0; transform: scale(1.25); }
        }

        /* ---- Barbones ---- */
        .tz-selva-barbon {
          bottom: 15vh;
          width: clamp(52px, 12vmin, 110px);
          animation-name: tz-selva-salto;
          animation-timing-function: linear;
        }
        @keyframes tz-selva-salto {
          0% { opacity: 0; transform: translate(0, 0) rotate(-58deg); }
          8% { opacity: 1; }
          50% { transform: translate(2.2vw, var(--tz-barbon-alto)) rotate(0deg); }
          92% { opacity: 1; }
          100% { opacity: 0; transform: translate(4.4vw, 2vh) rotate(62deg); }
        }
        .tz-selva-barbon-cuerpo { fill: rgba(10,34,60,0.95); stroke: #9be7ff; stroke-width: 1.4; filter: drop-shadow(0 0 5px rgba(155,231,255,0.85)); }
        .tz-selva-barbon-aleta { fill: rgba(155,231,255,0.55); stroke: #9be7ff; stroke-width: 0.8; }
        .tz-selva-barbon-barba { fill: none; stroke: #eafcff; stroke-width: 1; stroke-linecap: round; }
        .tz-selva-salpicadura {
          position: absolute;
          bottom: 16vh;
          width: 7vmin;
          height: 1.6vmin;
          margin-left: -3.5vmin;
          border-radius: 50%;
          border: 1.5px solid rgba(150,240,255,0.85);
          box-shadow: 0 0 8px rgba(43,232,255,0.7);
          opacity: 0;
          animation-name: tz-selva-salpica;
          animation-fill-mode: both;
          animation-timing-function: ease-out;
        }
        @keyframes tz-selva-salpica {
          0% { opacity: 0; transform: scale(0.3); }
          10% { opacity: 1; transform: scale(1); }
          30% { opacity: 0; transform: scale(1.4); }
          100% { opacity: 0; }
        }

        @media (prefers-reduced-motion: reduce) {
          .tz-selva-animal, .tz-selva-salpicadura { display: none; }
        }
      `}</style>
    </div>
  );
}
