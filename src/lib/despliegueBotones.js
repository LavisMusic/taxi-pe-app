// Botones de la cabecera en el CELULAR: manteniendo presionado un botón
// se despliega su nombre; sin soltar, deslizando el dedo por la columna
// se despliega el botón que queda debajo (y se recoge el anterior). Al
// soltar encima de un botón se abre ese botón; en un lugar vacío no pasa
// nada. Un toque corto funciona como siempre (abre el botón).
// En PC el despliegue es con el cursor (CSS :hover, Styles.jsx).
// Se instala una sola vez para toda la app (main.jsx): escucha en el
// documento, así sirve para todos los paneles (pasajero, conductor,
// recolector y Admin).
const SELECTOR = ".tz-header .tz-header-btn";
const ESPERA_MS = 350;
const TOLERANCIA_PX = 10;

let instalado = false;

export function instalarDespliegueBotones() {
  if (instalado || typeof document === "undefined") return;
  instalado = true;

  let timer = null;
  let modo = false;
  let inicio = null;
  let abierto = null;
  let suprimirHasta = 0;
  let clicPropio = false;

  const abrir = (btn) => {
    if (abierto === btn) return;
    if (abierto) abierto.classList.remove("tz-hbtn-abierto");
    abierto = btn;
    if (btn) btn.classList.add("tz-hbtn-abierto");
  };
  const reiniciar = () => {
    clearTimeout(timer);
    timer = null;
    modo = false;
    inicio = null;
    abrir(null);
  };
  const botonEn = (x, y) => document.elementFromPoint(x, y)?.closest?.(SELECTOR) || null;

  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse") return;
      const btn = e.target.closest?.(SELECTOR);
      if (!btn) return;
      reiniciar();
      inicio = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => {
        modo = true;
        abrir(btn);
        if (navigator.vibrate) navigator.vibrate(12);
      }, ESPERA_MS);
    },
    true
  );

  document.addEventListener(
    "pointermove",
    (e) => {
      if (!inicio) return;
      if (!modo) {
        // Se movió antes de tiempo: no es "mantener presionado".
        if (Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > TOLERANCIA_PX) {
          clearTimeout(timer);
          timer = null;
        }
        return;
      }
      abrir(botonEn(e.clientX, e.clientY));
    },
    true
  );

  document.addEventListener(
    "pointerup",
    (e) => {
      if (!inicio) return;
      if (!modo) {
        reiniciar();
        return; // toque corto: el clic normal sigue su curso
      }
      const btn = botonEn(e.clientX, e.clientY);
      reiniciar();
      // El navegador puede mandar su propio clic al soltar: se ignora y
      // se abre solo el botón que quedó debajo del dedo.
      suprimirHasta = Date.now() + 500;
      if (btn) {
        clicPropio = true;
        btn.click();
        clicPropio = false;
      }
    },
    true
  );

  document.addEventListener("pointercancel", reiniciar, true);

  window.addEventListener(
    "click",
    (e) => {
      if (clicPropio || Date.now() > suprimirHasta) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );

  // Sin menú del navegador al mantener presionado un botón.
  document.addEventListener(
    "contextmenu",
    (e) => {
      if (e.target.closest?.(SELECTOR)) e.preventDefault();
    },
    true
  );
}
