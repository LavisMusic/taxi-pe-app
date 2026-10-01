import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import SelvaAnimales, { SelvaAgua } from "./SelvaAnimales";

// Cuánto dura CADA fase — pedido explícito: "10 segundos de animación
// como tal". A los 9 s arranca el cierre "la selva se abre" (1 s) y al
// final un fundido corto: ~10 s de punta a punta. La secuencia de
// animales (SelvaAnimales.jsx) está repartida dentro de esos 9 s.
const MS_CIERRE = 9000;
const MS_DURACION_CIERRE = 1000;

// Dos capas:
//  * TELÓN: fondo oscuro que tapa la app casi al instante (0.15 s).
//    Antes la capa entera entraba con un fundido de 1 s y en ese
//    segundo se veía la app detrás (cabecera, botones = "cortes de
//    luz"). Las barras del iPhone se cubren aparte (ver el efecto de
//    "color de las barras" más abajo).
//  * ESCENA: todo lo de la selva entra JUNTO, como un conjunto (fundido
//    + leve zoom), sobre un telón que ya está puesto.
const variantesTelon = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.15, ease: "easeOut" } },
  // Solo fundido — el cierre "creativo" (la selva se abre) ya pasó
  // antes con la clase .tz-neon-cerrando. Nunca se achica la capa: eso
  // dejaba bordes vacíos con la app asomando detrás.
  exit: { opacity: 0, transition: { duration: 0.35, ease: "easeOut" } },
};
const variantesEscena = {
  initial: { opacity: 0, scale: 1.06 },
  animate: { opacity: 1, scale: 1, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
};

// ---- Capa "pro" sobre la Selva Neón (mismo lenguaje que
// AnimacionExitoNeon.jsx): un EMBLEMA central —aro que se dibuja +
// ícono selvático + corona de hojitas que brota alrededor—, textos que
// entran escalonados DESPUÉS del emblema, y oleadas de hojas y
// luciérnagas que estallan desde el centro en vez de serpentinas. La
// escena de fondo (lianas, hojas, criaturas, aves, maleza) se queda
// tal cual y se refuerza con hojas cayendo de la copa y luciérnagas
// flotando durante toda la animación.
const variantesAro = {
  initial: { scale: 0.3, opacity: 0, rotate: -20 },
  animate: {
    scale: 1,
    opacity: 1,
    rotate: 0,
    transition: { delay: 0.35, type: "spring", stiffness: 140, damping: 14 },
  },
};
const variantesTrazo = (delay) => ({
  initial: { pathLength: 0, opacity: 0 },
  animate: { pathLength: 1, opacity: 1, transition: { delay, duration: 0.7, ease: "easeInOut" } },
});
const variantesTexto = {
  initial: { opacity: 0, y: 18, filter: "blur(6px)" },
  animate: (i) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { delay: 1.45 + i * 0.16, duration: 0.65, ease: [0.16, 1, 0.3, 1] },
  }),
};

// Íconos del emblema (coordenadas del aro: viewBox 0-120, centro 60,60).
// Cada uno es una lista de trazos que se DIBUJAN (pathLength), no
// rellenos — mismo efecto que el check de la animación de entrega.
const ICONOS = {
  // Bienvenida: hoja de selva con nervaduras.
  hoja: [
    "M60 28 C82 38 90 62 76 84 C70 92 63 94 60 94 C57 94 50 92 44 84 C30 62 38 38 60 28 Z",
    "M60 36 L60 92 M60 54 L47 65 M60 54 L73 65 M60 71 L49 80 M60 71 L71 80",
  ],
  // Membresía activada: corona.
  corona: ["M34 80 L30 44 L47 59 L60 36 L73 59 L90 44 L86 80 Z", "M36 90 L84 90"],
  // Compra de créditos confirmada: rayo.
  rayo: ["M67 28 L41 64 L58 64 L51 94 L81 54 L63 54 Z"],
};

// Corona de hojitas alrededor del aro — brotan en cadena apenas el aro
// termina de dibujarse.
const HOJITAS_CORONA = Array.from({ length: 12 }, (_, i) => ({ id: i, angulo: (i / 12) * 360 + 15 }));

// Oleadas que estallan desde el emblema: hojas (giran y caen meciéndose)
// y luciérnagas (titilan y se apagan).
const COLORES_HOJA = ["#4dffa0", "#2be8ff", "#a6ff4d", "#3ddc84"];
function crearOleadaSelva(cantidad, delayBase) {
  return Array.from({ length: cantidad }, (_, i) => {
    const angulo = (i / cantidad) * Math.PI * 2 + Math.random() * 0.4;
    const distancia = 30 + Math.random() * 40;
    const esLuciernaga = i % 3 === 0;
    return {
      id: i,
      esLuciernaga,
      color: esLuciernaga ? "#eaff7a" : COLORES_HOJA[i % COLORES_HOJA.length],
      dx: Math.cos(angulo) * distancia,
      dy: Math.sin(angulo) * distancia - 8,
      caida: 18 + Math.random() * 22,
      rotate: Math.random() * 600 - 300,
      delay: delayBase + Math.random() * 0.2,
      duration: esLuciernaga ? 2.4 + Math.random() * 1.2 : 2 + Math.random() * 0.9,
      size: esLuciernaga ? 4 + Math.random() * 3 : 9 + Math.random() * 7,
    };
  });
}
const OLEADAS_SELVA = [crearOleadaSelva(18, 1.05), crearOleadaSelva(15, 1.45), crearOleadaSelva(12, 1.85)];

// Ambiente durante TODA la animación: hojas que se desprenden de la copa
// y luciérnagas flotando por la escena (CSS puro, posiciones al azar).
const HOJAS_CAYENDO = Array.from({ length: 9 }, (_, i) => ({
  id: i,
  left: 4 + Math.random() * 92,
  delay: 0.8 + i * 0.75 + Math.random() * 0.4,
  duration: 4.5 + Math.random() * 2,
  size: 12 + Math.random() * 10,
  color: COLORES_HOJA[i % COLORES_HOJA.length],
  deriva: (Math.random() - 0.5) * 22,
}));
const LUCIERNAGAS = Array.from({ length: 16 }, (_, i) => ({
  id: i,
  left: Math.random() * 100,
  top: 12 + Math.random() * 70,
  delay: Math.random() * 3,
  duration: 2.2 + Math.random() * 2.4,
  size: 3 + Math.random() * 3,
}));

function EmblemaSelva({ icono }) {
  const trazos = ICONOS[icono] || ICONOS.hoja;
  return (
    <motion.div className="tz-neon-emblema" variants={variantesAro} initial="initial" animate="animate">
      <div className="tz-neon-emblema-glow" />
      {OLEADAS_SELVA.map((oleada, oi) => (
        <div key={oi} className="tz-neon-burst">
          {oleada.map((p) => (
            <motion.span
              key={p.id}
              className={p.esLuciernaga ? "tz-neon-burst-luciernaga" : "tz-neon-burst-hoja"}
              style={{ background: p.color, color: p.color, width: p.size, height: p.esLuciernaga ? p.size : p.size * 1.4 }}
              initial={{ opacity: 0, x: 0, y: 0, rotate: 0, scale: 0.4 }}
              animate={
                p.esLuciernaga
                  ? { opacity: [0, 1, 0.35, 1, 0], x: `${p.dx}vmin`, y: [`0vmin`, `${p.dy}vmin`, `${p.dy - 6}vmin`], scale: 1 }
                  : {
                      opacity: [0, 1, 1, 0],
                      x: [`0vmin`, `${p.dx}vmin`, `${p.dx + 4}vmin`, `${p.dx - 3}vmin`],
                      y: [`0vmin`, `${p.dy}vmin`, `${p.dy + p.caida * 0.5}vmin`, `${p.dy + p.caida}vmin`],
                      rotate: p.rotate,
                      scale: 1,
                    }
              }
              transition={{
                delay: p.delay,
                duration: p.duration,
                ease: "easeOut",
                ...(p.esLuciernaga ? {} : { times: [0, 0.25, 0.65, 1] }),
              }}
            />
          ))}
        </div>
      ))}
      <svg className="tz-neon-emblema-svg" viewBox="-34 -34 188 188" aria-hidden="true">
        <defs>
          <linearGradient id="tz-neon-aro-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4dffa0" />
            <stop offset="50%" stopColor="#2be8ff" />
            <stop offset="100%" stopColor="#ff2f9e" />
          </linearGradient>
        </defs>
        {HOJITAS_CORONA.map((h, i) => (
          <g key={h.id} transform={`rotate(${h.angulo} 60 60)`}>
            <motion.path
              className={`tz-neon-corona-hoja ${i % 2 ? "tz-neon-corona-hoja-b" : ""}`}
              d="M60 -22 C69 -14 69 -4 60 4 C51 -4 51 -14 60 -22 Z"
              style={{ transformBox: "fill-box", transformOrigin: "50% 100%" }}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 1.05 + i * 0.045, type: "spring", stiffness: 260, damping: 13 }}
            />
          </g>
        ))}
        <circle className="tz-neon-aro-fondo" cx="60" cy="60" r="52" />
        <motion.circle
          className="tz-neon-aro-trazo"
          cx="60"
          cy="60"
          r="52"
          variants={variantesTrazo(0.5)}
          initial="initial"
          animate="animate"
        />
        {trazos.map((d, i) => (
          <motion.path
            key={i}
            className="tz-neon-emblema-icono"
            d={d}
            variants={variantesTrazo(0.85 + i * 0.25)}
            initial="initial"
            animate="animate"
          />
        ))}
      </svg>
    </motion.div>
  );
}

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
  // Ícono del emblema central: "hoja" (bienvenida), "corona"
  // (membresía activada) o "rayo" (compra de créditos).
  icono = "hoja",
  onTerminar,
}) {
  const [presente, setPresente] = useState(true);
  const [cerrando, setCerrando] = useState(false);
  const cerrandoRef = useRef(false);

  // Cierre "la selva se abre": las lianas suben, las hojas de los bordes
  // se abren hacia afuera, las luciérnagas se dispersan y la oscuridad
  // se disuelve en círculo desde el centro (máscara radial animada) —
  // recién después se desmonta con un fundido corto. Lo usan el timer Y
  // el botón/toque de "Saltar" (que así también cierra con estilo).
  const cerrar = useCallback(() => {
    if (cerrandoRef.current) return;
    cerrandoRef.current = true;
    setCerrando(true);
    setTimeout(() => setPresente(false), MS_DURACION_CIERRE);
  }, []);

  useEffect(() => {
    const t = setTimeout(cerrar, MS_CIERRE);
    return () => clearTimeout(t);
  }, [cerrar]);

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

  // Barras del iPhone (estado arriba, Safari abajo): Safari las pinta
  // con el color del elemento fijo que toca los bordes de la pantalla,
  // con el theme-color y con el fondo del documento. Mientras dura la
  // bienvenida se ponen los tres en el tono del telón, así las barras
  // se ven oscuras desde el primer instante; al terminar se restaura
  // todo como estaba.
  useEffect(() => {
    const COLOR = "#020605";
    const html = document.documentElement;
    const previoHtml = html.style.backgroundColor;
    const previoBody = document.body.style.backgroundColor;
    let meta = document.querySelector('meta[name="theme-color"]');
    const creada = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    const previoMeta = meta.getAttribute("content");
    html.style.backgroundColor = COLOR;
    document.body.style.backgroundColor = COLOR;
    meta.setAttribute("content", COLOR);
    return () => {
      html.style.backgroundColor = previoHtml;
      document.body.style.backgroundColor = previoBody;
      if (creada) meta.remove();
      else if (previoMeta == null) meta.removeAttribute("content");
      else meta.setAttribute("content", previoMeta);
    };
  }, []);

  const saltar = (e) => {
    e?.stopPropagation?.();
    cerrar();
  };

  return (
    // "never": la bienvenida se ve completa aunque el sistema tenga
    // "reducir movimiento"/"quitar animaciones" (pedido del dueño: en
    // Android/iOS con esa opción no se veía nada). Se puede omitir
    // igual con "Saltar" o tocando la pantalla.
    <MotionConfig reducedMotion="never">
    <AnimatePresence onExitComplete={onTerminar}>
      {presente && (
        <motion.div
          className={`tz-neon-telon ${cerrando ? "tz-neon-cerrando" : ""}`}
          variants={variantesTelon}
          initial="initial"
          animate="animate"
          exit="exit"
          // Pedido: "el usuario puede omitir la animación presionando
          // la pantalla" — toda la superposición es tocable, no solo el
          // botón "Saltar" (que queda igual, de paso, como pista visual
          // de que se puede saltar). Dispara la MISMA función "saltar"
          // que el botón: al ser un simple setPresente(false), el
          // fade-out ya definido en variantesTelon.exit se encarga
          // solo de que el cierre sea suave, nunca un corte brusco.
          onClick={saltar}
          role="dialog"
          aria-label="Bienvenida"
        >
        <motion.div className="tz-neon-bienvenida-overlay" variants={variantesEscena} initial="initial" animate="animate">
          {/* ---- Fondo: manchas de luz + líneas neón fluidas ---- */}
          <div className="tz-neon-blob tz-neon-blob-a" />
          <div className="tz-neon-blob tz-neon-blob-b" />
          <div className="tz-neon-blob tz-neon-blob-c" />
          {/* Rayos de luz entre los árboles — barren el fondo despacio. */}
          <div className="tz-neon-rayo tz-neon-rayo-1" />
          <div className="tz-neon-rayo tz-neon-rayo-2" />
          <div className="tz-neon-rayo tz-neon-rayo-3" />

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
            <g className="tz-neon-vine-enter" style={{ animationDelay: "0.1s" }}>
              <path className="tz-neon-vine" d="M6,0 C4,9 9,16 6,26" vectorEffect="non-scaling-stroke" />
            </g>
            <g className="tz-neon-vine-enter" style={{ animationDelay: "0.19s" }}>
              <path className="tz-neon-vine" d="M22,0 C25,8 19,15 23,24" vectorEffect="non-scaling-stroke" />
            </g>
            <g className="tz-neon-vine-enter" style={{ animationDelay: "0.14s" }}>
              <path className="tz-neon-vine" d="M50,0 C48,10 53,17 50,26" vectorEffect="non-scaling-stroke" />
            </g>
            <g className="tz-neon-vine-enter" style={{ animationDelay: "0.24s" }}>
              <path className="tz-neon-vine" d="M74,0 C77,9 71,14 75,22" vectorEffect="non-scaling-stroke" />
            </g>
            <g className="tz-neon-vine-enter" style={{ animationDelay: "0.17s" }}>
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
          <svg className="tz-neon-vine-leaf-tip tz-neon-vine-leaf-tip-1" style={{ animationDelay: "0.17s" }} viewBox="0 0 40 72" aria-hidden="true">
            <g className="tz-neon-vine-leaf-sway">
              <use href="#tz-neon-hoja-vid" />
            </g>
          </svg>
          <svg className="tz-neon-vine-leaf-tip tz-neon-vine-leaf-tip-2" style={{ animationDelay: "0.26s" }} viewBox="0 0 40 72" aria-hidden="true">
            <g className="tz-neon-vine-leaf-sway tz-neon-vine-leaf-sway-b">
              <use href="#tz-neon-hoja-vid" />
            </g>
          </svg>
          <svg className="tz-neon-vine-leaf-tip tz-neon-vine-leaf-tip-3" style={{ animationDelay: "0.21s" }} viewBox="0 0 40 72" aria-hidden="true">
            <g className="tz-neon-vine-leaf-sway">
              <use href="#tz-neon-hoja-vid" />
            </g>
          </svg>
          <svg className="tz-neon-vine-leaf-tip tz-neon-vine-leaf-tip-4" style={{ animationDelay: "0.31s" }} viewBox="0 0 40 72" aria-hidden="true">
            <g className="tz-neon-vine-leaf-sway tz-neon-vine-leaf-sway-b">
              <use href="#tz-neon-hoja-vid" />
            </g>
          </svg>
          <svg className="tz-neon-vine-leaf-tip tz-neon-vine-leaf-tip-5" style={{ animationDelay: "0.24s" }} viewBox="0 0 40 72" aria-hidden="true">
            <g className="tz-neon-vine-leaf-sway">
              <use href="#tz-neon-hoja-vid" />
            </g>
          </svg>

          {/* Refuerzo de la selva: hojas que se desprenden de la copa y
             luciérnagas flotando durante toda la animación. */}
          {HOJAS_CAYENDO.map((h) => (
            <span
              key={h.id}
              className="tz-neon-hoja-cae"
              aria-hidden="true"
              style={{
                left: `${h.left}%`,
                width: h.size,
                height: h.size * 1.4,
                background: h.color,
                color: h.color,
                animationDelay: `${h.delay}s`,
                animationDuration: `${h.duration}s`,
                "--tz-neon-deriva": `${h.deriva}vw`,
              }}
            />
          ))}
          {LUCIERNAGAS.map((l) => (
            <span
              key={l.id}
              className="tz-neon-luciernaga"
              aria-hidden="true"
              style={{
                left: `${l.left}%`,
                top: `${l.top}%`,
                width: l.size,
                height: l.size,
                animationDelay: `${l.delay}s, ${l.delay}s`,
                animationDuration: `${l.duration}s, ${l.duration * 2.5}s`,
                "--tz-neon-fuga-x": `${(l.left - 50) * 1.2}vw`,
                "--tz-neon-fuga-y": `${(l.top - 50) * 1.2}vh`,
              }}
            />
          ))}

          {/* Caimán y barbones detrás del río; el río detrás del suelo y
             de las hojas de abajo (ver SelvaAgua en SelvaAnimales.jsx). */}
          <SelvaAgua />

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
          <svg className="tz-neon-leaf tz-neon-leaf-1" style={{ animationDelay: "0.17s" }} viewBox="0 0 120 160" aria-hidden="true">
            <g className="tz-neon-leaf-sway">
              <use href="#tz-neon-hoja" />
            </g>
          </svg>
          <svg className="tz-neon-leaf tz-neon-leaf-2" style={{ animationDelay: "0.26s" }} viewBox="0 0 120 160" aria-hidden="true">
            <g className="tz-neon-leaf-sway tz-neon-leaf-sway-b">
              <use href="#tz-neon-hoja" />
            </g>
          </svg>
          <svg className="tz-neon-leaf tz-neon-leaf-3" style={{ animationDelay: "0.34s" }} viewBox="0 0 120 160" aria-hidden="true">
            <g className="tz-neon-leaf-sway">
              <use href="#tz-neon-hoja" />
            </g>
          </svg>
          <svg className="tz-neon-leaf tz-neon-leaf-4" style={{ animationDelay: "0.21s" }} viewBox="0 0 120 160" aria-hidden="true">
            <g className="tz-neon-leaf-sway tz-neon-leaf-sway-b">
              <use href="#tz-neon-hoja" />
            </g>
          </svg>
          {/* Hojas de marco a media altura en los bordes izquierdo y
             derecho — "los bordes repletos de plantas" pedido, no solo
             arriba/abajo. */}
          <svg className="tz-neon-leaf tz-neon-leaf-edge-l" style={{ animationDelay: "0.31s" }} viewBox="0 0 120 160" aria-hidden="true">
            <g className="tz-neon-leaf-sway">
              <use href="#tz-neon-hoja" />
            </g>
          </svg>
          <svg className="tz-neon-leaf tz-neon-leaf-edge-r" style={{ animationDelay: "0.38s" }} viewBox="0 0 120 160" aria-hidden="true">
            <g className="tz-neon-leaf-sway tz-neon-leaf-sway-b">
              <use href="#tz-neon-hoja" />
            </g>
          </svg>

          {/* Sombra suave detrás del texto para que se lea — capa propia
             DEBAJO de los animales (antes era el fondo de .tz-neon-content
             y se veía como un rectángulo que además apagaba al gallito). */}
          <div className="tz-neon-vineta" aria-hidden="true" />

          {/* Secuencia de fauna y flora (pico de loro, loros, mono,
             tigrillo, gallito de las rocas, serpiente) — cada uno en su
             turno, delante del fondo y detrás de la insignia y los
             textos, ver SelvaAnimales.jsx. */}
          <SelvaAnimales />

          {/* ---- Contenido central ---- */}
          <div className="tz-neon-content">
            <EmblemaSelva icono={icono} />
            <motion.p className="tz-neon-eyebrow" custom={0} variants={variantesTexto} initial="initial" animate="animate">
              {eyebrow}
            </motion.p>
            <motion.h1 className="tz-neon-title" custom={1} variants={variantesTexto} initial="initial" animate="animate">
              {titulo}
            </motion.h1>
            {descripcion && (
              <motion.p className="tz-neon-desc" custom={2} variants={variantesTexto} initial="initial" animate="animate">
                {descripcion}
              </motion.p>
            )}
          </div>

          <button type="button" className="tz-neon-skip-btn" onClick={saltar}>
            Saltar ▸
          </button>
        </motion.div>

          <style>{`
            /* Telón: EXACTAMENTE la pantalla, tocando los cuatro bordes —
               Safari en iPhone usa el color de un elemento fijo pegado a
               los bordes para pintar la barra de estado y la de abajo
               (si se estira más allá, deja de detectarlo). */
            .tz-neon-telon {
              position: fixed;
              inset: 0;
              z-index: 999999;
              cursor: pointer;
              background: #020605;
            }
            .tz-neon-bienvenida-overlay {
              --tz-neon-cyan: #2be8ff;
              --tz-neon-pink: #ff2f9e;
              --tz-neon-green: #4dffa0;
              --tz-neon-purple: #b98bff;
              position: absolute;
              inset: 0;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
              background:
                radial-gradient(circle at 50% 42%, rgba(15,40,32,0.9) 0%, rgba(4,10,9,0.97) 55%, #000 100%);
            }

            .tz-neon-blob {
              position: absolute;
              border-radius: 50%;
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
              0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.45; }
              33% { transform: translate(14vmax, 9vmax) scale(1.18); opacity: 0.65; }
              66% { transform: translate(4vmax, 18vmax) scale(0.92); opacity: 0.4; }
            }
            @keyframes tz-neon-blob-drift-b {
              0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.45; }
              40% { transform: translate(-16vmax, -8vmax) scale(1.2); opacity: 0.65; }
              75% { transform: translate(-6vmax, -16vmax) scale(0.95); opacity: 0.4; }
            }

            /* Rayos de luz que se cuelan entre los árboles y barren el
               fondo — refuerzan la sensación de selva viva. */
            .tz-neon-rayo {
              position: absolute;
              top: -20%;
              height: 140%;
              width: 16vw;
              min-width: 90px;
              pointer-events: none;
              /* Bordes suaves con degradados (horizontal en el fondo +
                 máscara vertical), sin blur ni mix-blend-mode: en Safari
                 esos dos dejaban un recorte rectangular visible. */
              -webkit-mask-image: linear-gradient(to bottom, #000 0%, transparent 85%);
              mask-image: linear-gradient(to bottom, #000 0%, transparent 85%);
              transform-origin: top center;
              opacity: 0;
              animation: tz-neon-rayo-barre 7s ease-in-out infinite alternate, tz-neon-rayo-pulso 3.2s ease-in-out infinite;
            }
            .tz-neon-rayo-1 { left: 8%; background: linear-gradient(to right, transparent, rgba(77,255,160,0.22) 50%, transparent); }
            .tz-neon-rayo-2 { left: 42%; width: 10vw; background: linear-gradient(to right, transparent, rgba(43,232,255,0.2) 50%, transparent); animation-duration: 9s, 4s; animation-delay: -2s, -1s; }
            .tz-neon-rayo-3 { left: 72%; background: linear-gradient(to right, transparent, rgba(255,47,158,0.18) 50%, transparent); animation-duration: 8s, 3.6s; animation-delay: -4s, -2s; }
            @keyframes tz-neon-rayo-barre {
              from { transform: rotate(22deg) translateX(-8vw); }
              to { transform: rotate(10deg) translateX(10vw); }
            }
            @keyframes tz-neon-rayo-pulso {
              0%, 100% { opacity: 0.35; }
              50% { opacity: 0.9; }
            }

            .tz-neon-svg-layer {
              position: absolute;
              inset: 0;
              width: 100%;
              height: 100%;
              pointer-events: none;
            }
            /* Fundido propio para las capas sin animación de entrada:
               Safari a veces pinta los elementos con drop-shadow sin
               respetar el fundido del contenedor, y se veían solos y a
               pleno brillo en el primer instante. */
            .tz-neon-svg-layer,
            .tz-neon-ground {
              animation: tz-neon-aparece 0.8s ease-out both;
            }
            @keyframes tz-neon-aparece {
              from { opacity: 0; }
              to { opacity: 1; }
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

            .tz-neon-content {
              position: relative;
              z-index: 2;
              display: flex;
              flex-direction: column;
              align-items: center;
              text-align: center;
              padding: 28px 28px 32px;
              max-width: 880px;
            }
            /* Sombra detrás del texto: "closest-side" hace que el
               degradado llegue a transparente ANTES del borde de la caja,
               así nunca se ve un rectángulo. */
            .tz-neon-vineta {
              position: absolute;
              left: 50%;
              top: 50%;
              width: min(900px, 120%);
              height: 80%;
              transform: translate(-50%, -50%);
              pointer-events: none;
              background: radial-gradient(closest-side, rgba(3,8,7,0.6) 0%, rgba(3,8,7,0.3) 55%, transparent 100%);
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
              /* Bug de diseño reportado: "glow central... cortes en los
                 bordes" — filter:drop-shadow() sobre un elemento con
                 background-clip:text hace que varios navegadores
                 recorten el glow al bounding-box del texto (rectángulo
                 duro) en vez de dejarlo irradiar libre. text-shadow no
                 sufre ese recorte (actúa sobre los glifos, no sobre un
                 filtro de bitmap) y sigue funcionando con color:
                 transparent + el relleno en gradiente. */
              text-shadow: 0 0 18px rgba(43,232,255,0.55), 0 0 34px rgba(255,47,158,0.35);
              animation: tz-neon-title-pulse 2.6s ease-in-out 2.3s infinite;
            }
            .tz-neon-desc {
              margin: 0;
              font-family: 'Rajdhani', sans-serif;
              font-weight: 600;
              font-size: clamp(14px, 3vw, 19px);
              color: #dffcff;
              text-shadow: 0 0 14px rgba(43,232,255,0.4);
            }
            @keyframes tz-neon-text-in {
              0% { opacity: 0; transform: translateY(16px); }
              100% { opacity: 1; transform: translateY(0); }
            }
            @keyframes tz-neon-title-pulse {
              0%, 100% { text-shadow: 0 0 18px rgba(43,232,255,0.55), 0 0 34px rgba(255,47,158,0.35); }
              50% { text-shadow: 0 0 30px rgba(43,232,255,0.8), 0 0 54px rgba(255,47,158,0.55); }
            }

            /* ---- Emblema central ---- */
            .tz-neon-emblema {
              position: relative;
              width: min(30vmin, 150px);
              height: min(30vmin, 150px);
              /* El dibujo (corona de hojitas) sobresale un 28% de esta
                 caja hacia abajo: el margen arranca desde ese borde real
                 y deja ~22px de aire visible hasta el texto. */
              margin-top: calc(min(30vmin, 150px) * 0.28);
              margin-bottom: calc(min(30vmin, 150px) * 0.28 + 22px);
            }
            .tz-neon-emblema-svg {
              position: absolute;
              inset: -28%;
              width: 156%;
              height: 156%;
              overflow: visible;
            }
            .tz-neon-emblema-glow {
              position: absolute;
              inset: -45%;
              border-radius: 50%;
              background: radial-gradient(circle, rgba(77,255,160,0.32), rgba(43,232,255,0.14) 45%, transparent 70%);
              animation: tz-neon-emblema-pulse 2.2s ease-in-out infinite;
              pointer-events: none;
            }
            @keyframes tz-neon-emblema-pulse {
              0%, 100% { transform: scale(1); opacity: 0.75; }
              50% { transform: scale(1.14); opacity: 1; }
            }
            .tz-neon-aro-fondo {
              fill: rgba(4,20,14,0.55);
              stroke: rgba(77,255,160,0.16);
              stroke-width: 3;
            }
            .tz-neon-aro-trazo {
              fill: none;
              stroke: url(#tz-neon-aro-grad);
              stroke-width: 5;
              stroke-linecap: round;
              transform-origin: 60px 60px;
              transform: rotate(-90deg);
              filter: drop-shadow(0 0 8px rgba(77,255,160,0.9)) drop-shadow(0 0 18px rgba(43,232,255,0.6));
            }
            .tz-neon-emblema-icono {
              fill: none;
              stroke: #eafff4;
              stroke-width: 5;
              stroke-linecap: round;
              stroke-linejoin: round;
              filter: drop-shadow(0 0 6px rgba(77,255,160,0.95)) drop-shadow(0 0 14px rgba(77,255,160,0.5));
            }
            .tz-neon-corona-hoja {
              fill: rgba(77,255,160,0.85);
              filter: drop-shadow(0 0 5px rgba(77,255,160,0.9));
            }
            .tz-neon-corona-hoja-b {
              fill: rgba(43,232,255,0.8);
              filter: drop-shadow(0 0 5px rgba(43,232,255,0.9));
            }

            /* Oleadas que estallan desde el emblema */
            .tz-neon-burst {
              position: absolute;
              top: 50%;
              left: 50%;
              width: 0;
              height: 0;
              pointer-events: none;
            }
            .tz-neon-burst-hoja,
            .tz-neon-burst-luciernaga {
              position: absolute;
              top: 0;
              left: 0;
            }
            .tz-neon-burst-hoja {
              border-radius: 2px 80% 2px 80%;
              box-shadow: 0 0 8px currentColor;
            }
            .tz-neon-burst-luciernaga {
              border-radius: 50%;
              box-shadow: 0 0 6px 2px currentColor, 0 0 14px 4px rgba(234,255,122,0.45);
            }

            /* Ambiente: hojas que caen de la copa */
            .tz-neon-hoja-cae {
              position: absolute;
              top: -6%;
              border-radius: 2px 80% 2px 80%;
              box-shadow: 0 0 8px currentColor;
              opacity: 0;
              pointer-events: none;
              animation-name: tz-neon-hoja-cae;
              animation-timing-function: ease-in-out;
              animation-fill-mode: both;
            }
            @keyframes tz-neon-hoja-cae {
              0% { opacity: 0; transform: translate(0, 0) rotate(0deg); }
              10% { opacity: 0.9; }
              30% { transform: translate(calc(var(--tz-neon-deriva) * 0.6), 30vh) rotate(140deg); }
              55% { transform: translate(calc(var(--tz-neon-deriva) * -0.3), 58vh) rotate(260deg); }
              85% { opacity: 0.8; }
              100% { opacity: 0; transform: translate(var(--tz-neon-deriva), 105vh) rotate(420deg); }
            }

            /* Ambiente: luciérnagas flotando */
            .tz-neon-luciernaga {
              position: absolute;
              border-radius: 50%;
              background: #eaff7a;
              box-shadow: 0 0 6px 2px rgba(234,255,122,0.9), 0 0 16px 5px rgba(166,255,77,0.45);
              opacity: 0;
              pointer-events: none;
              animation-name: tz-neon-luciernaga-titila, tz-neon-luciernaga-vuela;
              animation-timing-function: ease-in-out, ease-in-out;
              animation-iteration-count: infinite, infinite;
              animation-direction: normal, alternate;
            }
            @keyframes tz-neon-luciernaga-titila {
              0%, 100% { opacity: 0; }
              40%, 60% { opacity: 1; }
            }
            @keyframes tz-neon-luciernaga-vuela {
              0% { transform: translate(0, 0); }
              50% { transform: translate(18px, -14px); }
              100% { transform: translate(-12px, -26px); }
            }

            /* ---- Cierre: la selva se abre ---- */
            @property --tz-neon-hueco {
              syntax: '<percentage>';
              inherits: false;
              initial-value: 0%;
            }
            .tz-neon-telon.tz-neon-cerrando {
              cursor: default;
              -webkit-mask-image: radial-gradient(circle at 50% 46%, transparent calc(var(--tz-neon-hueco) - 22%), #000 var(--tz-neon-hueco));
              mask-image: radial-gradient(circle at 50% 46%, transparent calc(var(--tz-neon-hueco) - 22%), #000 var(--tz-neon-hueco));
              animation: tz-neon-abrir ${MS_DURACION_CIERRE}ms cubic-bezier(0.55, 0, 0.75, 0.4) forwards;
            }
            @keyframes tz-neon-abrir {
              from { --tz-neon-hueco: 0%; }
              to { --tz-neon-hueco: 125%; }
            }
            .tz-neon-content,
            .tz-neon-canopy,
            .tz-neon-vine-leaf-tip,
            .tz-neon-leaf,
            .tz-neon-ground,
            .tz-selva,
            .tz-selva-agua,
            .tz-neon-vineta,
            .tz-neon-luciernaga {
              transition: translate 0.9s cubic-bezier(0.5, 0, 0.75, 0), scale 0.9s ease-in, opacity 0.7s ease-in, filter 0.7s ease-in;
            }
            .tz-neon-cerrando .tz-neon-content { scale: 1.18; opacity: 0; filter: blur(8px); }
            .tz-neon-cerrando .tz-neon-canopy,
            .tz-neon-cerrando .tz-neon-vine-leaf-tip { translate: 0 -40vh; }
            .tz-neon-cerrando .tz-selva { translate: 0 -12vh; opacity: 0; }
            .tz-neon-cerrando .tz-neon-ground,
            .tz-neon-cerrando .tz-selva-agua { translate: 0 30vh; }
            .tz-neon-cerrando .tz-neon-vineta { opacity: 0; }
            .tz-neon-cerrando .tz-neon-leaf-1,
            .tz-neon-cerrando .tz-neon-leaf-3,
            .tz-neon-cerrando .tz-neon-leaf-edge-l { translate: -45vw 10vh; }
            .tz-neon-cerrando .tz-neon-leaf-2,
            .tz-neon-cerrando .tz-neon-leaf-4,
            .tz-neon-cerrando .tz-neon-leaf-edge-r { translate: 45vw 10vh; }
            .tz-neon-cerrando .tz-neon-luciernaga { translate: var(--tz-neon-fuga-x) var(--tz-neon-fuga-y); }
            .tz-neon-cerrando .tz-neon-skip-btn { opacity: 0; transition: opacity 0.3s; }

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

          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
    </MotionConfig>
  );
}
