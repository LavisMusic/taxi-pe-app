import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// Cuánto dura CADA fase — pedido explícito: "10 segundos de animación
// como tal". 1s entrada + 8.1s sostenida + 0.9s salida = 10s de punta a
// punta.
const MS_VISIBLE = 8100;

// Orquestación de fases vía variants (no un solo "transition" suelto)
// porque entrada y salida piden curvas Y duraciones DISTINTAS: la
// entrada es un "pop" hacia afuera (easeOutExpo-ish), la salida es un
// desvanecido simple y un poco más rápido.
const variantesOverlay = {
  initial: { opacity: 0, scale: 1.12 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { duration: 1, ease: [0.16, 1, 0.3, 1] },
  },
  exit: {
    opacity: 0,
    scale: 0.94,
    filter: "blur(10px)",
    transition: { duration: 0.9, ease: "easeIn" },
  },
};

// Silueta de hoja reusable (un solo <symbol> definido una vez, referenciado
// con <use> en cada instancia) — antes cada hoja repetía el mismo <path>
// larguísimo copiado y pegado 3 veces; con <symbol>/<use> el marcado real
// queda una sola vez y cada instancia es una línea.
function DefsCompartidos() {
  return (
    <defs>
      <symbol id="tz-neon-hoja" viewBox="0 0 120 160">
        <path
          className="tz-neon-leaf-shape"
          d="M60,4 C90,20 112,55 108,95 C104,135 82,150 60,156 C38,150 16,135 12,95 C8,55 30,20 60,4 Z"
        />
        <path
          className="tz-neon-leaf-vein"
          d="M60,20 L60,145 M60,52 L40,74 M60,52 L80,74 M60,92 L38,114 M60,92 L82,114"
        />
      </symbol>
      {/* Criatura genérica de la selva — un cuadrúpedo simple visto de
         perfil, con 2 pares de patas que se animan por separado (ver
         .tz-neon-walker-legs-a/-b) para leerse como "caminando" sin
         necesitar un ciclo de animación cuadro por cuadro. */}
      <symbol id="tz-neon-criatura" viewBox="0 0 120 62">
        <path className="tz-neon-walker-tail" d="M28,32 C10,27 8,12 18,4" fill="none" strokeLinecap="round" />
        <g className="tz-neon-walker-legs-b">
          <line className="tz-neon-walker-leg" x1="68" y1="42" x2="70" y2="58" />
          <line className="tz-neon-walker-leg" x1="28" y1="42" x2="26" y2="58" />
        </g>
        <g className="tz-neon-walker-legs-a">
          <line className="tz-neon-walker-leg" x1="80" y1="42" x2="78" y2="58" />
          <line className="tz-neon-walker-leg" x1="40" y1="42" x2="42" y2="58" />
        </g>
        <ellipse className="tz-neon-walker-shape" cx="60" cy="30" rx="34" ry="15" />
        <circle className="tz-neon-walker-shape" cx="98" cy="20" r="11" />
        <path className="tz-neon-walker-shape" d="M90,10 L86,-2 L98,6 Z" />
      </symbol>
      {/* Serpiente — cuerpo ondulado (una sola curva en zigzag, sin
         patas) más cabeza. El "arrastre" no es un ciclo de músculos
         real, es la combinación de cruzar la pantalla + un rotate()
         que se mece de lado a lado (ver .tz-neon-snake-*) — igual que
         las patas de la criatura de arriba, se lee bien a esta escala
         sin necesitar una animación cuadro por cuadro de verdad. */}
      <symbol id="tz-neon-serpiente" viewBox="0 0 140 30">
        <path
          className="tz-neon-snake-body"
          d="M6,15 C20,3 34,27 48,15 C62,3 76,27 90,15 C100,7 108,9 116,14"
          fill="none"
          strokeLinecap="round"
        />
        <circle className="tz-neon-snake-head" cx="119" cy="14" r="4.2" />
      </symbol>
      {/* Hoja chica de la punta de cada enredadera — bug reportado dos
         veces: 1) la reusaba de #tz-neon-hoja (relleno oscuro + solo
         contorno verde, pensada para verse grande) en vez de tener
         relleno sólido propio, y 2) el punto de "enganche" con el
         tallo no era la PUNTA de la hoja sino un lugar cualquiera —
         acá la punta de arriba (y=2, prácticamente el borde superior
         del viewBox) es a propósito el punto donde el tallo debe
         terminar, para que la hoja cuelgue simétrica desde ahí, como
         una hoja de verdad. */}
      <symbol id="tz-neon-hoja-vid" viewBox="0 0 40 72">
        <path className="tz-neon-vine-leaf-shape" d="M20,2 C36,16 38,44 20,70 C2,44 4,16 20,2 Z" />
        <path className="tz-neon-vine-leaf-vein" d="M20,9 L20,62" />
      </symbol>
    </defs>
  );
}

// Animación Épica de Bienvenida — Selva Neón. Se monta SIEMPRE que el
// padre la renderice (no decide por sí sola si "le toca" a este
// usuario — eso lo resuelve, del lado de afuera, uno de los DOS hooks
// de disparo: useBienvenidaNeon.js (bienvenida de cuenta nueva, una
// sola vez por usuario) o useMembresiaActivadaNeon.js (cada vez que se
// activa/cambia una membresía) — justamente para que este componente
// se pueda previsualizar o probar sin pelearse con localStorage, y para
// que sea 100% de presentación: no sabe nada de paquetes ni de
// bienvenidas, solo recibe "eyebrow"/"titulo"/"descripcion" y los
// muestra. Se desmonta solita: apenas termina su fade-out, "onTerminar"
// le avisa al padre que deje de renderizarla, sacándola del árbol de
// React de verdad — no queda ningún nodo oculto de fondo, ni el
// <style> de acá abajo, gastando recursos.
//
// Bug reportado: la primera versión solo tenía 3 hojas sueltas en las
// esquinas — en una pantalla ancha (desktop, o el celular apaisado) se
// veía "vacía" en el medio y en los bordes izquierdo/derecho. Rediseño
// completo del fondo con un criterio distinto: en vez de UN SOLO <svg>
// gigante con coordenadas fijas (que en pantallas muy anchas o muy
// angostas terminaba recortando o vaciando contenido, según
// preserveAspectRatio), cada elemento decorativo ahora es su PROPIO
// <svg> chico posicionado con CSS (%, vw/vh) — eso es lo que de verdad
// garantiza que se vea bien tanto en un celular angosto como en un
// monitor ancho, sin recortes ni huecos: la posición se calcula contra
// el viewport real de cada dispositivo, no contra una caja de
// coordenadas fija pensada para una sola proporción.
export default function AnimacionNeonBienvenida({
  // Bienvenida en 2 partes: este componente ahora es puramente de
  // presentación, sin ninguna noción de "paquete" — el CALLER decide
  // los 3 textos según cuál de las 2 configuraciones esté disparando
  // (ver useBienvenidaNeon.js/useMembresiaActivadaNeon.js y su
  // orquestación en ConductorPage.jsx/HomePage.jsx).
  eyebrow = "✦ Bienvenido ✦",
  titulo,
  descripcion,
  onTerminar,
}) {
  const [presente, setPresente] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setPresente(false), MS_VISIBLE);
    return () => clearTimeout(t);
  }, []);

  // Ocupa toda la pantalla a propósito (z-index altísimo) — mientras
  // tanto, el scroll de fondo se congela para que no se pueda "espiar"
  // el resto de la página arrastrando por detrás. Se restaura pase lo
  // que pase (fin normal, salto manual, o el padre desmontando esto
  // antes de tiempo por cualquier otro motivo).
  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, []);

  const saltar = () => setPresente(false);

  return (
    <AnimatePresence onExitComplete={onTerminar}>
      {presente && (
        <motion.div
          className="tz-neon-bienvenida-overlay"
          variants={variantesOverlay}
          initial="initial"
          animate="animate"
          exit="exit"
          // Pedido: "el usuario puede omitir la animación presionando
          // la pantalla" — toda la superposición es tocable, no solo el
          // botón "Saltar" (que queda igual, de paso, como pista visual
          // de que se puede saltar). Dispara la MISMA función "saltar"
          // que el botón: al ser un simple setPresente(false), el
          // fade-out ya definido en variantesOverlay.exit se encarga
          // solo de que el cierre sea suave, nunca un corte brusco.
          onClick={saltar}
          role="dialog"
          aria-label="Bienvenida"
        >
          {/* ---- Fondo: manchas de luz + líneas neón fluidas ---- */}
          <div className="tz-neon-blob tz-neon-blob-a" />
          <div className="tz-neon-blob tz-neon-blob-b" />
          <div className="tz-neon-blob tz-neon-blob-c" />

          {/* Líneas — viewBox en % (0-100) + preserveAspectRatio="none":
             se ESTIRAN para llenar el viewport exacto de cada pantalla,
             angosta o ancha, en vez de recortarse en los bordes. Son
             trazos orgánicos sueltos, estirarlos un poco no se nota. */}
          <svg className="tz-neon-svg-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className="tz-neon-line tz-neon-line-cyan" d="M-5,75 C20,55 45,85 70,60 C90,42 105,65 115,50" vectorEffect="non-scaling-stroke" />
            <path className="tz-neon-line tz-neon-line-pink" d="M105,10 C80,28 68,5 45,20 C28,30 12,15 -5,25" vectorEffect="non-scaling-stroke" />
            <path className="tz-neon-line tz-neon-line-green" d="M-5,42 C25,48 50,35 65,44 C82,54 95,42 105,45" vectorEffect="non-scaling-stroke" />
          </svg>

          {/* ---- Copa de árboles colgando del borde superior ----
             Bug reportado: en un monitor ancho (desktop) las hojitas de
             la punta se veían estiradas y con el glow cortado en un
             rectángulo. Causa real: el "lienzo" de la copa entera usa
             preserveAspectRatio="none" para poder estirar el TALLO de
             punta a punta en cualquier ancho de pantalla (un tallo
             finito estirado no se nota, es solo una línea) — pero antes
             la HOJA de la punta vivía adentro de ese mismo lienzo
             estirado, así que se deformaba junto con todo lo demás: en
             un celular (donde el estiramiento horizontal y vertical son
             parecidos) casi no se notaba, pero en un monitor ancho
             (mucho más estiramiento horizontal que vertical) la hoja
             quedaba achatada. Además, al ser tan chica, el glow
             (drop-shadow) se salía de la "región de filtro" por
             default de un elemento tan pequeño y se veía recortado en
             un rectángulo. Solución: el tallo se queda en el lienzo
             estirado (una línea no tiene una proporción "correcta" que
             perder), pero la hoja ahora es su PROPIO <svg> chico con su
             proporción real (igual que las hojas grandes de más abajo,
             que nunca tuvieron este problema), posicionado con CSS
             encima de la punta de cada tallo. */}
          <svg className="tz-neon-canopy" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">
            <g className="tz-neon-vine-enter" style={{ animationDelay: "0.3s" }}>
              <path className="tz-neon-vine" d="M6,0 C4,9 9,16 6,26" vectorEffect="non-scaling-stroke" />
            </g>
            <g className="tz-neon-vine-enter" style={{ animationDelay: "0.55s" }}>
              <path className="tz-neon-vine" d="M22,0 C25,8 19,15 23,24" vectorEffect="non-scaling-stroke" />
            </g>
            <g className="tz-neon-vine-enter" style={{ animationDelay: "0.4s" }}>
              <path className="tz-neon-vine" d="M50,0 C48,10 53,17 50,26" vectorEffect="non-scaling-stroke" />
            </g>
            <g className="tz-neon-vine-enter" style={{ animationDelay: "0.7s" }}>
              <path className="tz-neon-vine" d="M74,0 C77,9 71,14 75,22" vectorEffect="non-scaling-stroke" />
            </g>
            <g className="tz-neon-vine-enter" style={{ animationDelay: "0.5s" }}>
              <path className="tz-neon-vine" d="M92,0 C90,10 95,17 92,26" vectorEffect="non-scaling-stroke" />
            </g>
          </svg>

          {/* Hojas de la punta de cada enredadera — <svg> propio, viewBox
             sin estirar (proporción real), posicionado con left/top en
             CSS (ver .tz-neon-vine-leaf-tip-N) para que la PUNTA de
             arriba de la hoja (y=2 en el símbolo, ver #tz-neon-hoja-vid)
             quede justo donde termina el tallo. El balanceo usa su
             propia clase (.tz-neon-vine-leaf-sway, origen arriba) en vez
             de .tz-neon-leaf-sway (origen abajo, pensada para una hoja
             parada, no colgando) — si colgara desde arriba pero
             pivotara desde abajo, se vería mal, como un péndulo al
             revés. */}
          <svg className="tz-neon-vine-leaf-tip tz-neon-vine-leaf-tip-1" style={{ animationDelay: "0.5s" }} viewBox="0 0 40 72" aria-hidden="true">
            <g className="tz-neon-vine-leaf-sway">
              <use href="#tz-neon-hoja-vid" />
            </g>
          </svg>
          <svg className="tz-neon-vine-leaf-tip tz-neon-vine-leaf-tip-2" style={{ animationDelay: "0.75s" }} viewBox="0 0 40 72" aria-hidden="true">
            <g className="tz-neon-vine-leaf-sway tz-neon-vine-leaf-sway-b">
              <use href="#tz-neon-hoja-vid" />
            </g>
          </svg>
          <svg className="tz-neon-vine-leaf-tip tz-neon-vine-leaf-tip-3" style={{ animationDelay: "0.6s" }} viewBox="0 0 40 72" aria-hidden="true">
            <g className="tz-neon-vine-leaf-sway">
              <use href="#tz-neon-hoja-vid" />
            </g>
          </svg>
          <svg className="tz-neon-vine-leaf-tip tz-neon-vine-leaf-tip-4" style={{ animationDelay: "0.9s" }} viewBox="0 0 40 72" aria-hidden="true">
            <g className="tz-neon-vine-leaf-sway tz-neon-vine-leaf-sway-b">
              <use href="#tz-neon-hoja-vid" />
            </g>
          </svg>
          <svg className="tz-neon-vine-leaf-tip tz-neon-vine-leaf-tip-5" style={{ animationDelay: "0.7s" }} viewBox="0 0 40 72" aria-hidden="true">
            <g className="tz-neon-vine-leaf-sway">
              <use href="#tz-neon-hoja-vid" />
            </g>
          </svg>

          {/* ---- Maleza a lo largo de TODO el borde inferior — estirada
             de punta a punta (preserveAspectRatio="none"), así nunca
             deja un tramo pelado sin importar cuán ancha sea la
             pantalla. ---- */}
          <svg className="tz-neon-ground" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true">
            <path
              className="tz-neon-ground-shape"
              d="M0,20 L0,15 Q3,9 6,13 Q9,6 12,12 Q15,8 18,14 Q21,5 24,11 Q27,9 30,15 Q33,7 36,12 Q39,10 42,14 Q45,4 48,10 Q51,9 54,15 Q57,7 60,12 Q63,10 66,14 Q69,5 72,11 Q75,9 78,15 Q81,6 84,12 Q87,9 90,14 Q93,7 96,13 Q99,9 100,15 L100,20 Z"
            />
          </svg>

          <svg className="tz-neon-svg-defs" aria-hidden="true">
            <DefsCompartidos />
          </svg>

          {/* Hojas grandes en primer plano, repartidas por TODO el
             borde inferior (no solo las esquinas) — cada una es su
             propio <svg>, posicionado con CSS, así mantiene su
             proporción real sin importar el ancho de pantalla. */}
          <svg className="tz-neon-leaf tz-neon-leaf-1" style={{ animationDelay: "0.5s" }} viewBox="0 0 120 160" aria-hidden="true">
            <g className="tz-neon-leaf-sway">
              <use href="#tz-neon-hoja" />
            </g>
          </svg>
          <svg className="tz-neon-leaf tz-neon-leaf-2" style={{ animationDelay: "0.75s" }} viewBox="0 0 120 160" aria-hidden="true">
            <g className="tz-neon-leaf-sway tz-neon-leaf-sway-b">
              <use href="#tz-neon-hoja" />
            </g>
          </svg>
          <svg className="tz-neon-leaf tz-neon-leaf-3" style={{ animationDelay: "1s" }} viewBox="0 0 120 160" aria-hidden="true">
            <g className="tz-neon-leaf-sway">
              <use href="#tz-neon-hoja" />
            </g>
          </svg>
          <svg className="tz-neon-leaf tz-neon-leaf-4" style={{ animationDelay: "0.6s" }} viewBox="0 0 120 160" aria-hidden="true">
            <g className="tz-neon-leaf-sway tz-neon-leaf-sway-b">
              <use href="#tz-neon-hoja" />
            </g>
          </svg>
          {/* Hojas de marco a media altura en los bordes izquierdo y
             derecho — "los bordes repletos de plantas" pedido, no solo
             arriba/abajo. */}
          <svg className="tz-neon-leaf tz-neon-leaf-edge-l" style={{ animationDelay: "0.9s" }} viewBox="0 0 120 160" aria-hidden="true">
            <g className="tz-neon-leaf-sway">
              <use href="#tz-neon-hoja" />
            </g>
          </svg>
          <svg className="tz-neon-leaf tz-neon-leaf-edge-r" style={{ animationDelay: "1.1s" }} viewBox="0 0 120 160" aria-hidden="true">
            <g className="tz-neon-leaf-sway tz-neon-leaf-sway-b">
              <use href="#tz-neon-hoja" />
            </g>
          </svg>

          {/* Criaturas caminando — cruzan la pantalla sobre la maleza.
             Bug reportado: pidió "animales animados caminando", no
             solo una silueta quieta. Delays repartidos en toda la
             ventana de 10s (antes solo entraban en los primeros 2s y
             se quedaba vacío el resto del tiempo). */}
          <div className="tz-neon-walker tz-neon-walker-1" style={{ animationDelay: "0.5s" }}>
            <svg viewBox="0 0 120 62" aria-hidden="true">
              <use href="#tz-neon-criatura" />
            </svg>
          </div>
          <div className="tz-neon-walker tz-neon-walker-2" style={{ animationDelay: "2.4s" }}>
            <svg viewBox="0 0 120 62" aria-hidden="true">
              <use href="#tz-neon-criatura" />
            </svg>
          </div>
          <div className="tz-neon-walker tz-neon-walker-3" style={{ animationDelay: "5.2s" }}>
            <svg viewBox="0 0 120 62" aria-hidden="true">
              <use href="#tz-neon-criatura" />
            </svg>
          </div>

          {/* Serpientes arrastrándose — pedido nuevo. Cruzan cerca de
             la maleza, con un rotate() que se mece de lado a lado para
             simular el arrastre (ver .tz-neon-snake-* / el símbolo
             #tz-neon-serpiente arriba). */}
          <div className="tz-neon-snake tz-neon-snake-1" style={{ animationDelay: "0.8s" }}>
            <svg viewBox="0 0 140 30" aria-hidden="true">
              <use href="#tz-neon-serpiente" />
            </svg>
          </div>
          <div className="tz-neon-snake tz-neon-snake-2" style={{ animationDelay: "4s" }}>
            <svg viewBox="0 0 140 30" aria-hidden="true">
              <use href="#tz-neon-serpiente" />
            </svg>
          </div>
          <div className="tz-neon-snake tz-neon-snake-3" style={{ animationDelay: "6.8s" }}>
            <svg viewBox="0 0 140 30" aria-hidden="true">
              <use href="#tz-neon-serpiente" />
            </svg>
          </div>

          {/* Aves cruzando el cielo — pedido: "más aves". Subido de 2 a
             4, repartidas en toda la ventana de 10s. */}
          <svg className="tz-neon-bird tz-neon-bird-1" style={{ animationDelay: "0.9s" }} viewBox="0 0 100 40" aria-hidden="true">
            <path
              className="tz-neon-bird-shape"
              d="M0,25 C15,5 35,5 50,20 C65,5 85,5 100,25 C85,18 68,15 50,28 C32,15 15,18 0,25 Z"
            />
          </svg>
          <svg className="tz-neon-bird tz-neon-bird-2" style={{ animationDelay: "2.2s" }} viewBox="0 0 100 40" aria-hidden="true">
            <path
              className="tz-neon-bird-shape tz-neon-bird-shape-pink"
              d="M0,25 C15,5 35,5 50,20 C65,5 85,5 100,25 C85,18 68,15 50,28 C32,15 15,18 0,25 Z"
            />
          </svg>
          <svg className="tz-neon-bird tz-neon-bird-3" style={{ animationDelay: "4.4s" }} viewBox="0 0 100 40" aria-hidden="true">
            <path
              className="tz-neon-bird-shape tz-neon-bird-shape-green"
              d="M0,25 C15,5 35,5 50,20 C65,5 85,5 100,25 C85,18 68,15 50,28 C32,15 15,18 0,25 Z"
            />
          </svg>
          <svg className="tz-neon-bird tz-neon-bird-4" style={{ animationDelay: "6.6s" }} viewBox="0 0 100 40" aria-hidden="true">
            <path
              className="tz-neon-bird-shape tz-neon-bird-shape-purple"
              d="M0,25 C15,5 35,5 50,20 C65,5 85,5 100,25 C85,18 68,15 50,28 C32,15 15,18 0,25 Z"
            />
          </svg>

          {/* ---- Contenido central ---- */}
          <div className="tz-neon-content">
            <p className="tz-neon-eyebrow">{eyebrow}</p>
            <h1 className="tz-neon-title">{titulo}</h1>
            {descripcion && <p className="tz-neon-desc">{descripcion}</p>}
          </div>

          <button type="button" className="tz-neon-skip-btn" onClick={saltar}>
            Saltar ▸
          </button>

          <style>{`
            .tz-neon-bienvenida-overlay {
              --tz-neon-cyan: #2be8ff;
              --tz-neon-pink: #ff2f9e;
              --tz-neon-green: #4dffa0;
              --tz-neon-purple: #b98bff;
              position: fixed;
              inset: 0;
              z-index: 999999;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
              cursor: pointer;
              background:
                radial-gradient(circle at 50% 42%, rgba(15,40,32,0.9) 0%, rgba(4,10,9,0.97) 55%, #000 100%);
            }

            .tz-neon-blob {
              position: absolute;
              border-radius: 50%;
              filter: blur(70px);
              opacity: 0.5;
              pointer-events: none;
            }
            .tz-neon-blob-a {
              width: 46vmax;
              height: 46vmax;
              left: -12vmax;
              top: -10vmax;
              background: radial-gradient(circle, var(--tz-neon-cyan), transparent 70%);
              animation: tz-neon-blob-drift-a 9s ease-in-out infinite;
            }
            .tz-neon-blob-b {
              width: 40vmax;
              height: 40vmax;
              right: -10vmax;
              bottom: -12vmax;
              background: radial-gradient(circle, var(--tz-neon-pink), transparent 70%);
              animation: tz-neon-blob-drift-b 11s ease-in-out infinite;
            }
            .tz-neon-blob-c {
              width: 30vmax;
              height: 30vmax;
              right: 8vmax;
              top: -6vmax;
              background: radial-gradient(circle, var(--tz-neon-purple), transparent 70%);
              animation: tz-neon-blob-drift-a 13s ease-in-out infinite reverse;
            }
            @keyframes tz-neon-blob-drift-a {
              0%, 100% { transform: translate(0, 0) scale(1); }
              50% { transform: translate(3vmax, 4vmax) scale(1.08); }
            }
            @keyframes tz-neon-blob-drift-b {
              0%, 100% { transform: translate(0, 0) scale(1); }
              50% { transform: translate(-4vmax, -3vmax) scale(1.1); }
            }

            .tz-neon-svg-layer {
              position: absolute;
              inset: 0;
              width: 100%;
              height: 100%;
              pointer-events: none;
            }
            .tz-neon-svg-defs {
              position: absolute;
              width: 0;
              height: 0;
              overflow: hidden;
            }

            /* Líneas fluidas: el "trazo que corre" es stroke-dasharray
               largo + stroke-dashoffset animado — técnica clásica de
               "flujo de luz" en SVG, nada de JS. El viewBox va de 0 a
               100 (para poder pensarlo en %), pero gracias a
               vector-effect="non-scaling-stroke" (puesto en el propio
               <path>) el stroke-width de acá se interpreta en píxeles
               de pantalla CONSTANTES, no en unidades del viewBox — sin
               esto el mismo "0.6" se veía en un celular angosto pero
               desaparecía casi del todo en un monitor ancho (o al
               revés, gigante, según el caso), porque sin
               non-scaling-stroke el navegador escala el grosor junto
               con el resto de la figura. */
            .tz-neon-line {
              fill: none;
              stroke-width: 2;
              stroke-linecap: round;
              stroke-dasharray: 18 55;
              opacity: 0.75;
            }
            .tz-neon-line-cyan {
              stroke: var(--tz-neon-cyan);
              filter: drop-shadow(0 0 6px var(--tz-neon-cyan)) drop-shadow(0 0 16px var(--tz-neon-cyan));
              animation: tz-neon-line-flow 4.5s linear infinite;
            }
            .tz-neon-line-pink {
              stroke: var(--tz-neon-pink);
              filter: drop-shadow(0 0 6px var(--tz-neon-pink)) drop-shadow(0 0 16px var(--tz-neon-pink));
              animation: tz-neon-line-flow 5.5s linear infinite reverse;
            }
            .tz-neon-line-green {
              stroke: var(--tz-neon-green);
              filter: drop-shadow(0 0 6px var(--tz-neon-green)) drop-shadow(0 0 14px var(--tz-neon-green));
              animation: tz-neon-line-flow 6.5s linear infinite;
            }
            @keyframes tz-neon-line-flow {
              to { stroke-dashoffset: -73; }
            }

            /* Copa/enredaderas colgando del borde superior */
            .tz-neon-canopy {
              position: absolute;
              top: 0;
              left: 0;
              width: 100%;
              height: 14vh;
              max-height: 130px;
              pointer-events: none;
              opacity: 0.9;
              /* La hoja de la punta ya NO vive acá adentro (ver el
                 comentario largo en el JSX) — esto queda como margen de
                 seguridad nomás, por si algún tallo llegara a pasarse
                 un pelo del borde inferior del viewBox. */
              overflow: visible;
            }
            .tz-neon-vine-enter {
              opacity: 0;
              animation: tz-neon-vine-in 1.1s cubic-bezier(0.16, 1, 0.3, 1) both;
            }
            @keyframes tz-neon-vine-in {
              0% { opacity: 0; transform: translateY(-12px); }
              100% { opacity: 1; transform: translateY(0); }
            }
            .tz-neon-vine {
              fill: none;
              stroke: var(--tz-neon-green);
              stroke-width: 1.6;
              opacity: 0.8;
              filter: drop-shadow(0 0 4px var(--tz-neon-green));
            }

            /* Maleza del borde inferior */
            .tz-neon-ground {
              position: absolute;
              bottom: 0;
              left: 0;
              width: 100%;
              height: 16vh;
              max-height: 150px;
              pointer-events: none;
            }
            .tz-neon-ground-shape {
              fill: rgba(8,26,18,0.92);
              stroke: var(--tz-neon-green);
              /* Mismo motivo que .tz-neon-line: con non-scaling-stroke
                 este número ya es "píxeles de pantalla", no unidades
                 del viewBox 0-100. */
              stroke-width: 1.5;
              vector-effect: non-scaling-stroke;
              filter: drop-shadow(0 0 6px rgba(77,255,160,0.55));
            }

            /* Hojas grandes de primer plano (esquinas + bordes medios) —
               cada una es su propio <svg>, width en vmin para escalar
               proporcional tanto en celular como en desktop. */
            .tz-neon-leaf {
              position: absolute;
              width: 15vmin;
              min-width: 70px;
              max-width: 150px;
              opacity: 0;
              pointer-events: none;
              animation: tz-neon-leaf-in 1.1s cubic-bezier(0.16, 1, 0.3, 1) both;
            }
            @keyframes tz-neon-leaf-in {
              0% { opacity: 0; transform: translateY(30px) scale(0.8); }
              100% { opacity: 1; transform: translateY(0) scale(1); }
            }
            .tz-neon-leaf-1 { left: -3vmin; bottom: 6vh; transform-origin: bottom left; }
            .tz-neon-leaf-2 { right: -3vmin; bottom: 8vh; transform: rotate(18deg) scaleX(-1); transform-origin: bottom right; }
            .tz-neon-leaf-3 { left: 16vmin; bottom: -1vh; transform: scale(0.75) rotate(-10deg); }
            .tz-neon-leaf-4 { right: 18vmin; bottom: 0vh; transform: scale(0.65) rotate(14deg) scaleX(-1); }
            .tz-neon-leaf-edge-l { left: -4vmin; top: 38%; transform: scale(0.6) rotate(-90deg); opacity: 0; }
            .tz-neon-leaf-edge-r { right: -4vmin; top: 30%; transform: scale(0.55) rotate(90deg) scaleX(-1); opacity: 0; }

            /* Hojas de la punta de cada enredadera — chicas, con su
               propia proporción (nada de preserveAspectRatio="none"
               acá), ENGANCHADAS de la punta de arriba de la hoja
               (y=2 del símbolo #tz-neon-hoja-vid, prácticamente el
               borde superior de su viewBox) al final exacto de cada
               tallo — bug reportado: antes centraba la hoja ENTERA
               sobre la punta del tallo (translateY(-55%)), así que el
               tallo terminaba clavado en el medio de la hoja en vez de
               conectar con su punta, nada simétrico. Con
               translateY(0) el borde SUPERIOR del <svg> (que es
               básicamente la punta de la hoja) queda exacto donde lo
               puso la propiedad "top" — sin necesidad de correr nada
               más. Esa misma propiedad usa min(14vh,130px) porque es
               EXACTAMENTE el mismo cálculo de alto que ya usa
               .tz-neon-canopy. */
            .tz-neon-vine-leaf-tip {
              position: absolute;
              width: 4.4vmin;
              min-width: 20px;
              max-width: 34px;
              opacity: 0;
              pointer-events: none;
              animation: tz-neon-vine-leaf-tip-in 1.1s cubic-bezier(0.16, 1, 0.3, 1) both;
            }
            @keyframes tz-neon-vine-leaf-tip-in {
              0% { opacity: 0; transform: translateX(-50%) translateY(-4px) scale(0.7); }
              100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
            }
            .tz-neon-vine-leaf-tip-1 { left: 6%; top: min(14vh, 130px); }
            .tz-neon-vine-leaf-tip-2 { left: 22%; top: calc(min(14vh, 130px) * 0.92); }
            .tz-neon-vine-leaf-tip-3 { left: 50%; top: min(14vh, 130px); }
            .tz-neon-vine-leaf-tip-4 { left: 75%; top: calc(min(14vh, 130px) * 0.85); }
            .tz-neon-vine-leaf-tip-5 { left: 92%; top: min(14vh, 130px); }

            /* Relleno sólido a propósito (bug reportado: "las
               anteriores estaban mejor porque tenían relleno") — a
               diferencia de #tz-neon-hoja (relleno oscuro + solo
               contorno, pensada para las hojas grandes donde se nota
               el detalle de las venas), a este tamaño tan chico un
               relleno oscuro se perdía contra el fondo — el verde
               sólido + glow se ve de lejos como una hojita de verdad. */
            .tz-neon-vine-leaf-shape {
              fill: var(--tz-neon-green);
              filter: drop-shadow(0 0 6px var(--tz-neon-green));
            }
            .tz-neon-vine-leaf-vein {
              stroke: rgba(4,20,12,0.55);
              stroke-width: 1.6;
              fill: none;
            }
            /* Origen del balanceo ARRIBA (no 50% 100% como
               .tz-neon-leaf-sway) — esta hoja CUELGA de la punta de
               arriba, tiene que mecerse como un péndulo desde ahí, no
               desde abajo. */
            .tz-neon-vine-leaf-sway {
              transform-origin: 50% 6%;
              animation: tz-neon-leaf-sway-move 4.2s ease-in-out infinite;
            }
            .tz-neon-vine-leaf-sway-b {
              animation-duration: 4.8s;
              animation-direction: reverse;
            }

            .tz-neon-leaf-sway {
              transform-origin: 50% 100%;
              animation: tz-neon-leaf-sway-move 4.5s ease-in-out infinite;
            }
            .tz-neon-leaf-sway-b {
              animation-duration: 5.2s;
              animation-direction: reverse;
            }
            @keyframes tz-neon-leaf-sway-move {
              0%, 100% { transform: rotate(-3deg); }
              50% { transform: rotate(3deg); }
            }
            .tz-neon-leaf-shape {
              fill: rgba(10,30,20,0.85);
              stroke: var(--tz-neon-green);
              stroke-width: 2;
              filter: drop-shadow(0 0 8px var(--tz-neon-green));
            }
            .tz-neon-leaf-vein {
              fill: none;
              stroke: var(--tz-neon-green);
              stroke-width: 1;
              opacity: 0.65;
            }

            /* Criaturas caminando — cruzan usando % (no px), así la
               distancia recorrida se adapta sola al ancho real de la
               pantalla en vez de quedar corta o pasarse en un celular. */
            .tz-neon-walker {
              position: absolute;
              width: 13vmin;
              min-width: 60px;
              max-width: 130px;
              opacity: 0;
              pointer-events: none;
              animation: tz-neon-walker-cross-1 4.6s linear both;
            }
            .tz-neon-walker-1 { bottom: 7vh; }
            .tz-neon-walker-2 {
              bottom: 3.5vh;
              width: 9vmin;
              min-width: 42px;
              max-width: 95px;
              opacity: 0;
              animation-name: tz-neon-walker-cross-2;
              animation-duration: 5.2s;
              filter: brightness(0.8);
            }
            .tz-neon-walker-3 {
              bottom: 9.5vh;
              width: 11vmin;
              min-width: 50px;
              max-width: 110px;
              opacity: 0;
              animation-name: tz-neon-walker-cross-1;
              animation-duration: 4.8s;
              filter: hue-rotate(60deg) brightness(1.1);
            }
            @keyframes tz-neon-walker-cross-1 {
              0% { left: -16vmin; opacity: 0; }
              8% { opacity: 0.95; }
              92% { opacity: 0.95; }
              100% { left: 78vw; opacity: 0; }
            }
            @keyframes tz-neon-walker-cross-2 {
              0% { right: -14vmin; opacity: 0; transform: scaleX(-1); }
              8% { opacity: 0.85; }
              92% { opacity: 0.85; }
              100% { right: 70vw; opacity: 0; transform: scaleX(-1); }
            }

            /* Serpientes arrastrándose — pedido nuevo. bottom/rotate
               animados EN EL MISMO keyframe que el cruce horizontal
               (no solo left/right) para que el recorrido no sea una
               línea perfectamente recta — lo más cerca de "aleatorio"
               que da hacerlo con CSS puro sin JS de por medio. */
            .tz-neon-snake {
              position: absolute;
              width: 15vmin;
              min-width: 68px;
              max-width: 150px;
              opacity: 0;
              pointer-events: none;
            }
            .tz-neon-snake-1 { bottom: 1vh; animation: tz-neon-snake-cross-1 6.5s ease-in-out both; }
            .tz-neon-snake-2 {
              bottom: 5vh;
              width: 11vmin;
              min-width: 52px;
              max-width: 110px;
              animation: tz-neon-snake-cross-2 7.2s ease-in-out both;
              filter: hue-rotate(50deg);
            }
            .tz-neon-snake-3 {
              bottom: 2.5vh;
              width: 13vmin;
              min-width: 60px;
              max-width: 130px;
              animation: tz-neon-snake-cross-1 6.8s ease-in-out both;
              filter: hue-rotate(-40deg) brightness(1.05);
            }
            @keyframes tz-neon-snake-cross-1 {
              0% { left: -18vmin; opacity: 0; transform: rotate(-4deg); }
              10% { opacity: 0.9; }
              30% { transform: rotate(6deg); }
              50% { transform: rotate(-6deg); bottom: 3vh; }
              70% { transform: rotate(5deg); }
              90% { opacity: 0.9; }
              100% { left: 88vw; opacity: 0; transform: rotate(-3deg); }
            }
            @keyframes tz-neon-snake-cross-2 {
              0% { right: -16vmin; opacity: 0; transform: scaleX(-1) rotate(4deg); }
              10% { opacity: 0.85; }
              35% { transform: scaleX(-1) rotate(-6deg); }
              55% { transform: scaleX(-1) rotate(6deg); bottom: 7.5vh; }
              80% { transform: scaleX(-1) rotate(-5deg); }
              90% { opacity: 0.85; }
              100% { right: 82vw; opacity: 0; transform: scaleX(-1) rotate(4deg); }
            }
            .tz-neon-snake-body {
              fill: none;
              stroke: var(--tz-neon-cyan);
              stroke-width: 5;
              filter: drop-shadow(0 0 6px var(--tz-neon-cyan));
            }
            .tz-neon-snake-head {
              fill: var(--tz-neon-cyan);
              filter: drop-shadow(0 0 6px var(--tz-neon-cyan));
            }
            .tz-neon-walker-shape {
              fill: rgba(20,10,26,0.88);
              stroke: var(--tz-neon-purple);
              stroke-width: 2;
              filter: drop-shadow(0 0 7px var(--tz-neon-purple));
            }
            .tz-neon-walker-tail {
              stroke: var(--tz-neon-purple);
              stroke-width: 4;
              filter: drop-shadow(0 0 5px var(--tz-neon-purple));
            }
            .tz-neon-walker-leg {
              stroke: var(--tz-neon-purple);
              stroke-width: 6;
              stroke-linecap: round;
              filter: drop-shadow(0 0 4px var(--tz-neon-purple));
            }
            /* Patas A/B alternándose arriba/abajo — no es un ciclo de
               caminata real cuadro por cuadro, pero combinado con el
               cruce horizontal y el balanceo de la cola se lee bien
               como "caminando" a la distancia en la que se ve esto. */
            .tz-neon-walker-legs-a { animation: tz-neon-walker-step-a 0.5s ease-in-out infinite; }
            .tz-neon-walker-legs-b { animation: tz-neon-walker-step-b 0.5s ease-in-out infinite; }
            @keyframes tz-neon-walker-step-a {
              0%, 100% { transform: translateY(-2.5px); }
              50% { transform: translateY(2.5px); }
            }
            @keyframes tz-neon-walker-step-b {
              0%, 100% { transform: translateY(2.5px); }
              50% { transform: translateY(-2.5px); }
            }

            /* Aves cruzando el cielo — % en vez de px por el mismo
               motivo que las criaturas de abajo. */
            .tz-neon-bird {
              position: absolute;
              width: 9vmin;
              min-width: 34px;
              max-width: 70px;
              opacity: 0;
              pointer-events: none;
            }
            .tz-neon-bird-1 { top: 10%; animation: tz-neon-bird-cross-1 4.4s ease-in-out both; }
            .tz-neon-bird-2 { top: 20%; animation: tz-neon-bird-cross-2 4.9s ease-in-out both; }
            .tz-neon-bird-3 { top: 16%; animation: tz-neon-bird-cross-1 4.7s ease-in-out both; }
            .tz-neon-bird-4 { top: 27%; animation: tz-neon-bird-cross-2 5.1s ease-in-out both; }
            @keyframes tz-neon-bird-cross-1 {
              0% { left: -12vw; opacity: 0; transform: scale(0.7); }
              12% { opacity: 1; }
              88% { opacity: 1; }
              100% { left: 108vw; opacity: 0; transform: scale(1.1); }
            }
            @keyframes tz-neon-bird-cross-2 {
              0% { right: -12vw; opacity: 0; transform: scale(0.6) scaleX(-1); }
              12% { opacity: 0.9; }
              88% { opacity: 0.9; }
              100% { right: 108vw; opacity: 0; transform: scale(0.95) scaleX(-1); }
            }
            .tz-neon-bird-shape {
              fill: var(--tz-neon-cyan);
              filter: drop-shadow(0 0 10px var(--tz-neon-cyan));
              animation: tz-neon-bird-flap 0.5s ease-in-out infinite alternate;
              transform-origin: 50px 15px;
            }
            .tz-neon-bird-shape-green {
              fill: var(--tz-neon-green);
              filter: drop-shadow(0 0 10px var(--tz-neon-green));
            }
            .tz-neon-bird-shape-purple {
              fill: var(--tz-neon-purple);
              filter: drop-shadow(0 0 10px var(--tz-neon-purple));
            }
            .tz-neon-bird-shape-pink {
              fill: var(--tz-neon-pink);
              filter: drop-shadow(0 0 10px var(--tz-neon-pink));
            }
            @keyframes tz-neon-bird-flap {
              0% { transform: scaleY(1); }
              100% { transform: scaleY(0.6); }
            }

            /* Contenido central — fondo propio (vignette) para que el
               texto siga legible con una escena de fondo más ocupada. */
            .tz-neon-content {
              position: relative;
              z-index: 2;
              display: flex;
              flex-direction: column;
              align-items: center;
              text-align: center;
              padding: 28px 28px 32px;
              max-width: 880px;
              border-radius: 28px;
              background: radial-gradient(ellipse at center, rgba(3,8,7,0.55) 0%, rgba(3,8,7,0.25) 60%, transparent 100%);
            }
            .tz-neon-eyebrow {
              margin: 0 0 10px;
              font-family: 'Rajdhani', sans-serif;
              font-weight: 700;
              letter-spacing: 0.35em;
              text-transform: uppercase;
              font-size: clamp(12px, 2.4vw, 15px);
              color: var(--tz-neon-green);
              text-shadow: 0 0 12px var(--tz-neon-green);
              opacity: 0;
              animation: tz-neon-text-in 0.8s ease-out 0.35s both;
            }
            .tz-neon-title {
              margin: 0 0 14px;
              font-family: 'Orbitron', sans-serif;
              font-weight: 900;
              line-height: 1.08;
              font-size: clamp(30px, 8vw, 66px);
              background: linear-gradient(90deg, var(--tz-neon-cyan), #eafcff 45%, var(--tz-neon-pink));
              -webkit-background-clip: text;
              background-clip: text;
              color: transparent;
              filter: drop-shadow(0 0 18px rgba(43,232,255,0.55)) drop-shadow(0 0 34px rgba(255,47,158,0.35));
              opacity: 0;
              animation: tz-neon-text-in 0.9s ease-out 0.55s both, tz-neon-title-pulse 2.6s ease-in-out 1.5s infinite;
            }
            .tz-neon-desc {
              margin: 0;
              font-family: 'Rajdhani', sans-serif;
              font-weight: 600;
              font-size: clamp(14px, 3vw, 19px);
              color: #dffcff;
              text-shadow: 0 0 14px rgba(43,232,255,0.4);
              opacity: 0;
              animation: tz-neon-text-in 0.8s ease-out 0.8s both;
            }
            @keyframes tz-neon-text-in {
              0% { opacity: 0; transform: translateY(16px); }
              100% { opacity: 1; transform: translateY(0); }
            }
            @keyframes tz-neon-title-pulse {
              0%, 100% { filter: drop-shadow(0 0 18px rgba(43,232,255,0.55)) drop-shadow(0 0 34px rgba(255,47,158,0.35)); }
              50% { filter: drop-shadow(0 0 30px rgba(43,232,255,0.8)) drop-shadow(0 0 54px rgba(255,47,158,0.55)); }
            }

            .tz-neon-skip-btn {
              position: absolute;
              right: max(16px, env(safe-area-inset-right));
              bottom: max(16px, env(safe-area-inset-bottom));
              z-index: 3;
              padding: 8px 16px;
              border-radius: 999px;
              border: 1px solid rgba(255,255,255,0.25);
              background: rgba(0,0,0,0.35);
              color: rgba(255,255,255,0.75);
              font-family: 'Rajdhani', sans-serif;
              font-weight: 600;
              font-size: 13px;
              letter-spacing: 0.05em;
              cursor: pointer;
              opacity: 0;
              animation: tz-neon-text-in 0.6s ease-out 1.6s both;
            }
            .tz-neon-skip-btn:hover {
              border-color: var(--tz-neon-cyan);
              color: var(--tz-neon-cyan);
            }

            @media (prefers-reduced-motion: reduce) {
              .tz-neon-bienvenida-overlay * {
                animation-duration: 0.01ms !important;
                animation-iteration-count: 1 !important;
              }
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
