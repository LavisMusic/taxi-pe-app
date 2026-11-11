import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Star, Clock3, ListChecks, Pencil, Trash2, MessageSquareReply, EyeOff, PartyPopper, ChevronRight } from "lucide-react";
import { Estrellas } from "./Estrellas";
import InsigniaReputacion from "./InsigniaReputacion";
import CalificarModal from "./CalificarModal";
import { avisarCambioReputacion } from "../lib/reputacion";

/* "Mi reputación" (fase 3b de Reportes y reputación) — MISMO archivo en
   Taxi-PE y Caja (src/components/MiReputacionModal.jsx): mantener iguales.
   Pestañas: Mis estrellas / Por calificar / Las que di (editar y borrar).
   Cada app pone sus llamadas en `acciones`:
     resumen()             → { data: { reputacion, etiquetas, dadas }, error }
     pendientes()          → { data: [...], error }
     calificar(item, e, c) → { error? }   (calificar o editar)
     borrar(item)          → { error? }
     completar(items)?     → items (p. ej. el nombre del repartidor)
   titulos: { [calificado_tipo]: "¿Cómo te fue…?" }; extra: algo bajo las
   estrellas (el conductor: "Ver mi página"); descripcion: quién lo califica. */

const PESTANAS = [
  { id: "estrellas", label: "Mis estrellas", Icono: Star },
  { id: "pendientes", label: "Por calificar", Icono: Clock3 },
  { id: "dadas", label: "Las que di", Icono: ListChecks },
];
const DIA = 86400000;
const claveDe = (p) => `${p.ref}|${p.calificado_tipo}`;
const fechaCorta = (f) => new Date(f).toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" });
const diasQuedan = (f) => Math.max(0, 7 - Math.floor((Date.now() - new Date(f).getTime()) / DIA));

function Avatar({ foto, nombre }) {
  const [rota, setRota] = useState(false);
  if (foto && !rota) return <img className="tz-mirep-avatar" src={foto} alt="" onError={() => setRota(true)} />;
  return <span className="tz-mirep-avatar is-letra">{(nombre || "?").replace(/^@/, "").slice(0, 1).toUpperCase()}</span>;
}

export default function MiReputacionModal({ acciones, titulos = {}, extra = null, descripcion = "", pestanaInicial = "estrellas", onClose }) {
  const [pestana, setPestana] = useState(pestanaInicial);
  const [resumen, setResumen] = useState(null);
  const [pendientes, setPendientes] = useState(null);
  const [error, setError] = useState("");
  const [abierta, setAbierta] = useState(null); // { item, editar }
  const [confirmar, setConfirmar] = useState(null);
  const [saliendo, setSaliendo] = useState({});
  const [dibujado, setDibujado] = useState(false);
  const accionesRef = useRef(acciones);
  accionesRef.current = acciones;

  const cargar = useCallback(async () => {
    const a = accionesRef.current;
    const [r, p] = await Promise.all([a.resumen(), a.pendientes()]);
    if (r.error) setError(r.error.message || "No se pudo leer tu reputación.");
    else {
      const dadas = Array.isArray(r.data?.dadas) ? r.data.dadas : [];
      setResumen({ ...r.data, dadas: a.completar ? await a.completar(dadas) : dadas });
      setTimeout(() => setDibujado(true), 140);
    }
    if (!p.error) {
      const lista = Array.isArray(p.data) ? p.data : [];
      setPendientes(a.completar ? await a.completar(lista) : lista);
    } else setPendientes([]);
  }, []);

  useEffect(() => {
    cargar();
    window.addEventListener("tz-reputacion-cambio", cargar);
    return () => window.removeEventListener("tz-reputacion-cambio", cargar);
  }, [cargar]);

  useEffect(() => {
    if (!confirmar) return undefined;
    const t = setTimeout(() => setConfirmar(null), 3200);
    return () => clearTimeout(t);
  }, [confirmar]);

  const borrarDirecto = async (item) => {
    const k = claveDe(item);
    if (confirmar !== k) return setConfirmar(k);
    setConfirmar(null);
    const r = await accionesRef.current.borrar(item);
    if (r?.error) return setError(r.error.message || "No se pudo borrar.");
    setSaliendo((s) => ({ ...s, [k]: true }));
    setTimeout(() => {
      setResumen((res) => (res ? { ...res, dadas: res.dadas.filter((d) => claveDe(d) !== k) } : res));
      setSaliendo((s) => {
        const { [k]: _, ...resto } = s;
        return resto;
      });
      avisarCambioReputacion();
    }, 420);
  };

  const enviar = async (estrellas, comentario) => {
    const { item } = abierta;
    const r = await accionesRef.current.calificar(item, estrellas, comentario || null);
    if (r?.error) return r;
    const k = claveDe(item);
    setPendientes((l) => (l || []).filter((p) => claveDe(p) !== k));
    setResumen((res) =>
      res ? { ...res, dadas: res.dadas.map((d) => (claveDe(d) === k ? { ...d, estrellas, comentario: comentario || null, editada: true } : d)) } : res
    );
    return {};
  };

  const cerrarCalificar = (hecho) => {
    setAbierta(null);
    if (hecho) avisarCambioReputacion();
  };

  const rep = resumen?.reputacion || {};
  const dist = rep.distribucion || {};
  const max = Math.max(1, ...[1, 2, 3, 4, 5].map((n) => Number(dist[n] || 0)));
  const idx = PESTANAS.findIndex((p) => p.id === pestana);
  const nPend = pendientes?.length || 0;

  return createPortal(
    <div className="tz-mirep-fondo" onClick={onClose}>
      <style>{ESTILO}</style>
      <div className="tz-mirep" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Mi reputación">
        <button type="button" className="tz-mirep-cerrar" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <h3 className="tz-mirep-titulo"><Star size={18} /> Mi reputación</h3>

        <div className="tz-mirep-tabs" role="tablist" style={{ "--i": idx }}>
          <span className="tz-mirep-tabs-luz" aria-hidden="true" />
          {PESTANAS.map(({ id, label, Icono }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={pestana === id}
              className={`tz-mirep-tab ${pestana === id ? "is-activa" : ""}`}
              onClick={() => setPestana(id)}
            >
              <Icono size={15} />
              <span>{label}</span>
              {id === "pendientes" && nPend > 0 && <b className="tz-mirep-tab-num">{nPend > 9 ? "+9" : nPend}</b>}
            </button>
          ))}
        </div>

        {error && <p className="tz-mirep-error">{error}</p>}

        <div className="tz-mirep-cuerpo" key={pestana}>
          {pestana === "estrellas" &&
            (!resumen ? (
              <Loader2 size={22} className="tz-spin tz-mirep-carga" />
            ) : (
              <div className="tz-mirep-estrellas">
                <div className="tz-mirep-rep">
                  <div className="tz-mirep-prom">
                    <strong>{rep.total >= 3 ? Number(rep.promedio).toFixed(1) : "—"}</strong>
                    <Estrellas valor={rep.total >= 3 ? rep.promedio : 0} size={17} />
                    <span>{rep.total === 1 ? "1 calificación" : `${rep.total || 0} calificaciones`}</span>
                  </div>
                  <ul className="tz-mirep-barras">
                    {[5, 4, 3, 2, 1].map((n, i) => (
                      <li key={n}>
                        <span>{n}★</span>
                        <span className="tz-mirep-barra">
                          <span style={{ width: dibujado ? `${(Number(dist[n] || 0) / max) * 100}%` : 0, transitionDelay: `${i * 80}ms` }} />
                        </span>
                        <b>{Number(dist[n] || 0)}</b>
                      </li>
                    ))}
                  </ul>
                </div>
                <InsigniaReputacion rep={rep} etiquetas={resumen.etiquetas || []} mostrar="etiquetas" />
                {rep.total < 3 && (
                  <p className="tz-mirep-nota">Tus estrellas se muestran a los demás desde la 3.ª calificación.</p>
                )}
                {descripcion && <p className="tz-mirep-nota">{descripcion}</p>}
                {extra}
              </div>
            ))}

          {pestana === "pendientes" &&
            (!pendientes ? (
              <Loader2 size={22} className="tz-spin tz-mirep-carga" />
            ) : !pendientes.length ? (
              <div className="tz-mirep-vacio">
                <PartyPopper size={30} />
                <p>Nada por calificar. ¡Estás al día!</p>
              </div>
            ) : (
              <ul className="tz-mirep-lista">
                {pendientes.map((p, i) => {
                  const quedan = diasQuedan(p.fecha);
                  return (
                    <li key={claveDe(p)} className="tz-mirep-item" style={{ "--d": `${i * 55}ms` }}>
                      <div className="tz-mirep-item-cab">
                        <Avatar foto={p.foto_url} nombre={p.nombre} />
                        <div className="tz-mirep-info">
                          <b>{p.nombre}</b>
                          <span>{[p.detalle, fechaCorta(p.fecha)].filter(Boolean).join(" · ")}</span>
                          <span className={`tz-mirep-vence ${quedan <= 2 ? "is-pronto" : ""}`}>
                            {quedan <= 0 ? "Vence hoy" : quedan === 1 ? "Queda 1 día" : `Quedan ${quedan} días`}
                          </span>
                        </div>
                        <button type="button" className="tz-mirep-btn is-calificar" onClick={() => setAbierta({ item: p })}>
                          <Star size={14} /> Calificar
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ))}

          {pestana === "dadas" &&
            (!resumen ? (
              <Loader2 size={22} className="tz-spin tz-mirep-carga" />
            ) : !resumen.dadas.length ? (
              <div className="tz-mirep-vacio">
                <ListChecks size={30} />
                <p>Todavía no calificaste a nadie.</p>
              </div>
            ) : (
              <ul className="tz-mirep-lista">
                {resumen.dadas.map((d, i) => {
                  const k = claveDe(d);
                  return (
                    <li key={k} className={`tz-mirep-item is-dada ${saliendo[k] ? "is-saliendo" : ""}`} style={{ "--d": `${Math.min(i, 12) * 55}ms` }}>
                      <div className="tz-mirep-item-cab">
                        <Avatar foto={d.foto_url} nombre={d.nombre} />
                        <div className="tz-mirep-info">
                          <b>{d.nombre}</b>
                          <span>
                            {[d.detalle, fechaCorta(d.fecha)].filter(Boolean).join(" · ")}
                            {d.editada ? " · editada" : ""}
                          </span>
                          <Estrellas valor={d.estrellas} size={14} />
                        </div>
                      </div>
                      {d.comentario && <p className="tz-mirep-coment">“{d.comentario}”</p>}
                      {d.oculto_por && (
                        <p className="tz-mirep-oculto">
                          <EyeOff size={13} /> Comentario oculto por {d.oculto_por === "admin" ? "la moderación" : d.nombre}. Tus estrellas siguen contando.
                        </p>
                      )}
                      {d.respuesta && (
                        <div className="tz-mirep-resp">
                          <b><MessageSquareReply size={13} /> Respuesta de {d.nombre}</b>
                          <p>{d.respuesta}</p>
                        </div>
                      )}
                      <div className="tz-mirep-acciones">
                        <button type="button" className="tz-mirep-btn" onClick={() => setAbierta({ item: d, editar: true })}>
                          <Pencil size={13} /> Editar
                        </button>
                        <button
                          type="button"
                          className={`tz-mirep-btn is-borrar ${confirmar === k ? "is-confirmar" : ""}`}
                          onClick={() => borrarDirecto(d)}
                        >
                          <Trash2 size={13} /> {confirmar === k ? "¿Borrar? Toca otra vez" : "Borrar"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ))}
        </div>
      </div>

      {abierta && (
        <CalificarModal
          key={claveDe(abierta.item)}
          nombre={abierta.item.nombre}
          foto={abierta.item.foto_url}
          titulo={titulos[abierta.item.calificado_tipo] || "¿Cómo te fue?"}
          detalle={[abierta.item.detalle, fechaCorta(abierta.item.fecha)].filter(Boolean).join(" · ")}
          inicial={abierta.editar ? { estrellas: abierta.item.estrellas, comentario: abierta.item.comentario || "" } : undefined}
          onBorrar={abierta.editar ? () => accionesRef.current.borrar(abierta.item) : undefined}
          onEnviar={enviar}
          onCerrar={cerrarCalificar}
        />
      )}
    </div>,
    document.body
  );
}

/* Tarjeta "Mi reputación" para el modal "Mi perfil" (fase 3b, opción A):
   resumen (promedio, estrellas, total, etiquetas) y pendientes; al tocarla
   se abre MiReputacionModal. resumen: { reputacion, etiquetas } o null
   mientras carga. */
export function TarjetaReputacion({ resumen, pendientes = 0, onAbrir }) {
  const rep = resumen?.reputacion || {};
  const total = Number(rep.total || 0);
  return (
    <button type="button" className={`tz-mirep-tarjeta ${pendientes > 0 ? "is-pendientes" : ""}`} onClick={onAbrir}>
      <style>{ESTILO_TARJETA}</style>
      <span className="tz-mirep-tarjeta-prom">
        {resumen ? (
          <>
            <strong>{total >= 3 ? Number(rep.promedio).toFixed(1) : "—"}</strong>
            <Estrellas valor={total >= 3 ? rep.promedio : 0} size={12} />
          </>
        ) : (
          <Loader2 size={20} className="tz-spin" />
        )}
      </span>
      <span className="tz-mirep-tarjeta-info">
        <b><Star size={14} /> Mi reputación</b>
        <small>{resumen ? (total === 1 ? "1 calificación" : `${total} calificaciones`) : "Cargando…"}</small>
        {resumen && <InsigniaReputacion rep={rep} etiquetas={resumen.etiquetas || []} tamano="chico" mostrar="etiquetas" />}
      </span>
      <span className="tz-mirep-tarjeta-fin">
        {pendientes > 0 && <span className="tz-mirep-tarjeta-pend">{pendientes} por calificar</span>}
        <ChevronRight size={18} className="tz-mirep-tarjeta-flecha" />
      </span>
    </button>
  );
}

const ESTILO_TARJETA = `
.tz-mirep-tarjeta { box-sizing: border-box; width: 100%; margin-top: 12px; display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 14px;
  border-radius: 18px; cursor: pointer; font: inherit; text-align: left; color: var(--text);
  background: linear-gradient(120deg, rgba(255,216,74,0.1), rgba(255,149,0,0.05)); border: 1px solid rgba(255,216,74,0.4);
  box-shadow: 0 0 18px rgba(255,216,74,0.12);
  animation: tz-mirep-tarjeta-in .6s .15s cubic-bezier(.34,1.56,.64,1) both;
  transition: transform .35s cubic-bezier(.34,1.56,.64,1), box-shadow .35s ease, border-color .35s ease; }
.tz-mirep-tarjeta:hover { transform: translateY(-2px); border-color: rgba(255,216,74,0.75); box-shadow: 0 0 26px rgba(255,216,74,0.3); }
.tz-mirep-tarjeta:hover .tz-mirep-tarjeta-flecha { transform: translateX(4px); }
.tz-mirep-tarjeta.is-pendientes { animation: tz-mirep-tarjeta-in .6s .15s cubic-bezier(.34,1.56,.64,1) both, tz-mirep-tarjeta-late 2.4s 1s ease-in-out infinite; }
.tz-mirep-tarjeta-prom { flex-shrink: 0; min-width: 62px; display: flex; flex-direction: column; align-items: center; gap: 3px; color: #ffd84a; }
.tz-mirep-tarjeta-prom strong { font-size: 26px; line-height: 1; color: #ffd84a; text-shadow: 0 0 14px rgba(255,216,74,0.55); }
.tz-mirep-tarjeta-info { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
.tz-mirep-tarjeta-info b { display: inline-flex; align-items: center; gap: 6px; font-size: 14.5px; color: #ffd84a; }
.tz-mirep-tarjeta-info b svg { fill: #ffd84a; }
.tz-mirep-tarjeta-info small { font-size: 11.5px; color: var(--text-dim); }
.tz-mirep-tarjeta-fin { flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.tz-mirep-tarjeta-pend { padding: 3px 9px; border-radius: 999px; white-space: nowrap; font-size: 11px; font-weight: 900; color: #1a1300;
  background: linear-gradient(110deg, #ffd84a, #ff9500); box-shadow: 0 0 12px rgba(255,216,74,0.6);
  animation: tz-mirep-tarjeta-pop .55s .4s cubic-bezier(.34,1.56,.64,1) both; }
.tz-mirep-tarjeta-flecha { color: #ffd84a; transition: transform .35s cubic-bezier(.34,1.56,.64,1); }
@keyframes tz-mirep-tarjeta-in { from { opacity: 0; transform: translateY(14px) scale(.94); } to { opacity: 1; transform: none; } }
@keyframes tz-mirep-tarjeta-pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: none; } }
@keyframes tz-mirep-tarjeta-late { 0%, 100% { box-shadow: 0 0 16px rgba(255,216,74,0.18); } 50% { box-shadow: 0 0 30px rgba(255,216,74,0.5); } }
`;

const ESTILO = `
.tz-mirep-fondo { position: fixed; inset: 0; z-index: 8900; display: grid; place-items: center; padding: 16px;
  background: rgba(5,3,12,0.7); backdrop-filter: blur(6px); animation: tz-mirep-fade .3s ease both; }
.tz-mirep *, .tz-mirep *::before, .tz-mirep *::after { box-sizing: border-box; }
.tz-mirep { position: relative; width: min(460px, 100%); height: min(620px, 92vh); display: flex; flex-direction: column; gap: 10px;
  padding: 18px 16px 16px; border-radius: 24px; color: var(--text); background: var(--panel-solid, #140d28);
  border: 1px solid rgba(255,216,74,0.35); box-shadow: 0 0 36px rgba(255,216,74,0.18);
  animation: tz-mirep-in .55s cubic-bezier(.34,1.56,.64,1) both; }
.tz-mirep-cerrar { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border-radius: 50%; border: 0; cursor: pointer;
  display: grid; place-items: center; color: var(--text-dim); background: rgba(255,255,255,0.06); transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
.tz-mirep-cerrar:hover { transform: rotate(90deg); }
.tz-mirep-titulo { margin: 0; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 18px; color: #ffd84a;
  text-shadow: 0 0 14px rgba(255,216,74,0.45); }
.tz-mirep-titulo svg { fill: #ffd84a; }
.tz-mirep-tabs { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); padding: 4px; border-radius: 16px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
.tz-mirep-tabs-luz { position: absolute; top: 4px; bottom: 4px; left: 4px; width: calc((100% - 8px) / 3); border-radius: 12px;
  background: linear-gradient(110deg, rgba(255,216,74,0.22), rgba(255,149,0,0.18)); border: 1px solid rgba(255,216,74,0.5);
  box-shadow: 0 0 16px rgba(255,216,74,0.3); transform: translateX(calc(var(--i) * 100%));
  transition: transform .5s cubic-bezier(.34,1.56,.64,1); }
.tz-mirep-tab { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 0;
  padding: 9px 4px; border: 0; background: transparent; cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 800;
  color: var(--text-dim); transition: color .3s ease; }
.tz-mirep-tab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tz-mirep-tab svg { flex-shrink: 0; }
.tz-mirep-tab.is-activa { color: #ffd84a; }
.tz-mirep-tab-num { min-width: 18px; height: 18px; padding: 0 4px; border-radius: 999px; display: grid; place-items: center; flex-shrink: 0;
  font-size: 10.5px; color: #1a1300; background: linear-gradient(110deg, #ffd84a, #ff9500); box-shadow: 0 0 10px rgba(255,216,74,0.6);
  animation: tz-mirep-pop .5s cubic-bezier(.34,1.56,.64,1) both; }
.tz-mirep-error { margin: 0; text-align: center; font-size: 13px; color: var(--danger, #ff5470); }
.tz-mirep-cuerpo { flex: 1; min-height: 0; overflow: hidden auto; scrollbar-width: none; margin: 0 -6px; padding: 4px 6px 6px;
  animation: tz-mirep-cambio .45s cubic-bezier(.34,1.56,.64,1) both; }
.tz-mirep-cuerpo::-webkit-scrollbar { display: none; }
.tz-mirep-carga { display: block; margin: 50px auto; color: #ffd84a; }
.tz-mirep-estrellas { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
.tz-mirep-rep { width: 100%; display: grid; grid-template-columns: minmax(0, .8fr) minmax(0, 1.2fr); gap: 10px; align-items: center; padding: 12px;
  border-radius: 16px; background: rgba(255,216,74,0.05); border: 1px solid rgba(255,216,74,0.22); }
.tz-mirep-prom { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.tz-mirep-prom strong { font-size: 36px; line-height: 1; color: #ffd84a; text-shadow: 0 0 16px rgba(255,216,74,0.55);
  animation: tz-mirep-pop .7s .1s cubic-bezier(.34,1.56,.64,1) both; }
.tz-mirep-prom span { font-size: 11.5px; color: var(--text-dim); }
.tz-mirep-barras { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.tz-mirep-barras li { display: grid; grid-template-columns: 24px 1fr 22px; align-items: center; gap: 6px; font-size: 11px; color: var(--text-dim); }
.tz-mirep-barras b { color: var(--text); text-align: right; }
.tz-mirep-barra { height: 7px; border-radius: 99px; background: rgba(255,255,255,0.07); overflow: hidden; }
.tz-mirep-barra span { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, #ff9500, #ffd84a);
  box-shadow: 0 0 8px rgba(255,216,74,0.5); transition: width 1s cubic-bezier(.34,1.4,.64,1); }
.tz-mirep-nota { margin: 0; font-size: 12.5px; color: var(--text-dim); }
.tz-mirep-vacio { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 40px 10px; color: var(--text-dim); text-align: center; }
.tz-mirep-vacio svg { color: #ffd84a; filter: drop-shadow(0 0 8px rgba(255,216,74,0.5)); animation: tz-mirep-pop .6s cubic-bezier(.34,1.56,.64,1) both; }
.tz-mirep-vacio p { margin: 0; font-size: 13.5px; }
.tz-mirep-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.tz-mirep-item { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 16px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  animation: tz-mirep-item .5s var(--d) cubic-bezier(.34,1.56,.64,1) both;
  transition: opacity .4s ease, transform .4s cubic-bezier(.55,0,.45,1), max-height .4s ease, padding .4s ease, margin .4s ease;
  max-height: 600px; }
.tz-mirep-item.is-saliendo { animation: none; opacity: 0; transform: translateX(40px) scale(.9); max-height: 0; padding-top: 0; padding-bottom: 0; margin-bottom: -8px; overflow: hidden; }
.tz-mirep-item-cab { display: flex; align-items: center; gap: 10px; min-width: 0; }
.tz-mirep-avatar { width: 42px; height: 42px; flex-shrink: 0; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,216,74,0.6);
  box-shadow: 0 0 12px rgba(255,216,74,0.3); background: #0d0820; }
.tz-mirep-avatar.is-letra { display: grid; place-items: center; font-size: 18px; font-weight: 900; color: #ffd84a; }
.tz-mirep-info { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.tz-mirep-info b { max-width: 100%; font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tz-mirep-info > span { max-width: 100%; font-size: 11.5px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tz-mirep-vence { font-weight: 800; color: #39ffb0 !important; }
.tz-mirep-vence.is-pronto { color: #ff9500 !important; }
.tz-mirep-btn { display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; padding: 7px 12px; border-radius: 999px; cursor: pointer;
  font: inherit; font-size: 12.5px; font-weight: 800; color: #2be8ff; background: rgba(43,232,255,0.08); border: 1px solid rgba(43,232,255,0.4);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease, background .3s ease, color .3s ease, border-color .3s ease; }
.tz-mirep-btn:hover { transform: translateY(-2px); box-shadow: 0 0 14px rgba(43,232,255,0.4); }
.tz-mirep-btn.is-calificar { color: #1a1300; border: 0; background: linear-gradient(110deg, #ffd84a, #ff9500); box-shadow: 0 0 14px rgba(255,216,74,0.45); }
.tz-mirep-btn.is-calificar svg { fill: #fff7cc; }
.tz-mirep-btn.is-borrar { color: #ff5470; background: rgba(255,84,112,0.07); border-color: rgba(255,84,112,0.4); }
.tz-mirep-btn.is-borrar:hover { box-shadow: 0 0 14px rgba(255,84,112,0.4); }
.tz-mirep-btn.is-confirmar { color: #fff; background: #ff5470; border-color: #ff5470; box-shadow: 0 0 16px rgba(255,84,112,0.6);
  animation: tz-mirep-latido .8s ease-in-out infinite; }
.tz-mirep-coment { margin: 0; padding: 0 2px; font-size: 13px; line-height: 1.4; color: var(--text); overflow-wrap: anywhere; }
.tz-mirep-oculto { margin: 0; display: flex; align-items: center; gap: 6px; padding: 6px 9px; border-radius: 10px; font-size: 11.5px;
  color: #ff9500; background: rgba(255,149,0,0.08); border: 1px dashed rgba(255,149,0,0.4); }
.tz-mirep-oculto svg { flex-shrink: 0; }
.tz-mirep-resp { padding: 7px 10px; border-radius: 12px; border-left: 3px solid #2be8ff; background: rgba(43,232,255,0.06); }
.tz-mirep-resp b { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: #2be8ff; }
.tz-mirep-resp p { margin: 3px 0 0; font-size: 12.5px; color: var(--text); overflow-wrap: anywhere; }
.tz-mirep-acciones { display: flex; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
.tz-mirep-pagina { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: 999px; cursor: pointer;
  font: inherit; font-weight: 800; font-size: 13px; color: #2be8ff; background: rgba(43,232,255,0.08); border: 1px solid rgba(43,232,255,0.4);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease; }
.tz-mirep-pagina:hover { transform: translateY(-2px); box-shadow: 0 0 14px rgba(43,232,255,0.4); }
@media (max-width: 420px) { .tz-mirep-tab { font-size: 11.5px; gap: 4px; } .tz-mirep-tab svg { display: none; } }
@keyframes tz-mirep-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes tz-mirep-in { from { opacity: 0; transform: translateY(18px) scale(.92); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes tz-mirep-cambio { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes tz-mirep-item { from { opacity: 0; transform: translateY(14px) scale(.95); } to { opacity: 1; transform: none; } }
@keyframes tz-mirep-pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: none; } }
@keyframes tz-mirep-latido { 0%, 100% { box-shadow: 0 0 10px rgba(255,84,112,0.5); } 50% { box-shadow: 0 0 22px rgba(255,84,112,0.9); } }
`;
