// Gestos de la página — MISMO archivo en Taxi-PE y Caja
// (src/lib/gestosPagina.js). Se instala una vez al arrancar (main.jsx).
//
// 1. La página no se estira más allá de sus bordes (overscroll-behavior:
//    none): en el iPhone el estirón descubría un espacio afuera (negro o
//    con un relleno que no acompañaba bien a la página).
// 2. Deslizar para recargar: con la página arriba del todo y sin un modal
//    abierto, al jalar hacia abajo baja solo un círculo y dentro gira el
//    símbolo de recarga; soltándolo pasado el límite, el símbolo gira un
//    momento, el círculo se esconde suave y la página se recarga. Antes
//    del límite, el círculo se esconde y no pasa nada más. (Como la página
//    ya no se estira, el gesto propio del navegador tampoco existe: este
//    funciona en la app instalada y en el navegador.)
// 3. Notch: la app ocupa toda la pantalla (viewport-fit=cover en
//    index.html); la cabecera de arriba de la página se extiende debajo de
//    la barra de estado con su diseño y su contenido baja lo justo. Los
//    modales y las barras de abajo se apartan del notch y de la barra de
//    inicio.

const UMBRAL = 70; // px de jalón (ya amortiguado) para recargar
const TOPE = 120;

// ---------------------------------------------------------------- notch
let sonda = null;
function altoNotch() {
  if (!sonda) {
    sonda = document.createElement("div");
    sonda.setAttribute("aria-hidden", "true");
    Object.assign(sonda.style, {
      position: "fixed", top: "0", left: "0", width: "0", visibility: "hidden", pointerEvents: "none",
      height: "env(safe-area-inset-top, 0px)",
    });
    document.body.appendChild(sonda);
  }
  return Math.round(sonda.getBoundingClientRect().height);
}

function instalarEstilos() {
  const st = document.createElement("style");
  st.setAttribute("data-tz-gestos", "");
  st.textContent = `
html, body { overscroll-behavior: none; }
html .tz-modal-backdrop { padding-top: max(10px, env(safe-area-inset-top, 0px)); padding-bottom: max(10px, env(safe-area-inset-bottom, 0px)); }
html .tz-modal { max-height: min(90vh, calc(100vh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 20px)); }
html .tz-cart-floating-bar { bottom: calc(16px + env(safe-area-inset-bottom, 0px)); }
html .tz-vista-previa { bottom: calc(14px + env(safe-area-inset-bottom, 0px)); }
`;
  document.head.appendChild(st);
}

let cabeceraConNotch = null;
function ajustarNotch() {
  const raiz = document.querySelector(".tz-root");
  const h = raiz?.querySelector(".tz-header") || null;
  if (cabeceraConNotch && cabeceraConNotch !== h) {
    cabeceraConNotch.style.removeProperty("padding-top");
    cabeceraConNotch = null;
  }
  const notch = altoNotch();
  // Solo la cabecera que está arriba del todo de la página.
  const alTope = h && h.getBoundingClientRect().top + window.scrollY < 2;
  if (!h || !notch || !alTope) {
    if (h && h === cabeceraConNotch) {
      h.style.removeProperty("padding-top");
      cabeceraConNotch = null;
    }
    return;
  }
  // El padding del tema (sin lo agregado) + el notch, por encima del tema.
  h.style.removeProperty("padding-top");
  const base = parseFloat(getComputedStyle(h).paddingTop) || 0;
  h.style.setProperty("padding-top", `${base + notch}px`, "important");
  cabeceraConNotch = h;
}

// ---------------------------------------------------------------- deslizar para recargar
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
    top: "env(safe-area-inset-top, 0px)",
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
  // Solo el símbolo gira (el círculo no).
  const simbolo = el.firstChild;
  simbolo.style.transition = "transform 0.2s ease";
  const montar = () => document.body && !el.isConnected && document.body.appendChild(el);

  const mover = (d, suave) => {
    el.style.transition = suave
      ? "transform 0.55s cubic-bezier(.34,1.56,.64,1), opacity 0.35s ease, box-shadow 0.3s ease, color 0.3s ease"
      : "box-shadow 0.3s ease, color 0.3s ease";
    const listo = d >= UMBRAL;
    el.style.transform = `translateY(${d + (d > 0 ? 18 : 0)}px) scale(${listo ? 1.12 : 0.8 + (d / UMBRAL) * 0.2})`;
    el.style.opacity = String(Math.min(1, d / 40));
    el.style.boxShadow = listo ? "0 0 26px rgba(57,255,176,0.75)" : "0 0 18px rgba(43,232,255,0.45)";
    el.style.color = listo ? "#39ffb0" : "#2be8ff";
    simbolo.style.transform = `rotate(${d * 4}deg)`;
  };

  const hayModal = () => !!document.querySelector(".tz-modal-backdrop, .tz-modal");

  window.addEventListener(
    "touchstart",
    (e) => {
      if (recargando || window.scrollY > 0 || hayModal() || e.touches.length !== 1) {
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
      // Se acomoda en su lugar, el símbolo gira un momento, el círculo se
      // esconde suave y recién ahí se recarga.
      el.style.transition = "transform 0.45s cubic-bezier(.34,1.56,.64,1)";
      el.style.transform = `translateY(${UMBRAL + 18}px) scale(1.12)`;
      simbolo.style.transition = "none";
      simbolo.animate?.([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], {
        duration: 650,
        iterations: Infinity,
        easing: "linear",
      });
      setTimeout(() => {
        el.style.transition = "transform 0.4s cubic-bezier(.36,0,.66,-0.56), opacity 0.35s ease";
        el.style.transform = `translateY(${UMBRAL - 10}px) scale(0.3)`;
        el.style.opacity = "0";
      }, 700);
      setTimeout(() => window.location.reload(), 1080);
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
  instalarEstilos();
  // Cada cabecera nueva (al cambiar de pantalla) recibe el espacio del
  // notch enseguida; además se revisa cada pocos segundos (el tema puede
  // cambiar su padding).
  let pendiente = 0;
  let vista = null;
  new MutationObserver(() => {
    if (pendiente) return;
    pendiente = requestAnimationFrame(() => {
      pendiente = 0;
      const h = document.querySelector(".tz-root .tz-header");
      if (h === vista) return;
      vista = h;
      ajustarNotch();
    });
  }).observe(document.body, { childList: true, subtree: true });
  ajustarNotch();
  [300, 1000, 2500].forEach((ms) => setTimeout(ajustarNotch, ms));
  setInterval(() => document.visibilityState === "visible" && ajustarNotch(), 2000);
  window.addEventListener("resize", ajustarNotch);
  instalarJalar();
}
