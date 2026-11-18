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

function pintarFondo() {
  const raiz = document.querySelector(".tz-root");
  if (!raiz) return;
  const escena = document.querySelector(".tz-escena");
  const cuerpo = colorDe(raiz) || colorDe(escena?.firstElementChild);
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
  instalarJalar();
}
