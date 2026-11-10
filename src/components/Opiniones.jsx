import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageSquareReply, Pencil, Trash2, EyeOff, Eye, ShieldCheck, Send, X } from "lucide-react";
import { Estrellas } from "./Estrellas";
import InsigniaReputacion from "./InsigniaReputacion";
import CalificarModal from "./CalificarModal";

/* Opiniones (fase 2 de Reportes y reputación) — MISMO archivo en Taxi-PE y
   Caja (src/components/Opiniones.jsx): mantener iguales.
   Resumen (promedio, barras 5★→1★, etiquetas), filtros por estrellas y la
   lista de comentarios ANÓNIMOS con sus botones:
     - quien lo escribió: Editar / Borrar (es_mio);
     - el calificado: Responder / editar o borrar su respuesta;
     - el admin: Ocultar / Mostrar.
   Props:
     resumen: { reputacion: {total, promedio, distribucion, etiqueta},
                etiquetas, puede_responder, puede_ocultar }
     cargar(estrellas|null, antes|null) → { data, error }
     acciones: { miCalificacion(item) → { data: {estrellas, comentario} },
                 guardar(item, estrellas, comentario), borrar(item),
                 responder(item, texto), ocultar(item, oculto) } → { error? }
     nombre: de quién son las opiniones; quienResponde: "el conductor"…
     servicios: { viaje: "Viaje", ... } (etiqueta del tipo de servicio)
     onCambio(): refrescar el resumen. */

const LIMITE = 15;
const FILTROS = [null, 5, 4, 3, 2, 1];

function fechaRelativa(f) {
  const d = (Date.now() - new Date(f).getTime()) / 1000;
  if (d < 60) return "hace un momento";
  if (d < 3600) return `hace ${Math.floor(d / 60)} min`;
  if (d < 86400) return `hace ${Math.floor(d / 3600)} h`;
  if (d < 86400 * 7) return `hace ${Math.floor(d / 86400)} d`;
  return new Date(f).toLocaleDateString("es-PE", { day: "numeric", month: "short", year: "numeric" });
}

function useContador(valor, dur = 900) {
  const [v, setV] = useState(0);
  const desde = useRef(0);
  useEffect(() => {
    const ini = desde.current;
    const fin = Number(valor || 0);
    let raf;
    const t0 = performance.now();
    const paso = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const actual = ini + (fin - ini) * (1 - Math.pow(1 - p, 3));
      setV(actual);
      desde.current = actual;
      if (p < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [valor, dur]);
  return v;
}

function Resumen({ resumen }) {
  const rep = resumen?.reputacion || {};
  const total = Number(rep.total || 0);
  const prom = useContador(total >= 3 ? rep.promedio : 0);
  const [dibujado, setDibujado] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDibujado(true), 200);
    return () => clearTimeout(t);
  }, []);
  const dist = rep.distribucion || {};
  const max = Math.max(1, ...[1, 2, 3, 4, 5].map((n) => Number(dist[n] || 0)));
  return (
    <div className="tz-op-resumen">
      <div className="tz-op-promedio">
        <strong>{total >= 3 ? prom.toFixed(1) : "—"}</strong>
        <Estrellas valor={total >= 3 ? prom : 0} size={20} />
        <span>{total === 1 ? "1 calificación" : `${total} calificaciones`}</span>
        <InsigniaReputacion rep={rep} etiquetas={resumen?.etiquetas || []} />
      </div>
      <ul className="tz-op-barras">
        {[5, 4, 3, 2, 1].map((n, i) => {
          const c = Number(dist[n] || 0);
          return (
            <li key={n}>
              <span>{n}★</span>
              <span className="tz-op-barra">
                <span style={{ width: dibujado ? `${(c / max) * 100}%` : 0, transitionDelay: `${i * 90}ms` }} />
              </span>
              <b>{c}</b>
            </li>
          );
        })}
      </ul>
      {total < 3 && <p className="tz-op-nota">Las estrellas se muestran desde la tercera calificación.</p>}
    </div>
  );
}

function Comentario({ item, i, resumen, acciones, servicios, quienResponde, onEditar, onRecargar }) {
  const [respondiendo, setRespondiendo] = useState(false);
  const [texto, setTexto] = useState(item.respuesta || "");
  const [ocupado, setOcupado] = useState(null);
  const [confirmar, setConfirmar] = useState(null);
  const [error, setError] = useState("");

  const correr = async (clave, fn) => {
    setOcupado(clave);
    setError("");
    const r = await fn();
    setOcupado(null);
    setConfirmar(null);
    if (r?.error) return setError(r.error.message || "No se pudo.");
    setRespondiendo(false);
    onRecargar();
  };

  return (
    <li className={`tz-op-item ${item.oculto ? "is-oculto" : ""}`} style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}>
      <div className="tz-op-item-cab">
        <span className="tz-op-autor"><ShieldCheck size={14} /> {item.autor}</span>
        <Estrellas valor={item.estrellas} size={13} />
        {servicios?.[item.servicio] && <span className="tz-op-servicio">{servicios[item.servicio]}</span>}
        <span className="tz-op-fecha">{fechaRelativa(item.fecha)}{item.editado ? " · editado" : ""}</span>
      </div>
      {item.comentario != null ? (
        <p className="tz-op-texto">{item.comentario}</p>
      ) : (
        <p className="tz-op-texto is-oculto"><EyeOff size={13} /> Comentario oculto por moderación.</p>
      )}
      {item.oculto && item.comentario != null && <p className="tz-op-aviso-oculto"><EyeOff size={12} /> Oculto para los demás</p>}

      {item.respuesta && !respondiendo && (
        <div className="tz-op-respuesta">
          <span><MessageSquareReply size={13} /> Respuesta de {quienResponde}</span>
          <p>{item.respuesta}</p>
        </div>
      )}
      {respondiendo && (
        <div className="tz-op-responder">
          <textarea value={texto} maxLength={280} rows={2} placeholder="Escribe tu respuesta" onChange={(e) => setTexto(e.target.value)} />
          <div>
            <small>{texto.length}/280</small>
            <button type="button" className="tz-op-btn" onClick={() => setRespondiendo(false)} disabled={!!ocupado}><X size={13} /> Cancelar</button>
            <button type="button" className="tz-op-btn is-principal" onClick={() => correr("responder", () => acciones.responder(item, texto))} disabled={!!ocupado || !texto.trim()}>
              {ocupado === "responder" ? <Loader2 size={13} className="tz-spin" /> : <Send size={13} />} Publicar
            </button>
          </div>
        </div>
      )}

      <div className="tz-op-acciones">
        {item.es_mio && (
          <>
            <button type="button" className="tz-op-btn" onClick={() => onEditar(item)} disabled={!!ocupado}><Pencil size={13} /> Editar</button>
            <button type="button" className={`tz-op-btn is-peligro ${confirmar === "borrar" ? "is-confirmar" : ""}`} disabled={!!ocupado}
              onClick={() => (confirmar === "borrar" ? correr("borrar", () => acciones.borrar(item)) : setConfirmar("borrar"))}>
              {ocupado === "borrar" ? <Loader2 size={13} className="tz-spin" /> : <Trash2 size={13} />}
              {confirmar === "borrar" ? "¿Borrar? Toca otra vez" : "Borrar"}
            </button>
          </>
        )}
        {resumen?.puede_responder && !respondiendo && (
          <>
            <button type="button" className="tz-op-btn" onClick={() => { setTexto(item.respuesta || ""); setRespondiendo(true); }} disabled={!!ocupado}>
              <MessageSquareReply size={13} /> {item.respuesta ? "Editar respuesta" : "Responder"}
            </button>
            {item.respuesta && (
              <button type="button" className={`tz-op-btn is-peligro ${confirmar === "respuesta" ? "is-confirmar" : ""}`} disabled={!!ocupado}
                onClick={() => (confirmar === "respuesta" ? correr("respuesta", () => acciones.responder(item, "")) : setConfirmar("respuesta"))}>
                {ocupado === "respuesta" ? <Loader2 size={13} className="tz-spin" /> : <Trash2 size={13} />}
                {confirmar === "respuesta" ? "¿Borrar respuesta?" : "Borrar respuesta"}
              </button>
            )}
          </>
        )}
        {resumen?.puede_ocultar && (
          <button type="button" className="tz-op-btn" onClick={() => correr("ocultar", () => acciones.ocultar(item, !item.oculto))} disabled={!!ocupado}>
            {ocupado === "ocultar" ? <Loader2 size={13} className="tz-spin" /> : item.oculto ? <Eye size={13} /> : <EyeOff size={13} />}
            {item.oculto ? "Mostrar" : "Ocultar"}
          </button>
        )}
      </div>
      {error && <p className="tz-op-error">{error}</p>}
    </li>
  );
}

export default function Opiniones({ resumen, cargar, acciones, nombre, quienResponde = "el calificado", servicios, onCambio }) {
  const [filtro, setFiltro] = useState(null);
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [hayMas, setHayMas] = useState(false);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState(null);

  const leer = useCallback(async (estrellas, antes) => {
    setCargando(true);
    const r = await cargar(estrellas, antes);
    setCargando(false);
    if (r?.error) return setError(r.error.message || "No se pudieron cargar las opiniones.");
    setError("");
    const data = Array.isArray(r?.data) ? r.data : [];
    setLista((l) => (antes ? [...l, ...data] : data));
    setHayMas(data.length >= LIMITE);
  }, [cargar]);

  useEffect(() => {
    leer(filtro, null);
  }, [filtro, leer]);

  const recargar = () => {
    leer(filtro, null);
    onCambio?.();
  };

  const editar = async (item) => {
    const r = await acciones.miCalificacion(item);
    if (r?.error) return setError(r.error.message || "No se pudo abrir.");
    setEditando({ item, inicial: { estrellas: r?.data?.estrellas || item.estrellas, comentario: r?.data?.comentario ?? item.comentario ?? "" } });
  };

  return (
    <div className="tz-op">
      <style>{ESTILO}</style>
      <Resumen resumen={resumen} />
      <div className="tz-op-filtros" role="tablist">
        {FILTROS.map((f) => (
          <button key={f ?? "todos"} type="button" role="tab" aria-selected={filtro === f}
            className={filtro === f ? "is-activo" : ""} onClick={() => setFiltro(f)}>
            {f == null ? "Todos" : `${f}★`}
          </button>
        ))}
      </div>
      {error && <p className="tz-op-error">{error}</p>}
      {!cargando && lista.length === 0 ? (
        <p className="tz-op-vacio">{filtro ? `Todavía no hay comentarios de ${filtro}★.` : `Todavía nadie dejó un comentario${nombre ? ` sobre ${nombre}` : ""}.`}</p>
      ) : (
        <ul className="tz-op-lista">
          {lista.map((item, i) => (
            <Comentario key={item.id} item={item} i={i} resumen={resumen} acciones={acciones} servicios={servicios}
              quienResponde={quienResponde} onEditar={editar} onRecargar={recargar} />
          ))}
        </ul>
      )}
      {cargando && <p className="tz-op-vacio"><Loader2 size={16} className="tz-spin" /></p>}
      {!cargando && hayMas && (
        <button type="button" className="tz-op-mas" onClick={() => leer(filtro, lista[lista.length - 1]?.fecha)}>Ver más</button>
      )}
      {editando && (
        <CalificarModal
          nombre={nombre}
          titulo="Editar tu calificación"
          inicial={editando.inicial}
          onEnviar={(e, c) => acciones.guardar(editando.item, e, c)}
          onBorrar={() => acciones.borrar(editando.item)}
          onCerrar={(ok) => { setEditando(null); if (ok) recargar(); }}
        />
      )}
    </div>
  );
}

const ESTILO = `
.tz-op { display: flex; flex-direction: column; gap: 12px; }
.tz-op-resumen { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr); gap: 14px; align-items: center; padding: 14px;
  border-radius: 18px; background: rgba(255,216,74,0.05); border: 1px solid rgba(255,216,74,0.25);
  animation: tz-op-in .55s cubic-bezier(.34,1.56,.64,1) both; }
@media (max-width: 480px) { .tz-op-resumen { grid-template-columns: minmax(0, 1fr); } }
.tz-op-promedio { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
.tz-op-promedio strong { font-size: 44px; line-height: 1; font-weight: 900; color: #ffd84a; text-shadow: 0 0 18px rgba(255,216,74,0.55);
  font-variant-numeric: tabular-nums; }
.tz-op-promedio > span { font-size: 12px; color: var(--text-dim, #9c93c2); }
.tz-op-barras { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.tz-op-barras li { display: grid; grid-template-columns: 26px 1fr 26px; align-items: center; gap: 8px; font-size: 12px; color: var(--text-dim, #9c93c2); }
.tz-op-barras b { color: var(--text, #f4f2ff); text-align: right; }
.tz-op-barra { height: 8px; border-radius: 99px; background: rgba(255,255,255,0.07); overflow: hidden; }
.tz-op-barra span { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, #ff9500, #ffd84a);
  box-shadow: 0 0 10px rgba(255,216,74,0.55); transition: width 1s cubic-bezier(.34,1.4,.64,1); }
.tz-op-nota { grid-column: 1 / -1; margin: 0; font-size: 11.5px; text-align: center; color: var(--text-dim, #9c93c2); }
.tz-op-filtros { display: flex; flex-wrap: wrap; gap: 6px; }
.tz-op-filtros button { border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: var(--text-dim, #9c93c2);
  font: inherit; font-size: 12.5px; font-weight: 800; padding: 6px 12px; border-radius: 999px; cursor: pointer;
  transition: color .25s ease, background .35s cubic-bezier(.34,1.56,.64,1), box-shadow .35s ease, transform .3s cubic-bezier(.34,1.56,.64,1); }
.tz-op-filtros button:hover { transform: translateY(-1px); color: var(--text, #f4f2ff); }
.tz-op-filtros button.is-activo { color: #1a1300; background: linear-gradient(110deg, #ffd84a, #ff9500); border-color: transparent;
  box-shadow: 0 0 14px rgba(255,216,74,0.45); }
.tz-op-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.tz-op-item { padding: 12px; border-radius: 16px; background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.09);
  animation: tz-op-in .5s cubic-bezier(.34,1.56,.64,1) both; transition: border-color .3s ease, transform .3s cubic-bezier(.34,1.56,.64,1); }
.tz-op-item:hover { border-color: rgba(255,216,74,0.3); transform: translateY(-1px); }
.tz-op-item.is-oculto { opacity: .7; border-style: dashed; }
.tz-op-item-cab { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.tz-op-autor { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 800; color: #39ffb0; }
.tz-op-servicio { font-size: 10.5px; font-weight: 800; padding: 1px 7px; border-radius: 999px; color: #2be8ff; background: rgba(43,232,255,0.1); }
.tz-op-fecha { margin-left: auto; font-size: 11px; color: var(--text-dim, #9c93c2); }
.tz-op-texto { margin: 8px 0 0; font-size: 14px; line-height: 1.45; color: var(--text, #f4f2ff); white-space: pre-wrap; overflow-wrap: anywhere; text-align: left; }
.tz-op-texto.is-oculto { display: flex; align-items: center; gap: 6px; font-style: italic; color: var(--text-dim, #9c93c2); }
.tz-op-aviso-oculto { display: flex; align-items: center; gap: 4px; margin: 4px 0 0; font-size: 11px; color: #ff9500; }
.tz-op-respuesta { margin-top: 10px; padding: 9px 11px; border-radius: 12px; border-left: 3px solid #2be8ff; background: rgba(43,232,255,0.06);
  animation: tz-op-in .45s cubic-bezier(.34,1.56,.64,1) both; text-align: left; }
.tz-op-respuesta span { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 800; color: #2be8ff; }
.tz-op-respuesta p { margin: 4px 0 0; font-size: 13.5px; color: var(--text, #f4f2ff); white-space: pre-wrap; overflow-wrap: anywhere; }
.tz-op-responder { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; animation: tz-op-in .4s cubic-bezier(.34,1.56,.64,1) both; }
.tz-op-responder textarea { width: 100%; box-sizing: border-box; resize: none; padding: 9px 11px; border-radius: 12px; font: inherit; font-size: 13.5px;
  color: var(--text, #f4f2ff); background: rgba(255,255,255,0.05); border: 1px solid rgba(43,232,255,0.35); outline: none; }
.tz-op-responder textarea:focus { box-shadow: 0 0 12px rgba(43,232,255,0.3); }
.tz-op-responder > div { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
.tz-op-responder small { margin-right: auto; font-size: 10.5px; color: var(--text-dim, #9c93c2); }
.tz-op-acciones { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.tz-op-acciones:empty { display: none; }
.tz-op-btn { display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 999px; cursor: pointer; font: inherit;
  font-size: 12px; font-weight: 800; color: var(--text-dim, #9c93c2); background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  transition: color .25s ease, border-color .25s ease, transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease; }
.tz-op-btn:hover:not(:disabled) { color: var(--text, #f4f2ff); border-color: rgba(43,232,255,0.45); transform: translateY(-1px); }
.tz-op-btn.is-principal { color: #06131a; background: linear-gradient(110deg, #2be8ff, #39ffb0); border-color: transparent; box-shadow: 0 0 12px rgba(43,232,255,0.4); }
.tz-op-btn.is-peligro:hover:not(:disabled), .tz-op-btn.is-confirmar { color: #ff5470; border-color: rgba(255,84,112,0.5); }
.tz-op-btn.is-confirmar { background: rgba(255,84,112,0.1); animation: tz-op-tiembla .45s ease both; }
.tz-op-btn:disabled { opacity: .55; cursor: default; }
.tz-op-error { margin: 4px 0 0; font-size: 12px; color: #ff5470; }
.tz-op-vacio { margin: 6px 0; display: flex; justify-content: center; font-size: 13px; color: var(--text-dim, #9c93c2); text-align: center; }
.tz-op-mas { align-self: center; padding: 8px 18px; border-radius: 999px; cursor: pointer; font: inherit; font-weight: 800; font-size: 13px;
  color: #ffd84a; background: rgba(255,216,74,0.08); border: 1px solid rgba(255,216,74,0.4);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease; }
.tz-op-mas:hover { transform: translateY(-2px); box-shadow: 0 0 14px rgba(255,216,74,0.4); }
@keyframes tz-op-in { from { opacity: 0; transform: translateY(12px) scale(.98); filter: blur(3px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes tz-op-tiembla { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-3px); } 75% { transform: translateX(3px); } }
`;
