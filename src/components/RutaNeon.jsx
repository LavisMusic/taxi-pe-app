import { useEffect, useId, useRef, useState } from "react";
import { Polyline, useMap } from "react-leaflet";
import L from "leaflet";

// Línea de ruta neón (paso 3 del bloque de delivery) — MISMO archivo en
// Taxi-PE (src/components/RutaNeon.jsx) y Caja (src/components/RutaNeon.jsx):
// mantener las dos copias iguales.
//
// Va DENTRO de un <MapContainer> de react-leaflet. Por ahora es una línea
// recta entre dos puntos (sin ruteo; la ruta real llega con Google):
//   - halo: el color del conductor, palpitando;
//   - núcleo: el degradado verde → celeste de GEMAS deslizándose;
//   - pulsos: puntitos de luz que viajan hacia el destino;
//   - previa (opcional): el tramo siguiente, tenue y punteado.
// `dibujoKey` (de useConexionRuta) hace que la línea se dibuje sola.
// className/interactive van como props propias: react-leaflet aplica
// pathOptions con setStyle, que no toca la clase ni lo interactivo.

const NS = "http://www.w3.org/2000/svg";
const DIBUJO_MS = 800;

// Secuencia de "conexión": al asignarse el servicio la línea se dibuja y
// los íconos se encienden uno tras otro (1 = conductor, 2 = su próximo
// punto, 3 = el tercero). `etapa` (p.ej. ya recogió) vuelve a dibujar la
// línea del nuevo tramo sin apagar las luces.
export function useConexionRuta(activo, etapa = 0) {
  const [luces, setLuces] = useState(0);
  const [dibujoKey, setDibujoKey] = useState(0);
  useEffect(() => {
    if (!activo) {
      setLuces(0);
      return undefined;
    }
    setLuces(1);
    const a = setTimeout(() => setLuces(2), DIBUJO_MS);
    const b = setTimeout(() => setLuces(3), DIBUJO_MS + 650);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [activo]);
  useEffect(() => {
    if (activo) setDibujoKey((k) => k + 1);
  }, [activo, etapa]);
  return { luces, dibujoKey };
}

// divIcon con la luz del conductor alrededor: aro que se expande al
// encenderse y un glow que respira. Llamar dentro de useMemo para que
// Leaflet no recree el ícono (y la animación) en cada tick de GPS.
export function divIconLuz({ className = "", html, iconSize, iconAnchor }, color, encendido) {
  return L.divIcon({
    className,
    html: `<div class="tz-luz${encendido ? " is-on" : ""}" style="--tz-luz:${color}">${html}</div>`,
    iconSize,
    iconAnchor,
  });
}

function aPar(p) {
  return [p.lat, p.lng];
}

export default function RutaNeon({ desde, hasta, previa = null, color = "#00e0ff", dibujoKey = 0 }) {
  const map = useMap();
  const gradId = `tz-ruta-grad-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const haloRef = useRef(null);
  const nucleoRef = useRef(null);
  const pulsosRef = useRef(null);
  const previaRef = useRef(null);
  const hay = !!(desde && hasta);
  const hayPrevia = !!(previa && previa[0] && previa[1]);
  useEstilos();

  // Degradado animado: un <linearGradient> en coordenadas del mapa que va
  // del inicio a la mitad de la línea (reflect = verde→celeste→verde) y
  // se traslada un período completo en loop. Se recalcula al hacer zoom
  // (los puntos de capa cambian) y cuando se mueven los extremos.
  useEffect(() => {
    if (!hay) return undefined;
    const path = nucleoRef.current?.getElement?.();
    const svg = path?.ownerSVGElement;
    if (!svg) return undefined;
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = document.createElementNS(NS, "defs");
      svg.insertBefore(defs, svg.firstChild);
    }
    let g = defs.querySelector(`#${gradId}`);
    if (!g) {
      g = document.createElementNS(NS, "linearGradient");
      g.setAttribute("id", gradId);
      g.setAttribute("gradientUnits", "userSpaceOnUse");
      g.setAttribute("spreadMethod", "reflect");
      [
        ["0", "#39ffb0"],
        ["1", "#2be8ff"],
      ].forEach(([offset, c]) => {
        const s = document.createElementNS(NS, "stop");
        s.setAttribute("offset", offset);
        s.setAttribute("stop-color", c);
        g.appendChild(s);
      });
      const anim = document.createElementNS(NS, "animateTransform");
      anim.setAttribute("attributeName", "gradientTransform");
      anim.setAttribute("type", "translate");
      anim.setAttribute("from", "0 0");
      anim.setAttribute("dur", "2.4s");
      anim.setAttribute("repeatCount", "indefinite");
      g.appendChild(anim);
      defs.appendChild(g);
    }
    const anim = g.querySelector("animateTransform");
    const actualizar = () => {
      const p1 = map.latLngToLayerPoint(aPar(desde));
      const p2 = map.latLngToLayerPoint(aPar(hasta));
      let dx = (p2.x - p1.x) / 2;
      let dy = (p2.y - p1.y) / 2;
      if (Math.abs(dx) + Math.abs(dy) < 1) dx = 20;
      g.setAttribute("x1", p1.x);
      g.setAttribute("y1", p1.y);
      g.setAttribute("x2", p1.x + dx);
      g.setAttribute("y2", p1.y + dy);
      // Hacia el destino: el brillo "viaja" en el mismo sentido que el conductor.
      anim.setAttribute("to", `${2 * dx} ${2 * dy}`);
    };
    actualizar();
    map.on("zoomend viewreset", actualizar);
    return () => {
      map.off("zoomend viewreset", actualizar);
    };
  }, [map, hay, gradId, desde?.lat, desde?.lng, hasta?.lat, hasta?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al desmontar se va también su degradado.
  useEffect(
    () => () => {
      document.getElementById(gradId)?.remove();
    },
    [gradId]
  );

  // La línea se dibuja sola (stroke-dashoffset del largo real del trazo);
  // pulsos y previa aparecen recién cuando terminó.
  useEffect(() => {
    if (!hay) return undefined;
    const trazos = [haloRef.current, nucleoRef.current].map((c) => c?.getElement?.()).filter(Boolean);
    const extras = [pulsosRef.current, previaRef.current].map((c) => c?.getElement?.()).filter(Boolean);
    const limpiar = () => {
      trazos.forEach((p) => {
        p.style.transition = "";
        p.style.strokeDasharray = "";
        p.style.strokeDashoffset = "";
      });
      extras.forEach((e) => e.classList.remove("tz-ruta-espera"));
    };
    extras.forEach((e) => e.classList.add("tz-ruta-espera"));
    trazos.forEach((p) => {
      const largo = p.getTotalLength ? p.getTotalLength() : 0;
      if (!largo) return;
      p.style.transition = "none";
      p.style.strokeDasharray = `${largo} ${largo}`;
      p.style.strokeDashoffset = `${largo}`;
      p.getBoundingClientRect();
      p.style.transition = `stroke-dashoffset ${DIBUJO_MS}ms cubic-bezier(.3,.7,.3,1)`;
      p.style.strokeDashoffset = "0";
    });
    const t = setTimeout(limpiar, DIBUJO_MS + 60);
    return () => {
      clearTimeout(t);
      limpiar();
    };
  }, [dibujoKey, hay]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hay) return null;
  const linea = [aPar(desde), aPar(hasta)];
  return (
    <>
      {hayPrevia && (
        <Polyline
          ref={previaRef}
          positions={[aPar(previa[0]), aPar(previa[1])]}
          className="tz-ruta-previa"
          interactive={false}
          pathOptions={{ color: "#2be8ff", weight: 3, opacity: 0.5, dashArray: "2 9" }}
        />
      )}
      <Polyline
        ref={haloRef}
        positions={linea}
        className="tz-ruta-halo"
          interactive={false}
          pathOptions={{ color, weight: 10, opacity: 0.35 }}
      />
      <Polyline
        ref={nucleoRef}
        positions={linea}
        className="tz-ruta-nucleo"
          interactive={false}
          pathOptions={{ color: `url(#${gradId})`, weight: 4, opacity: 1 }}
      />
      <Polyline
        ref={pulsosRef}
        positions={linea}
        className="tz-ruta-pulsos"
          interactive={false}
          pathOptions={{ color: "#f2feff", weight: 5, opacity: 0.95, dashArray: "1 22" }}
      />
    </>
  );
}

let estilosPuestos = false;
function useEstilos() {
  useEffect(() => {
    if (estilosPuestos) return;
    estilosPuestos = true;
    const s = document.createElement("style");
    s.setAttribute("data-tz", "ruta-neon");
    s.textContent = `
      .tz-ruta-halo { animation: tz-ruta-halo 1.6s ease-in-out infinite; }
      @keyframes tz-ruta-halo {
        0%, 100% { stroke-width: 8px; stroke-opacity: 0.22; }
        50% { stroke-width: 15px; stroke-opacity: 0.5; }
      }
      .tz-ruta-nucleo { filter: drop-shadow(0 0 3px rgba(43, 232, 255, 0.9)); }
      .tz-ruta-pulsos { animation: tz-ruta-pulsos 1s linear infinite; filter: drop-shadow(0 0 4px #ffffff); }
      @keyframes tz-ruta-pulsos { to { stroke-dashoffset: -23; } }
      .tz-ruta-previa { animation: tz-ruta-previa 2.4s linear infinite; }
      @keyframes tz-ruta-previa { to { stroke-dashoffset: -22; } }
      .tz-ruta-pulsos, .tz-ruta-previa { transition: opacity 0.5s ease; }
      .tz-ruta-espera { opacity: 0 !important; }

      .tz-luz { position: relative; isolation: isolate; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
      .tz-luz::before, .tz-luz::after { content: ""; position: absolute; border-radius: 50%; pointer-events: none; opacity: 0; }
      .tz-luz::before { inset: -9px; z-index: -1; background: radial-gradient(circle, var(--tz-luz) 0%, transparent 68%); }
      .tz-luz::after { inset: -2px; border: 2px solid var(--tz-luz); box-shadow: 0 0 10px var(--tz-luz); }
      .tz-luz.is-on::before { animation: tz-luz-respira 2.2s ease-in-out infinite; }
      .tz-luz.is-on::after { animation: tz-luz-aro 0.9s cubic-bezier(.2,.8,.3,1) 1; }
      .tz-luz.is-on > * { filter: drop-shadow(0 0 6px var(--tz-luz)); transition: filter 0.4s ease; }
      @keyframes tz-luz-aro {
        0% { transform: scale(0.6); opacity: 1; }
        100% { transform: scale(2.8); opacity: 0; }
      }
      @keyframes tz-luz-respira {
        0%, 100% { transform: scale(0.85); opacity: 0.35; }
        50% { transform: scale(1.2); opacity: 0.75; }
      }
      @media (prefers-reduced-motion: reduce) {
        .tz-ruta-halo, .tz-ruta-pulsos, .tz-ruta-previa, .tz-luz.is-on::before, .tz-luz.is-on::after { animation: none; }
      }
    `;
    document.head.appendChild(s);
  }, []);
}
