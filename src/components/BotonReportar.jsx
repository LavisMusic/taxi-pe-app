import { useEffect, useRef, useState } from "react";
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
  const [explica, setExplica] = useState(false);
  const leerRef = useRef(leer);
  leerRef.current = leer;
  const clave = useRef(0);

  useEffect(() => {
    let vivo = true;
    const n = ++clave.current;
    Promise.resolve(leerRef.current?.())
      .then((r) => vivo && n === clave.current && setItem(r?.error ? null : r?.data || null))
      .catch(() => vivo && setItem(null));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (!explica) return undefined;
    const t = setTimeout(() => setExplica(false), 3200);
    return () => clearTimeout(t);
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
          className={`tz-brep ${apagado ? "is-apagado" : ""} ${className}`}
          aria-disabled={apagado || item === undefined}
          onClick={(e) => {
            e.stopPropagation();
            if (item === undefined) return;
            if (apagado) return setExplica(true);
            setAbierto(true);
          }}
        >
          {item === undefined ? <Loader2 size={13} className="tz-spin" /> : <Flag size={13} />} {texto}
        </button>
        {explica && (
          <span className="tz-brep-explica" role="status">
            {sinServicio || "Solo puedes reportar a quien te atendió en los últimos 30 días."}
          </span>
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
.tz-brep-envoltura { position: relative; display: inline-flex; }
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
.tz-brep-explica { position: absolute; z-index: 30; top: calc(100% + 6px); right: 0; width: max-content; max-width: min(230px, 80vw);
  padding: 8px 10px; border-radius: 12px; font-size: 11.5px; font-weight: 600; line-height: 1.35; text-align: center; white-space: normal;
  color: var(--text, #f4f2ff); background: var(--panel-solid, #140d28); border: 1px solid rgba(255,84,112,0.45);
  box-shadow: 0 0 18px rgba(255,84,112,0.25); transform-origin: top right;
  animation: tz-brep-explica .45s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes tz-brep-in { from { opacity: 0; transform: scale(.7); } to { opacity: 1; transform: none; } }
@keyframes tz-brep-explica { from { opacity: 0; transform: scale(.8); } to { opacity: 1; transform: scale(1); } }
`;
