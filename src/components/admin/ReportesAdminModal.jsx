import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Flag, ShieldAlert, ShieldCheck, Eye, Gavel, Ban, Clock3, CheckCircle2, AlertTriangle, Undo2, Phone, Car, User, Store, Bike } from "lucide-react";
import { useUrlVisible } from "../../lib/imagenesPrivadas";
import { Estrellas } from "../Estrellas";
import InsigniaReputacion from "../InsigniaReputacion";
import { textoMotivo } from "../MisReportes";

/* Centro de reportes (fase 4) — MISMO archivo en Taxi-PE y Caja
   (src/components/admin/ReportesAdminModal.jsx): mantener iguales.
   Taxi-PE: el Admin, reportes de viajes (pasajero ↔ conductor). Caja: el
   superadmin, reportes de pedidos y compras (cliente ↔ negocio).
   Estados nuevo → en revisión → resuelto/cerrado; al resolver: sin acción,
   advertencia, suspensión X días o bloqueo. Quien reportó recibe el
   resultado en su chat fijado; el reportado, solo la medida (sin saber
   quién lo reportó).
   api = {
     listar(estado|null)                       → { data: { reportes, conteo }, error }
     resolver({ p_id, p_estado, p_accion, p_dias, p_respuesta }) → { error }
     levantar(sancionId)                        → { error }
   } */

const FILTROS = [
  { id: "nuevo", label: "Nuevos" },
  { id: "en_revision", label: "En revisión" },
  { id: "resuelto", label: "Resueltos" },
  { id: "descartado", label: "Cerrados" },
  { id: null, label: "Todos" },
];
const ESTADO = {
  nuevo: { label: "Nuevo", Icono: Flag },
  en_revision: { label: "En revisión", Icono: Clock3 },
  resuelto: { label: "Resuelto", Icono: CheckCircle2 },
  descartado: { label: "Cerrado", Icono: CheckCircle2 },
};
const ACCIONES = [
  { id: "sin_accion", label: "Sin acción", Icono: ShieldCheck },
  { id: "advertencia", label: "Advertencia", Icono: AlertTriangle },
  { id: "suspension", label: "Suspensión", Icono: Clock3 },
  { id: "bloqueo", label: "Bloqueo", Icono: Ban },
];
const DIAS = [1, 3, 7, 15, 30];
const TIPO = { conductor: "Conductor", pasajero: "Pasajero", negocio: "Negocio", cliente: "Cliente", repartidor: "Repartidor" };
const ICONO_TIPO = { conductor: Car, negocio: Store, repartidor: Bike };
const SERVICIO = { viaje: "Viaje", entrega: "Reparto", pedido: "Pedido", compra: "Compra en tienda" };
const fecha = (f) =>
  f ? new Date(f).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

// Cuántos reportes hay por estado (el número del botón). listar: api.listar.
export function useConteoReportes(listar) {
  const [conteo, setConteo] = useState(null);
  const leer = useCallback(() => {
    if (!listar) return;
    Promise.resolve(listar("nuevo")).then(({ data, error }) => {
      if (!error && data?.conteo) setConteo(data.conteo);
    });
  }, [listar]);
  useEffect(() => {
    leer();
    const t = setInterval(() => document.visibilityState === "visible" && leer(), 60000);
    window.addEventListener("tz-reportes-cambio", leer);
    return () => {
      clearInterval(t);
      window.removeEventListener("tz-reportes-cambio", leer);
    };
  }, [leer]);
  return conteo;
}

function Avatar({ foto, nombre }) {
  const [rota, setRota] = useState(false);
  if (foto && !rota) return <img className="tz-radm-avatar" src={foto} alt="" onError={() => setRota(true)} />;
  return <span className="tz-radm-avatar is-letra">{(nombre || "?").slice(0, 1).toUpperCase()}</span>;
}

function Foto({ valor, onAbrir }) {
  const url = useUrlVisible(valor);
  if (!valor) return null;
  return (
    <button type="button" className="tz-radm-foto" onClick={() => url && onAbrir(url)} aria-label="Ver foto del reporte">
      {url ? <img src={url} alt="Foto del reporte" /> : <Loader2 size={18} className="tz-spin" />}
    </button>
  );
}

export default function ReportesAdminModal({ api, subtitulo = "", onClose }) {
  const [filtro, setFiltro] = useState("nuevo");
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState(null); // { id, modo: 'resolver' | 'descartar' }
  const [accion, setAccion] = useState("advertencia");
  const [dias, setDias] = useState("7");
  const [respuesta, setRespuesta] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [foto, setFoto] = useState("");

  const cargar = useCallback(async () => {
    const { data, error: e } = await api.listar(filtro);
    if (e) {
      setError(e.message || "No se pudieron leer los reportes.");
      setDatos({ reportes: [], conteo: {} });
      return;
    }
    setError("");
    setDatos({ reportes: data?.reportes || [], conteo: data?.conteo || {} });
  }, [filtro, api]);

  useEffect(() => {
    setDatos(null);
    cargar();
  }, [cargar]);

  const avisar = () => window.dispatchEvent(new Event("tz-reportes-cambio"));

  const abrir = (id, modo) => {
    setAbierto(abierto?.id === id && abierto.modo === modo ? null : { id, modo });
    setAccion("advertencia");
    setDias("7");
    setRespuesta("");
    setError("");
  };

  const cambiar = async (r, estado) => {
    setGuardando(true);
    setError("");
    const n = parseInt(dias, 10);
    const { error: e } = await api.resolver({
      p_id: r.id,
      p_estado: estado,
      p_accion: estado === "resuelto" ? accion : null,
      p_dias: estado === "resuelto" && accion === "suspension" ? n : null,
      p_respuesta: estado === "en_revision" ? null : respuesta.trim() || null,
    });
    setGuardando(false);
    if (e) return setError(e.message || "No se pudo guardar.");
    setAbierto(null);
    avisar();
    cargar();
  };

  const levantar = async (sancion) => {
    setGuardando(true);
    const { error: e } = await api.levantar(sancion.id);
    setGuardando(false);
    if (e) return setError(e.message || "No se pudo levantar la sanción.");
    avisar();
    cargar();
  };

  const conteo = datos?.conteo || {};
  const diasValidos = (() => {
    const n = parseInt(dias, 10);
    return n >= 1 && n <= 365;
  })();

  return createPortal(
    <div className="tz-radm-fondo" onClick={onClose}>
      <style>{ESTILO}</style>
      <div className="tz-radm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Centro de reportes">
        <button type="button" className="tz-radm-cerrar" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <h2 className="tz-radm-titulo"><ShieldAlert size={20} /> Centro de reportes</h2>
        {subtitulo && <p className="tz-radm-sub">{subtitulo}</p>}

        <div className="tz-radm-filtros">
          {FILTROS.map((f) => {
            const n = f.id ? conteo[f.id] : null;
            return (
              <button
                key={f.label}
                type="button"
                className={`tz-radm-filtro ${filtro === f.id ? "is-activo" : ""}`}
                onClick={() => setFiltro(f.id)}
              >
                {f.label}
                {n > 0 && <b className={f.id === "nuevo" ? "is-nuevo" : ""}>{n}</b>}
              </button>
            );
          })}
        </div>

        {error && <p className="tz-radm-error">{error}</p>}

        <div className="tz-radm-cuerpo" key={String(filtro)}>
          {!datos ? (
            <Loader2 size={24} className="tz-spin tz-radm-carga" />
          ) : !datos.reportes.length ? (
            <div className="tz-radm-vacio">
              <ShieldCheck size={34} />
              <p>No hay reportes aquí.</p>
            </div>
          ) : (
            <ul className="tz-radm-lista">
              {datos.reportes.map((r, i) => {
                const est = ESTADO[r.estado] || ESTADO.nuevo;
                const rep = r.reportado?.reputacion || {};
                const san = r.reportado?.sancion;
                const abiertoAca = abierto?.id === r.id ? abierto.modo : null;
                const cerrado = r.estado === "resuelto" || r.estado === "descartado";
                return (
                  <li key={r.id} className={`tz-radm-item is-${r.estado}`} style={{ "--d": `${Math.min(i, 10) * 55}ms` }}>
                    <div className="tz-radm-cab">
                      <Avatar foto={r.reportado?.foto_url} nombre={r.reportado?.nombre} />
                      <div className="tz-radm-quien">
                        <b>
                          {r.reportado?.nombre}
                          {r.reportado?.usuario && !/^\d{6,}$/.test(r.reportado.usuario) ? <small> @{r.reportado.usuario}</small> : null}
                        </b>
                        <span className="tz-radm-chips">
                          <span className="tz-radm-chip">
                            {(() => { const I = ICONO_TIPO[r.reportado?.tipo] || User; return <I size={11} />; })()} {TIPO[r.reportado?.tipo] || "Cuenta"}
                          </span>
                          {r.reportado?.detalle && <span className="tz-radm-chip">{r.reportado.detalle}</span>}
                          {r.reportado?.telefono && <span className="tz-radm-chip"><Phone size={11} /> {r.reportado.telefono}</span>}
                        </span>
                        <span className="tz-radm-rep">
                          {rep.total >= 3 ? (
                            <>
                              <Estrellas valor={rep.promedio} size={12} /> {Number(rep.promedio).toFixed(1)} ({rep.total})
                            </>
                          ) : (
                            <span>{rep.total || 0} calificaciones</span>
                          )}
                          <InsigniaReputacion rep={rep} etiquetas={[]} tamano="chico" mostrar="etiquetas" />
                        </span>
                        <span className="tz-radm-cuenta">
                          {r.reportado?.reportes || 0} reporte{r.reportado?.reportes === 1 ? "" : "s"} · {r.reportado?.con_accion || 0} con medida
                        </span>
                      </div>
                      <span className={`tz-radm-estado is-${r.estado}`}>
                        <est.Icono size={12} /> {est.label}
                      </span>
                    </div>

                    {san && (
                      <div className="tz-radm-sancion">
                        <Ban size={14} />
                        <span>{san.accion === "bloqueo" || !san.hasta ? "Bloqueado" : `Suspendido hasta el ${fecha(san.hasta)}`}</span>
                        <button type="button" className="tz-radm-btn is-mini" disabled={guardando} onClick={() => levantar(san)}>
                          <Undo2 size={12} /> Levantar
                        </button>
                      </div>
                    )}

                    <div className="tz-radm-motivo">
                      <Flag size={14} /> {textoMotivo(r.motivo)}
                    </div>
                    {r.descripcion && <p className="tz-radm-desc">“{r.descripcion}”</p>}
                    <Foto valor={r.foto} onAbrir={setFoto} />
                    <p className="tz-radm-meta">
                      Reportó: <b>{r.autor?.nombre}</b> ({TIPO[r.autor?.tipo] || r.autor?.tipo})
                      {r.autor?.telefono ? ` · ${r.autor.telefono}` : ""}
                      <br />
                      {SERVICIO[r.servicio] || "Servicio"} del {fecha(r.fecha)} · enviado el {fecha(r.created_at)}
                    </p>

                    {cerrado ? (
                      <div className="tz-radm-cierre">
                        <b>
                          {r.estado === "descartado"
                            ? "Cerrado sin medidas"
                            : r.accion === "suspension"
                              ? `Suspensión de ${r.dias} día${r.dias === 1 ? "" : "s"}`
                              : ACCIONES.find((a) => a.id === r.accion)?.label}
                          {r.resuelto_at ? ` · ${fecha(r.resuelto_at)}` : ""}
                        </b>
                        {r.respuesta && <p>Respuesta: {r.respuesta}</p>}
                      </div>
                    ) : (
                      <div className="tz-radm-acciones">
                        {r.estado === "nuevo" && (
                          <button type="button" className="tz-radm-btn" disabled={guardando} onClick={() => cambiar(r, "en_revision")}>
                            <Eye size={13} /> En revisión
                          </button>
                        )}
                        <button
                          type="button"
                          className={`tz-radm-btn is-resolver ${abiertoAca === "resolver" ? "is-on" : ""}`}
                          onClick={() => abrir(r.id, "resolver")}
                        >
                          <Gavel size={13} /> Resolver
                        </button>
                        <button
                          type="button"
                          className={`tz-radm-btn is-descartar ${abiertoAca === "descartar" ? "is-on" : ""}`}
                          onClick={() => abrir(r.id, "descartar")}
                        >
                          <X size={13} /> Descartar
                        </button>
                      </div>
                    )}

                    {abiertoAca && !cerrado && (
                      <div className="tz-radm-panel">
                        {abiertoAca === "resolver" && (
                          <>
                            <p className="tz-radm-etq">¿Qué hacemos con {r.reportado?.nombre}?</p>
                            <div className="tz-radm-segm">
                              {ACCIONES.map((a) => (
                                <button
                                  key={a.id}
                                  type="button"
                                  className={`tz-radm-seg is-${a.id} ${accion === a.id ? "is-activo" : ""}`}
                                  onClick={() => setAccion(a.id)}
                                >
                                  <a.Icono size={14} /> {a.label}
                                </button>
                              ))}
                            </div>
                            {accion === "suspension" && (
                              <div className="tz-radm-dias">
                                {DIAS.map((d) => (
                                  <button
                                    key={d}
                                    type="button"
                                    className={`tz-radm-dia ${String(d) === dias ? "is-activo" : ""}`}
                                    onClick={() => setDias(String(d))}
                                  >
                                    {d} día{d === 1 ? "" : "s"}
                                  </button>
                                ))}
                                <input
                                  className="tz-radm-dias-input"
                                  inputMode="numeric"
                                  value={dias}
                                  onChange={(e) => setDias(e.target.value.replace(/\D/g, "").slice(0, 3))}
                                  aria-label="Días de suspensión"
                                />
                              </div>
                            )}
                            <p className="tz-radm-nota">
                              {accion === "sin_accion"
                                ? "No se avisa al reportado."
                                : accion === "advertencia"
                                  ? "El reportado recibe una advertencia en su chat Taxi PE."
                                  : accion === "suspension"
                                    ? "No podrá conectarse ni pedir o tomar viajes hasta que pasen los días."
                                    : "No podrá usar la app hasta que levantes el bloqueo."}
                            </p>
                          </>
                        )}
                        <p className="tz-radm-etq">Mensaje para quien reportó <small>(opcional)</small></p>
                        <textarea
                          className="tz-radm-texto"
                          rows={2}
                          maxLength={400}
                          value={respuesta}
                          placeholder="Lo lee en su chat Taxi PE junto con el resultado."
                          onChange={(e) => setRespuesta(e.target.value)}
                        />
                        <button
                          type="button"
                          className={`tz-radm-confirmar ${abiertoAca === "descartar" ? "is-descartar" : ""}`}
                          disabled={guardando || (abiertoAca === "resolver" && accion === "suspension" && !diasValidos)}
                          onClick={() => cambiar(r, abiertoAca === "resolver" ? "resuelto" : "descartado")}
                        >
                          {guardando ? <Loader2 size={15} className="tz-spin" /> : <CheckCircle2 size={15} />}
                          {abiertoAca === "resolver" ? "Confirmar" : "Cerrar sin medidas"}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {foto && (
        <div className="tz-radm-visor" onClick={(e) => { e.stopPropagation(); setFoto(""); }}>
          <img src={foto} alt="Foto del reporte" />
        </div>
      )}
    </div>,
    document.body
  );
}

const ESTILO = `
.tz-radm-fondo { position: fixed; inset: 0; z-index: 8800; display: grid; grid-template-columns: minmax(0, 1fr); place-items: center; padding: 16px;
  background: rgba(5,3,12,0.72); backdrop-filter: blur(6px); animation: tz-radm-fade .3s ease both; }
.tz-radm, .tz-radm *, .tz-radm *::before, .tz-radm *::after { box-sizing: border-box; }
.tz-radm { position: relative; width: min(640px, 100%); height: min(760px, 94vh); display: flex; flex-direction: column; gap: 10px;
  padding: 18px 16px 16px; border-radius: 24px; color: var(--text); background: var(--panel-solid, #140d28);
  border: 1px solid rgba(255,84,112,0.4); box-shadow: 0 0 40px rgba(255,84,112,0.18); animation: tz-radm-in .55s cubic-bezier(.34,1.56,.64,1) both; }
.tz-radm-cerrar { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border-radius: 50%; border: 0; cursor: pointer;
  display: grid; place-items: center; color: var(--text-dim); background: rgba(255,255,255,0.06); transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
.tz-radm-cerrar:hover { transform: rotate(90deg); }
.tz-radm-titulo { margin: 0; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 19px; color: #ff5470;
  text-shadow: 0 0 14px rgba(255,84,112,0.45); }
.tz-radm-sub { margin: -4px 0 0; text-align: center; font-size: 12.5px; color: var(--text-dim); }
.tz-radm-filtros { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 2px; }
.tz-radm-filtros::-webkit-scrollbar { display: none; }
.tz-radm-filtro { flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px; border-radius: 999px; cursor: pointer;
  font: inherit; font-size: 12.5px; font-weight: 800; color: var(--text-dim); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), color .3s ease, background .3s ease, border-color .3s ease, box-shadow .3s ease; }
.tz-radm-filtro:hover { transform: translateY(-2px); }
.tz-radm-filtro.is-activo { color: #fff; background: linear-gradient(110deg, rgba(255,84,112,0.8), rgba(255,149,0,0.7)); border-color: transparent;
  box-shadow: 0 0 16px rgba(255,84,112,0.45); }
.tz-radm-filtro b { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; display: grid; place-items: center; font-size: 10.5px;
  color: var(--text); background: rgba(255,255,255,0.14); }
.tz-radm-filtro b.is-nuevo { color: #fff; background: #ff5470; box-shadow: 0 0 10px rgba(255,84,112,0.7); animation: tz-radm-pop .5s cubic-bezier(.34,1.56,.64,1) both; }
.tz-radm-error { margin: 0; text-align: center; font-size: 13px; color: #ff5470; }
.tz-radm-cuerpo { flex: 1; min-height: 0; overflow: hidden auto; scrollbar-width: none; margin: 0 -6px; padding: 4px 6px 6px;
  animation: tz-radm-cambio .45s cubic-bezier(.34,1.56,.64,1) both; }
.tz-radm-cuerpo::-webkit-scrollbar { display: none; }
.tz-radm-carga { display: block; margin: 60px auto; color: #ff5470; }
.tz-radm-vacio { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 50px 10px; color: var(--text-dim); }
.tz-radm-vacio svg { color: #39ffb0; filter: drop-shadow(0 0 8px rgba(57,255,176,0.5)); animation: tz-radm-pop .6s cubic-bezier(.34,1.56,.64,1) both; }
.tz-radm-vacio p { margin: 0; }
.tz-radm-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.tz-radm-item { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 18px; background: rgba(255,255,255,0.035);
  border: 1px solid rgba(255,255,255,0.09); animation: tz-radm-item .5s var(--d) cubic-bezier(.34,1.56,.64,1) both; }
.tz-radm-item.is-nuevo { border-color: rgba(255,84,112,0.45); box-shadow: 0 0 16px rgba(255,84,112,0.12); }
.tz-radm-item.is-en_revision { border-color: rgba(255,216,74,0.4); }
.tz-radm-cab { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.tz-radm-avatar { width: 46px; height: 46px; flex-shrink: 0; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,84,112,0.6);
  box-shadow: 0 0 12px rgba(255,84,112,0.3); background: #0d0820; }
.tz-radm-avatar.is-letra { display: grid; place-items: center; font-size: 19px; font-weight: 900; color: #ff5470; }
.tz-radm-quien { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.tz-radm-quien > b { font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tz-radm-quien > b small { font-weight: 600; color: var(--text-dim); }
.tz-radm-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.tz-radm-chip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;
  color: #2be8ff; background: rgba(43,232,255,0.07); border: 1px solid rgba(43,232,255,0.3); }
.tz-radm-rep { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 11.5px; color: #ffd84a; }
.tz-radm-rep > span { color: var(--text-dim); }
.tz-radm-cuenta { font-size: 11.5px; color: var(--text-dim); }
.tz-radm-estado { flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 800;
  color: #ff5470; background: rgba(255,84,112,0.08); border: 1px solid rgba(255,84,112,0.45); }
.tz-radm-estado.is-en_revision { color: #ffd84a; background: rgba(255,216,74,0.08); border-color: rgba(255,216,74,0.45); }
.tz-radm-estado.is-resuelto { color: #39ffb0; background: rgba(57,255,176,0.08); border-color: rgba(57,255,176,0.45); }
.tz-radm-estado.is-descartado { color: var(--text-dim); background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.18); }
.tz-radm-sancion { display: flex; align-items: center; gap: 7px; padding: 7px 10px; border-radius: 12px; font-size: 12.5px; font-weight: 800; color: #ff5470;
  background: rgba(255,84,112,0.08); border: 1px dashed rgba(255,84,112,0.5); animation: tz-radm-pop .5s cubic-bezier(.34,1.56,.64,1) both; }
.tz-radm-sancion span { flex: 1; }
.tz-radm-motivo { display: flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 900; color: #ff9500; }
.tz-radm-desc { margin: 0; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
.tz-radm-foto { align-self: flex-start; padding: 0; border: 0; background: none; cursor: zoom-in; border-radius: 12px;
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease; }
.tz-radm-foto:hover { transform: scale(1.03); box-shadow: 0 0 16px rgba(43,232,255,0.4); }
.tz-radm-foto img { display: block; max-width: 180px; max-height: 130px; border-radius: 12px; border: 1px solid rgba(43,232,255,0.4); }
.tz-radm-meta { margin: 0; font-size: 11.5px; line-height: 1.5; color: var(--text-dim); }
.tz-radm-meta b { color: var(--text); }
.tz-radm-cierre { padding: 8px 10px; border-radius: 12px; background: rgba(57,255,176,0.06); border-left: 3px solid #39ffb0; }
.tz-radm-cierre b { font-size: 12.5px; color: #39ffb0; }
.tz-radm-cierre p { margin: 3px 0 0; font-size: 12.5px; overflow-wrap: anywhere; }
.tz-radm-item.is-descartado .tz-radm-cierre { background: rgba(255,255,255,0.04); border-left-color: rgba(255,255,255,0.3); }
.tz-radm-item.is-descartado .tz-radm-cierre b { color: var(--text-dim); }
.tz-radm-acciones { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.tz-radm-btn { display: inline-flex; align-items: center; gap: 5px; padding: 7px 12px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 12.5px;
  font-weight: 800; color: #ffd84a; background: rgba(255,216,74,0.07); border: 1px solid rgba(255,216,74,0.4);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease, background .3s ease, color .3s ease; }
.tz-radm-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 0 14px rgba(255,216,74,0.35); }
.tz-radm-btn:disabled { opacity: .5; cursor: default; }
.tz-radm-btn.is-mini { padding: 4px 9px; font-size: 11.5px; color: #39ffb0; background: rgba(57,255,176,0.07); border-color: rgba(57,255,176,0.45); }
.tz-radm-btn.is-resolver { color: #ff5470; background: rgba(255,84,112,0.07); border-color: rgba(255,84,112,0.45); }
.tz-radm-btn.is-resolver.is-on { color: #fff; background: #ff5470; box-shadow: 0 0 16px rgba(255,84,112,0.55); }
.tz-radm-btn.is-descartar { color: var(--text-dim); background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.2); }
.tz-radm-btn.is-descartar.is-on { color: var(--text); background: rgba(255,255,255,0.14); }
.tz-radm-panel { display: flex; flex-direction: column; gap: 7px; padding: 10px; border-radius: 14px; background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.1); animation: tz-radm-abre .45s cubic-bezier(.34,1.56,.64,1) both; transform-origin: top center; }
.tz-radm-etq { margin: 0; font-size: 12.5px; font-weight: 800; }
.tz-radm-etq small { font-weight: 600; color: var(--text-dim); }
.tz-radm-segm { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; }
@media (max-width: 480px) { .tz-radm-segm { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.tz-radm-seg { display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 8px 6px; border-radius: 12px; cursor: pointer;
  font: inherit; font-size: 12px; font-weight: 800; color: var(--text-dim); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.12);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), color .3s ease, background .3s ease, box-shadow .3s ease, border-color .3s ease; }
.tz-radm-seg:hover { transform: translateY(-2px); }
.tz-radm-seg.is-activo { transform: scale(1.03); color: #fff; border-color: transparent; }
.tz-radm-seg.is-sin_accion.is-activo { background: rgba(57,255,176,0.35); box-shadow: 0 0 14px rgba(57,255,176,0.45); }
.tz-radm-seg.is-advertencia.is-activo { background: rgba(255,216,74,0.4); box-shadow: 0 0 14px rgba(255,216,74,0.45); color: #1a1300; }
.tz-radm-seg.is-suspension.is-activo { background: rgba(255,149,0,0.55); box-shadow: 0 0 14px rgba(255,149,0,0.5); }
.tz-radm-seg.is-bloqueo.is-activo { background: #ff5470; box-shadow: 0 0 16px rgba(255,84,112,0.6); }
.tz-radm-dias { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; animation: tz-radm-abre .4s cubic-bezier(.34,1.56,.64,1) both; }
.tz-radm-dia { padding: 5px 10px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 12px; font-weight: 800; color: #ff9500;
  background: rgba(255,149,0,0.07); border: 1px solid rgba(255,149,0,0.4); transition: transform .3s cubic-bezier(.34,1.56,.64,1), background .3s ease, color .3s ease; }
.tz-radm-dia.is-activo { color: #fff; background: #ff9500; box-shadow: 0 0 12px rgba(255,149,0,0.55); transform: scale(1.05); }
.tz-radm-dias-input { width: 64px; padding: 5px 8px; border-radius: 10px; text-align: center; font: inherit; font-size: 12.5px; font-weight: 800; color: var(--text);
  background: rgba(255,255,255,0.05); border: 1px solid rgba(255,149,0,0.4); outline: none; }
.tz-radm-nota { margin: 0; font-size: 11.5px; color: var(--text-dim); }
.tz-radm-texto { width: 100%; resize: vertical; padding: 8px 10px; border-radius: 12px; font: inherit; font-size: 13px; color: var(--text);
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.14); outline: none; transition: border-color .3s ease, box-shadow .3s ease; }
.tz-radm-texto:focus { border-color: rgba(255,84,112,0.55); box-shadow: 0 0 12px rgba(255,84,112,0.2); }
.tz-radm-confirmar { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 10px; border-radius: 14px; border: 0; cursor: pointer;
  font: inherit; font-size: 13.5px; font-weight: 900; color: #fff; background: linear-gradient(110deg, #ff5470, #ff9500); box-shadow: 0 0 16px rgba(255,84,112,0.45);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease, opacity .3s ease; }
.tz-radm-confirmar:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 0 24px rgba(255,84,112,0.6); }
.tz-radm-confirmar:disabled { opacity: .45; cursor: default; }
.tz-radm-confirmar.is-descartar { color: var(--text); background: rgba(255,255,255,0.14); box-shadow: none; }
.tz-radm-visor { position: fixed; inset: 0; z-index: 8850; display: grid; place-items: center; padding: 20px; cursor: zoom-out;
  background: rgba(5,3,12,0.9); animation: tz-radm-fade .25s ease both; }
.tz-radm-visor img { max-width: 100%; max-height: 90vh; border-radius: 16px; box-shadow: 0 0 40px rgba(43,232,255,0.3); animation: tz-radm-pop .45s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes tz-radm-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes tz-radm-in { from { opacity: 0; transform: translateY(18px) scale(.92); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes tz-radm-cambio { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes tz-radm-item { from { opacity: 0; transform: translateY(14px) scale(.95); } to { opacity: 1; transform: none; } }
@keyframes tz-radm-pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: none; } }
@keyframes tz-radm-abre { from { opacity: 0; transform: scaleY(.6) translateY(-6px); } to { opacity: 1; transform: none; } }
`;
