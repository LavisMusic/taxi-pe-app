import { useEffect } from "react";

/* Desplazamiento que acompaña los despliegues — MISMO archivo en Taxi-PE y
   Caja (src/lib/seguirDespliegue.js): mantener iguales.

   En los flujos por pasos (pagar un pedido, una membresía, un plan…) cada
   elección despliega más cosas debajo: el número para yapear, los botones
   del comprobante, la vista previa, el botón de enviar. Para que la persona
   no tenga que arrastrar la pantalla, mientras el contenido crece el modal
   se desliza solo hacia abajo, suave, hasta donde termina lo desplegado,
   sin sacar de la vista lo último que tocó (queda arriba como referencia).

   Uso: const ref = useRef(null); useSeguirDespliegue(ref); <div ref={ref}
   className="tz-modal">…  (el elemento que hace scroll o uno de adentro:
   se busca el contenedor con scroll más cercano). Solo actúa después de
   que la persona tocó algo dentro (abrir el modal no lo desplaza). */

const MARGEN = 14; // px que quedan libres arriba del último toque

function contenedorConScroll(el) {
  for (let p = el; p; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowY)) return p;
  }
  return null;
}

export function useSeguirDespliegue(ref, activo = true) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !activo || typeof ResizeObserver === "undefined") return undefined;
    const sc = contenedorConScroll(el) || el;
    let ancla = null; // lo último que tocó
    let armado = false;
    let altoPrevio = sc.scrollHeight;
    let hasta = 0;
    let raf = 0;

    const paso = () => {
      raf = 0;
      const max = sc.scrollHeight - sc.clientHeight;
      let objetivo = max;
      if (ancla?.isConnected) {
        const tope = ancla.getBoundingClientRect().top - sc.getBoundingClientRect().top - MARGEN;
        objetivo = Math.min(objetivo, sc.scrollTop + tope);
      }
      const falta = objetivo - sc.scrollTop;
      if (falta > 0.5) sc.scrollTop += Math.max(1, falta * 0.18);
      if (performance.now() < hasta) raf = requestAnimationFrame(paso);
    };
    const seguir = () => {
      hasta = performance.now() + 900;
      if (!raf) raf = requestAnimationFrame(paso);
    };
    const parar = () => {
      hasta = 0;
    };

    const revisar = () => {
      const alto = sc.scrollHeight;
      if (armado && alto > altoPrevio + 2) seguir();
      altoPrevio = alto;
    };
    const ro = new ResizeObserver(revisar);
    const observarHijos = () => {
      ro.disconnect();
      ro.observe(sc);
      Array.from(sc.children).forEach((c) => ro.observe(c));
      if (el !== sc) ro.observe(el);
    };
    observarHijos();
    const mo = new MutationObserver(() => {
      observarHijos();
      revisar();
    });
    mo.observe(sc, { childList: true, subtree: true });

    const tocar = (e) => {
      armado = true;
      const t = e.target instanceof Element ? e.target : null;
      ancla = t?.closest("button, label, input, select, textarea, [role='button']") || t;
    };
    const teclear = () => {
      armado = true;
      if (document.activeElement && sc.contains(document.activeElement)) ancla = document.activeElement;
    };
    sc.addEventListener("pointerdown", tocar, true);
    sc.addEventListener("keydown", teclear, true);
    sc.addEventListener("paste", teclear, true);
    // Si la persona arrastra o usa la rueda, manda ella.
    sc.addEventListener("wheel", parar, { passive: true });
    sc.addEventListener("touchmove", parar, { passive: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
      sc.removeEventListener("pointerdown", tocar, true);
      sc.removeEventListener("keydown", teclear, true);
      sc.removeEventListener("paste", teclear, true);
      sc.removeEventListener("wheel", parar);
      sc.removeEventListener("touchmove", parar);
    };
  }, [ref, activo]);
}
