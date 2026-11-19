// Gestos de la página — MISMO archivo en Taxi-PE y Caja
// (src/lib/gestosPagina.js). Se instala una vez al arrancar (main.jsx).
//
// 1. Fondo al estirar: en el celular, al jalar la página más allá de sus
//    bordes (arriba, abajo, a los lados) se veía el negro del documento.
//    El fondo del documento toma el color de la cabecera cerca de arriba y
//    el del cuerpo cerca de abajo, leídos del tema activo (en Caja cambia
//    con el tema de cada negocio): se ve la continuación de la página.
// 2. Deslizar para recargar (solo en la app instalada: en el navegador ya
//    existe ese gesto): con la página arriba del todo y sin un modal
//    abierto, al jalar hacia abajo aparece un círculo con una flecha que
//    crece y gira; soltándolo pasado el límite, la página se recarga.

const UMBRAL = 70; // px de jalón (ya amortiguado) para recargar
const TOPE = 120;

function primerColor(fondo) {
  // El último degradado suele ser la base del tema: su primer color.
  const capas = String(fondo || "").split(/(?=linear-gradient|radial-gradient|url\()/);
  for (let i = capas.length - 1; i >= 0; i--) {
    const m = capas[i].match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}\b/i);
    if (m && !/rgba\([^)]*,\s*0\)/.test(m[0])) return m[0];
  }
  return null;
}

// Opaco: lo que se descubre al estirar no tiene nada detrás (se vería negro).
const opaco = (c) => (c ? c.replace(/rgba\(\s*([^,]+),\s*([^,]+),\s*([^,]+),[^)]*\)/i, "rgb($1, $2, $3)") : c);

function colorDe(el) {
  if (!el) return null;
  const cs = getComputedStyle(el);
  const c = cs.backgroundColor;
  if (c && c !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(c)) return opaco(c);
  return opaco(primerColor(cs.backgroundImage));
}

// En iPhone el área que se descubre al estirar se pinta con el COLOR de
// fondo del documento (no con imágenes ni degradados): se usa el de la
// cabecera cerca de arriba y el del cuerpo cerca de abajo. Solo se toca
// el del documento (<html>), nunca el del <body>: un fondo en el body
// taparía la escena del tema (va detrás del contenido, z-index -1).
let colores = { arriba: null, abajo: null };
let aplicado = "";
function aplicarFondo() {
  const html = document.documentElement;
  if (!colores.arriba) {
    if (aplicado) html.style.backgroundColor = "";
    aplicado = "";
    return;
  }
  const cercaDeArriba = window.scrollY < window.innerHeight / 2;
  const color = cercaDeArriba ? colores.arriba : colores.abajo || colores.arriba;
  if (color === aplicado) return;
  aplicado = color;
  html.style.backgroundColor = color;
}

// Relleno al estirar: en el iPhone, al jalar la página más allá de arriba
// o de abajo, lo FIJO no se mueve y el hueco que se abre mostraba el fondo
// del documento (negro) o la escena del tema (el mar encima de la arena).
// Durante el estirón el navegador informa un desplazamiento negativo (o
// pasado el final): con eso se cubre EXACTAMENTE el hueco con la
// continuación del diseño, en espejo contra el borde para que empalme sin
// costura:
//   * Arriba: la luz del cuerpo (su fondo, o la escena) + la cabecera
//     encima (si hay arena, más arena) + el brillo del logo que sigue
//     hacia arriba.
//   * Abajo: el cuerpo + el pie encima, si es lo último de la página.
let relleno = null;
function crearRelleno() {
  if (relleno || !document.body) return relleno;
  const hacer = (lado) => {
    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    el.className = "tz-relleno-estiron";
    Object.assign(el.style, {
      position: "fixed", left: "0", right: "0", [lado]: "0", height: "0px", overflow: "hidden",
      pointerEvents: "none", zIndex: "2147482000", display: "none",
    });
    // Capas: el cuerpo, la cabecera o el pie, y el brillo del logo.
    const capa = () => {
      const c = document.createElement("div");
      Object.assign(c.style, { position: "absolute", left: "0", [lado === "top" ? "bottom" : "top"]: "0", transform: "scaleY(-1)" });
      el.appendChild(c);
      return c;
    };
    const cuerpo = capa();
    const borde = capa();
    // La cabecera (o el pie) se desvanece antes de su otro borde: no se
    // repite su línea de abajo y se funde con lo que sigue (la luz del
    // cuerpo o su mismo color). Sentido en su propio dibujo (antes de
    // voltearlo): la orilla que empalma con la página queda opaca.
    const fundido = `linear-gradient(${lado === "top" ? "to bottom" : "to top"}, #000 0%, #000 45%, transparent 88%)`;
    borde.style.webkitMaskImage = fundido;
    borde.style.maskImage = fundido;
    const brillo = document.createElement("img");
    brillo.alt = "";
    Object.assign(brillo.style, { position: "absolute", display: "none", maxWidth: "none" });
    el.appendChild(brillo);
    document.body.appendChild(el);
    return { el, cuerpo, borde, brillo, alto: -1 };
  };
  relleno = { arriba: hacer("top"), abajo: hacer("bottom") };
  return relleno;
}

// Copia el fondo de `desde` en `capa`, del mismo tamaño que el original
// (así se dibuja igual); sin `desde`, la capa queda vacía.
function copiarFondo(capa, desde) {
  if (!desde) {
    capa.style.display = "none";
    return;
  }
  const cs = getComputedStyle(desde);
  const r = desde.getBoundingClientRect();
  const color = cs.backgroundColor && !/rgba\([^)]*,\s*0\)$/.test(cs.backgroundColor) && cs.backgroundColor !== "transparent" ? cs.backgroundColor : "transparent";
  const estilo = {
    display: "block",
    width: `${Math.round(r.width || window.innerWidth)}px`,
    height: `${Math.round(r.height || window.innerHeight)}px`,
    backgroundColor: color,
    backgroundImage: cs.backgroundImage,
    backgroundSize: cs.backgroundSize,
    backgroundRepeat: cs.backgroundRepeat,
    backgroundPosition: cs.backgroundPosition,
  };
  const clave = [estilo.width, estilo.height, color, estilo.backgroundSize, estilo.backgroundPosition, estilo.backgroundImage.length, estilo.backgroundImage.slice(0, 160)].join("|");
  if (capa.dataset.clave === clave) return;
  capa.dataset.clave = clave;
  Object.assign(capa.style, estilo);
}

// El brillo del logo sigue hacia arriba: una copia del logo con su mismo
// filtro (drop-shadow) puesta donde está el logo, justo debajo del hueco.
// La imagen queda fuera (recortada) y solo asoma su resplandor real.
function copiarBrillo(capa, cabecera) {
  const logo = cabecera?.querySelector("img.tz-logo");
  const filtro = logo ? getComputedStyle(logo).filter : "none";
  if (!logo || !filtro || filtro === "none" || !(logo.currentSrc || logo.src)) {
    capa.style.display = "none";
    return;
  }
  const rl = logo.getBoundingClientRect();
  const rc = cabecera.getBoundingClientRect();
  const src = logo.currentSrc || logo.src;
  if (capa.getAttribute("src") !== src) capa.setAttribute("src", src);
  Object.assign(capa.style, {
    display: "block",
    width: `${rl.width}px`,
    height: `${rl.height}px`,
    left: `${rl.left}px`,
    // Su borde de arriba, a la misma distancia del borde del hueco que la
    // del logo al borde de arriba de la cabecera.
    bottom: `${-(rl.top - rc.top + rl.height)}px`,
    filter: filtro,
  });
}

function pintarRelleno(raiz, escena, colorArriba, colorAbajo) {
  const r = crearRelleno();
  if (!r) return;
  const cabecera = raiz.querySelector(".tz-header");
  // El pie solo si es lo último de la página.
  const pie = raiz.querySelector(".tz-page-footer");
  const pieAlFinal =
    !!pie && pie.getBoundingClientRect().bottom + window.scrollY >= document.documentElement.scrollHeight - 4;
  // Sin fondo propio y con escena (el mar): la escena es fija y ya llena el
  // hueco con lo correcto (es lo que hay detrás de la página), así que ahí
  // el relleno es transparente y solo lleva la cabecera o el pie.
  const conFondo = !!colorDe(raiz);
  const soloEscena = !conFondo && !!escena;
  const cuerpo = conFondo || !escena ? raiz : null;
  // Arriba: con cabecera, su color debajo (la cabecera se funde con él:
  // más arena); sin cabecera (pantallas de carga), el cuerpo en espejo o,
  // con escena, nada.
  r.arriba.el.style.backgroundColor = cabecera || !soloEscena ? colorArriba : "transparent";
  copiarFondo(r.arriba.cuerpo, cuerpo);
  copiarFondo(r.arriba.borde, cabecera);
  copiarBrillo(r.arriba.brillo, cabecera);
  r.abajo.el.style.backgroundColor = soloEscena ? "transparent" : colorAbajo;
  copiarFondo(r.abajo.cuerpo, cuerpo);
  copiarFondo(r.abajo.borde, pieAlFinal ? pie : null);
}

// El alto del hueco arriba (desplazamiento negativo) y abajo (pasado el
// final). Devuelve si hay hueco. Se solapa unos píxeles con la cabecera o
// el pie (la copia en espejo es igual en esa orilla): así no asoma una
// línea del fondo aunque el dato llegue un cuadro tarde.
const SOLAPE = 4;
function medirEstiron() {
  if (!relleno) return false;
  const y = window.scrollY;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const poner = (lado, alto) => {
    const a = Math.max(0, Math.ceil(alto));
    if (lado.alto === a) return a > 0;
    lado.alto = a;
    lado.el.style.display = a > 0 ? "block" : "none";
    lado.el.style.height = `${a > 0 ? a + SOLAPE : 0}px`;
    return a > 0;
  };
  const arriba = poner(relleno.arriba, -y);
  // (Aunque la página quepa entera, en el iPhone también se estira.)
  const abajo = poner(relleno.abajo, y - Math.max(0, max));
  return arriba || abajo;
}

// Durante el estirón los eventos de desplazamiento llegan tarde y de a
// saltos: mientras el dedo está en la pantalla, y hasta que la página
// vuelve a su lugar, se mide en CADA cuadro.
let tocando = false;
let bucle = 0;
function seguirEstiron() {
  if (bucle) return;
  let quietos = 0;
  const paso = () => {
    const hay = medirEstiron();
    quietos = hay || tocando ? 0 : quietos + 1;
    // Unos cuadros más tras soltar (el rebote termina solo).
    bucle = quietos > 20 ? 0 : requestAnimationFrame(paso);
  };
  bucle = requestAnimationFrame(paso);
}

function pintarFondo() {
  const raiz = document.querySelector(".tz-root");
  if (!raiz) return;
  const escena = document.querySelector(".tz-escena");
  const cuerpo = colorDe(raiz) || colorDe(escena?.firstElementChild);
  // El relleno al estirar, siempre (con el color del documento si la
  // página no tiene fondo propio).
  const base = opaco(getComputedStyle(document.documentElement).backgroundColor) || "#0a0716";
  pintarRelleno(
    raiz,
    escena,
    colorDe(raiz.querySelector(".tz-header")) || cuerpo || base,
    cuerpo || base
  );
  // Si ni el cuerpo ni una escena cubren la pantalla, lo que se ve detrás
  // del contenido ES el fondo del documento: se deja como está.
  if (!cuerpo) {
    colores = { arriba: null, abajo: null };
    aplicarFondo();
    return;
  }
  const arriba = colorDe(raiz.querySelector(".tz-header")) || cuerpo;
  colores = { arriba, abajo: cuerpo };
  aplicado = "";
  aplicarFondo();
}

const esAppInstalada = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

function instalarJalar() {
  let inicio = null;
  let jalon = 0;
  let recargando = false;
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
  Object.assign(el.style, {
    position: "fixed",
    top: "0",
    left: "50%",
    width: "44px",
    height: "44px",
    marginLeft: "-22px",
    marginTop: "-56px",
    borderRadius: "999px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#2be8ff",
    background: "rgba(20,13,40,0.94)",
    border: "1px solid rgba(43,232,255,0.6)",
    boxShadow: "0 0 18px rgba(43,232,255,0.45)",
    zIndex: "2147483000",
    opacity: "0",
    pointerEvents: "none",
    willChange: "transform, opacity",
  });
  const montar = () => document.body && !el.isConnected && document.body.appendChild(el);

  const mover = (d, suave) => {
    el.style.transition = suave ? "transform 0.5s cubic-bezier(.34,1.56,.64,1), opacity 0.35s ease" : "none";
    const listo = d >= UMBRAL;
    el.style.transform = `translateY(${d + (d > 0 ? 18 : 0)}px) rotate(${d * 3}deg) scale(${listo ? 1.12 : 0.8 + (d / UMBRAL) * 0.2})`;
    el.style.opacity = String(Math.min(1, d / 40));
    el.style.boxShadow = listo ? "0 0 26px rgba(57,255,176,0.75)" : "0 0 18px rgba(43,232,255,0.45)";
    el.style.color = listo ? "#39ffb0" : "#2be8ff";
  };

  const hayModal = () => !!document.querySelector(".tz-modal-backdrop, .tz-modal");

  window.addEventListener(
    "touchstart",
    (e) => {
      if (recargando || !esAppInstalada() || window.scrollY > 0 || hayModal() || e.touches.length !== 1) {
        inicio = null;
        return;
      }
      montar();
      inicio = e.touches[0].clientY;
      jalon = 0;
    },
    { passive: true }
  );
  window.addEventListener(
    "touchmove",
    (e) => {
      if (inicio == null) return;
      const dy = e.touches[0].clientY - inicio;
      if (dy <= 0 || window.scrollY > 0) {
        if (jalon) mover(0, true);
        jalon = 0;
        return;
      }
      jalon = Math.min(TOPE, dy * 0.5);
      mover(jalon, false);
    },
    { passive: true }
  );
  const soltar = () => {
    if (inicio == null) return;
    inicio = null;
    if (jalon >= UMBRAL) {
      recargando = true;
      el.style.transition = "transform 0.4s cubic-bezier(.34,1.56,.64,1)";
      el.style.transform = `translateY(${UMBRAL}px) scale(1.12)`;
      el.animate?.([{ rotate: "0deg" }, { rotate: "360deg" }], { duration: 650, iterations: Infinity });
      setTimeout(() => window.location.reload(), 280);
      return;
    }
    jalon = 0;
    mover(0, true);
  };
  window.addEventListener("touchend", soltar, { passive: true });
  window.addEventListener("touchcancel", soltar, { passive: true });
}

let instalado = false;
export function instalarGestosPagina() {
  if (instalado || typeof window === "undefined") return;
  instalado = true;
  // El tema se aplica después de cargar (y en Caja cambia por negocio):
  // se vuelve a leer al rato y cada pocos segundos (son dos lecturas).
  pintarFondo();
  [300, 1000, 2500].forEach((ms) => setTimeout(pintarFondo, ms));
  setInterval(() => document.visibilityState === "visible" && pintarFondo(), 2000);
  window.addEventListener("resize", pintarFondo);
  window.addEventListener("scroll", aplicarFondo, { passive: true });
  window.addEventListener("scroll", () => (medirEstiron(), seguirEstiron()), { passive: true });
  window.addEventListener("touchstart", () => ((tocando = true), seguirEstiron()), { passive: true });
  window.addEventListener("touchmove", () => (medirEstiron(), seguirEstiron()), { passive: true });
  const soltarDedo = () => ((tocando = false), seguirEstiron());
  window.addEventListener("touchend", soltarDedo, { passive: true });
  window.addEventListener("touchcancel", soltarDedo, { passive: true });
  instalarJalar();
}
