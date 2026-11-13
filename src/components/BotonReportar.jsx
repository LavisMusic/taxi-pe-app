import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Flag, Check, Loader2 } from "lucide-react";
import { ReportarModal } from "./MisReportes";

/* Botón "Reportar" fuera de Mi reputación (fase B de reportes) — MISMO
   archivo en Taxi-PE y Caja (src/components/BotonReportar.jsx): mantener
   iguales. Va en pleno viaje, mientras se espera al repartidor, en la
   página del conductor y en la hoja de estrellas de la tienda.
     leer()  → { data: item | null, error } — el servicio que se reportaría
               (ref, reportado_tipo, motivos, nombre, foto_url, detalle,
               fecha, reportado). null: no hay un servicio real con esa
               persona en los últimos 30 días → el botón queda apagado y
               lo explica.
     enviar(item, motivo, descripcion, archivo) → { error? }
     avisoDonde: el chat donde llega la respuesta ("Taxi PE", "Tonazo"). */
export default function BotonReportar({ leer, enviar, avisoDonde, texto = "Reportar", sinServicio, className = "" }) {
  const [item, setItem] = useState(undefined);
  const [abierto, setAbierto] = useState(false);
  // Globo de explicación: fuera de cualquier panel (portal), arriba o
  // abajo del botón según el espacio.
  const [explica, setExplica] = useState(null); // { left, top|bottom }
  const leerRef = useRef(leer);
  leerRef.current = leer;
  const clave = useRef(0);
  const vivo = useRef(true);
  const boton = useRef(null);

  // Devuelve el item leído (o null). Se vuelve a leer al tocar el botón
  // apagado: el servicio pudo empezar recién (p. ej. el viaje se aceptó
  // en pantalla antes que en la base).
  const consultar = useCallback(async () => {
    const n = ++clave.current;
    let valor = null;
    try {
      const r = await leerRef.current?.();
      valor = r?.error ? null : r?.data || null;
    } catch {
      valor = null;
    }
    if (vivo.current && n === clave.current) setItem(valor);
    return valor;
  }, []);

  useEffect(() => {
    vivo.current = true;
    consultar();
    return () => {
      vivo.current = false;
    };
  }, [consultar]);

  const mostrarExplicacion = () => {
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    const ancho = Math.min(240, window.innerWidth - 24);
    const left = Math.max(12, Math.min(r.left + r.width / 2 - ancho / 2, window.innerWidth - ancho - 12));
    const abajo = r.bottom + 80 < window.innerHeight;
    setExplica({ left, ancho, top: abajo ? r.bottom + 8 : null, bottom: abajo ? null : window.innerHeight - r.top + 8 });
  };

  useEffect(() => {
    if (!explica) return undefined;
    const t = setTimeout(() => setExplica(null), 3200);
    const cerrar = () => setExplica(null);
    window.addEventListener("scroll", cerrar, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", cerrar, true);
    };
  }, [explica]);

  if (item?.reportado) {
    return (
      <>
        <style>{ESTILO}</style>
        <span className={`tz-brep is-hecho ${className}`}>
          <Check size={13} /> Reportado
        </span>
      </>
    );
  }
  const apagado = item === null;
  return (
    <>
      <style>{ESTILO}</style>
      <span className="tz-brep-envoltura">
        <button
          type="button"
          ref={boton}
          className={`tz-brep ${apagado ? "is-apagado" : ""} ${className}`}
          aria-disabled={apagado || item === undefined}
          onClick={async (e) => {
            e.stopPropagation();
            if (item === undefined) return;
            if (apagado) {
              setItem(undefined);
              const nuevo = await consultar();
              if (!nuevo) mostrarExplicacion();
              else if (!nuevo.reportado) setAbierto(true);
              return;
            }
            setAbierto(true);
          }}
        >
          {item === undefined ? <Loader2 size={13} className="tz-spin" /> : <Flag size={13} />} {texto}
        </button>
        {explica &&
          createPortal(
            <span
              className={`tz-brep-explica ${explica.top != null ? "is-abajo" : "is-arriba"}`}
              role="status"
              style={{ left: explica.left, width: explica.ancho, top: explica.top ?? "auto", bottom: explica.bottom ?? "auto" }}
            >
              <style>{ESTILO}</style>
              {sinServicio || "Solo puedes reportar a quien te atendió en los últimos 30 días."}
            </span>,
            document.body
          )}
      </span>
      {abierto && item && (
        <ReportarModal
          item={item}
          avisoDonde={avisoDonde}
          onEnviar={(motivo, descripcion, archivo) => enviar(item, motivo, descripcion, archivo)}
          onCerrar={(listo) => {
            setAbierto(false);
            if (listo) setItem((x) => (x ? { ...x, reportado: true } : x));
          }}
        />
      )}
    </>
  );
}

const ESTILO = `
.tz-brep-envoltura { display: inline-flex; }
.tz-brep { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 6px 12px; border-radius: 999px;
  cursor: pointer; font: inherit; font-size: 12px; font-weight: 800; letter-spacing: .02em; white-space: nowrap;
  color: #ff5470; background: rgba(255,84,112,0.08); border: 1px solid rgba(255,84,112,0.5);
  box-shadow: 0 0 12px rgba(255,84,112,0.15);
  transition: transform .35s cubic-bezier(.34,1.56,.64,1), background .25s ease, color .25s ease, box-shadow .3s ease, opacity .25s ease;
  animation: tz-brep-in .5s cubic-bezier(.34,1.56,.64,1) both; }
.tz-brep:hover:not(.is-apagado):not(.is-hecho) { transform: translateY(-1px) scale(1.04); color: #fff;
  background: linear-gradient(110deg, #ff5470, #ff2f9e); box-shadow: 0 0 20px rgba(255,84,112,0.5); }
.tz-brep:active:not(.is-hecho) { transform: scale(.95); }
.tz-brep.is-apagado { opacity: .5; cursor: help; }
.tz-brep.is-hecho { cursor: default; color: var(--text-dim, #9c93c2); background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.15); box-shadow: none; }
.tz-brep-explica { position: fixed; z-index: 9800; box-sizing: border-box; padding: 9px 11px; border-radius: 12px;
  font-size: 12px; font-weight: 600; line-height: 1.35; text-align: center; white-space: normal; pointer-events: none;
  color: var(--text, #f4f2ff); background: var(--panel-solid, #140d28); border: 1px solid rgba(255,84,112,0.5);
  box-shadow: 0 0 20px rgba(255,84,112,0.3), 0 10px 26px rgba(0,0,0,0.45);
  animation: tz-brep-explica .45s cubic-bezier(.34,1.56,.64,1) both; }
.tz-brep-explica.is-abajo { transform-origin: top center; }
.tz-brep-explica.is-arriba { transform-origin: bottom center; }
@keyframes tz-brep-in { from { opacity: 0; transform: scale(.7); } to { opacity: 1; transform: none; } }
@keyframes tz-brep-explica { from { opacity: 0; transform: scale(.8) translateY(-4px); filter: blur(2px); } to { opacity: 1; transform: none; filter: none; } }
`;
