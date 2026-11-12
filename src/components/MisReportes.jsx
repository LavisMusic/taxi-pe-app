import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Flag, Camera, Trash2, ShieldCheck, CheckCircle2, Clock3, MessageSquareReply, Send, Inbox } from "lucide-react";

/* Reportes (fase 4 de Reportes y reputación) — MISMO archivo en Taxi-PE y
   Caja (src/components/MisReportes.jsx): mantener iguales.
   Pestaña "Reportes" de Mi reputación: los servicios de los últimos 30 días
   (con "Reportar") y los reportes que hice con su estado y la respuesta.
   reportes = {
     leer()                                  → { data: { servicios, reportes }, error }
     reportar(item, motivo, descripcion, archivo|null) → { error? }
   }
   avisoDonde: el chat donde llega la respuesta ("Taxi PE", "Tonazo"). */

export const MOTIVOS = {
  conductor: [
    ["manejo_peligroso", "Manejo peligroso"],
    ["cobro_distinto", "Cobró distinto a lo acordado"],
    ["maltrato", "Maltrato o acoso"],
    ["vehiculo_distinto", "El vehículo o la placa no coinciden"],
    ["no_llego", "No llegó o canceló"],
    ["otro", "Otro"],
  ],
  repartidor: [
    ["pedido_danado", "Pedido incompleto o dañado"],
    ["demora", "Demora excesiva"],
    ["cobro_indebido", "Cobro indebido"],
    ["maltrato", "Maltrato o acoso"],
    ["otro", "Otro"],
  ],
  pasajero: [
    ["no_se_presento", "No se presentó"],
    ["no_pago", "No pagó o pagó menos"],
    ["maltrato", "Maltrato o acoso"],
    ["danos_vehiculo", "Dañó el vehículo"],
    ["otro", "Otro"],
  ],
  negocio: [
    ["producto_mal", "Producto distinto o en mal estado"],
    ["cobro_indebido", "Cobro indebido"],
    ["no_entrego", "No entregó el pedido"],
    ["maltrato", "Maltrato o acoso"],
    ["otro", "Otro"],
  ],
  cliente: [
    ["no_recibio", "No estaba o no recibió"],
    ["no_pago", "No pagó"],
    ["direccion_falsa", "Dirección falsa"],
    ["maltrato", "Maltrato o acoso"],
    ["otro", "Otro"],
  ],
};

export function textoMotivo(id) {
  for (const lista of Object.values(MOTIVOS)) {
    const m = lista.find(([k]) => k === id);
    if (m) return m[1];
  }
  return "Otro";
}

const ESTADOS = {
  nuevo: { label: "Enviado", Icono: Send },
  en_revision: { label: "En revisión", Icono: Clock3 },
  resuelto: { label: "Resuelto", Icono: CheckCircle2 },
  descartado: { label: "Cerrado", Icono: CheckCircle2 },
};
const fechaCorta = (f) => (f ? new Date(f).toLocaleDateString("es-PE", { day: "numeric", month: "short" }) : "");

function Avatar({ foto, nombre }) {
  const [rota, setRota] = useState(false);
  if (foto && !rota) return <img className="tz-mirep-avatar" src={foto} alt="" onError={() => setRota(true)} />;
  return <span className="tz-mirep-avatar is-letra">{(nombre || "?").replace(/^@/, "").slice(0, 1).toUpperCase()}</span>;
}

export default function MisReportes({ reportes, avisoDonde = "Taxi PE" }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState(null);
  const ref = useRef(reportes);
  ref.current = reportes;

  const cargar = useCallback(async () => {
    const r = await ref.current.leer();
    if (r.error) {
      setError(r.error.message || "No se pudieron leer tus reportes.");
      setDatos({ servicios: [], reportes: [] });
      return;
    }
    setError("");
    setDatos({
      servicios: Array.isArray(r.data?.servicios) ? r.data.servicios : [],
      reportes: Array.isArray(r.data?.reportes) ? r.data.reportes : [],
    });
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!datos) return <Loader2 size={22} className="tz-spin tz-mirep-carga" />;

  return (
    <div className="tz-rep">
      <style>{ESTILO}</style>
      <p className="tz-rep-nota">
        <ShieldCheck size={15} /> Reporta un problema con un servicio de los últimos 30 días. Es anónimo: la otra persona no sabrá quién lo hizo.
      </p>
      {error && <p className="tz-mirep-error">{error}</p>}

      {datos.reportes.length > 0 && (
        <>
          <h4 className="tz-rep-sub">Tus reportes</h4>
          <ul className="tz-mirep-lista">
            {datos.reportes.map((r, i) => {
              const est = ESTADOS[r.estado] || ESTADOS.nuevo;
              return (
                <li key={r.id} className="tz-mirep-item" style={{ "--d": `${Math.min(i, 10) * 55}ms` }}>
                  <div className="tz-mirep-item-cab">
                    <Avatar foto={r.foto_url} nombre={r.nombre} />
                    <div className="tz-mirep-info">
                      <b>{r.nombre || "Cuenta"}</b>
                      <span>{[textoMotivo(r.motivo), fechaCorta(r.fecha || r.created_at)].filter(Boolean).join(" · ")}</span>
                    </div>
                    <span className={`tz-rep-estado is-${r.estado}`}>
                      <est.Icono size={12} /> {est.label}
                    </span>
                  </div>
                  {r.descripcion && <p className="tz-mirep-coment">“{r.descripcion}”</p>}
                  {r.estado === "resuelto" && (
                    <p className={`tz-rep-resultado ${r.medidas ? "is-medidas" : ""}`}>
                      {r.medidas ? "Tomamos medidas con esa cuenta." : "Lo revisamos y por ahora no tomamos medidas."}
                    </p>
                  )}
                  {r.estado === "descartado" && <p className="tz-rep-resultado">Lo revisamos y lo cerramos sin medidas.</p>}
                  {r.respuesta && (
                    <div className="tz-mirep-resp">
                      <b><MessageSquareReply size={13} /> Respuesta de {avisoDonde}</b>
                      <p>{r.respuesta}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h4 className="tz-rep-sub">Servicios recientes</h4>
      {!datos.servicios.length ? (
        <div className="tz-mirep-vacio">
          <Inbox size={30} />
          <p>No tienes servicios en los últimos 30 días.</p>
        </div>
      ) : (
        <ul className="tz-mirep-lista">
          {datos.servicios.map((s, i) => (
            <li key={`${s.ref}|${s.reportado_tipo}`} className="tz-mirep-item" style={{ "--d": `${Math.min(i, 10) * 55}ms` }}>
              <div className="tz-mirep-item-cab">
                <Avatar foto={s.foto_url} nombre={s.nombre} />
                <div className="tz-mirep-info">
                  <b>{s.nombre}</b>
                  <span>{[s.detalle, fechaCorta(s.fecha)].filter(Boolean).join(" · ")}</span>
                </div>
                {s.reportado ? (
                  <span className="tz-rep-hecho"><CheckCircle2 size={13} /> Reportado</span>
                ) : (
                  <button type="button" className="tz-mirep-btn tz-rep-btn" onClick={() => setAbierto(s)}>
                    <Flag size={13} /> Reportar
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {abierto && (
        <ReportarModal
          item={abierto}
          avisoDonde={avisoDonde}
          onEnviar={(motivo, descripcion, archivo) => ref.current.reportar(abierto, motivo, descripcion, archivo)}
          onCerrar={(hecho) => {
            setAbierto(null);
            if (hecho) cargar();
          }}
        />
      )}
    </div>
  );
}

export function ReportarModal({ item, avisoDonde, onEnviar, onCerrar }) {
  const motivos = MOTIVOS[item.motivos] || MOTIVOS[item.reportado_tipo] || [["otro", "Otro"]];
  const [motivo, setMotivo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [vista, setVista] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);
  const input = useRef(null);

  useEffect(() => () => vista && URL.revokeObjectURL(vista), [vista]);

  const elegirFoto = (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) return setError("Elige una imagen.");
    if (f.size > 10 * 1024 * 1024) return setError("La foto puede pesar hasta 10 MB.");
    setError("");
    setArchivo(f);
    setVista(URL.createObjectURL(f));
  };

  const desc = descripcion.trim();
  const faltaDesc = motivo === "otro" && desc.length < 10;
  const puede = !!motivo && !faltaDesc && !enviando;

  const enviar = async () => {
    if (!puede) return;
    setEnviando(true);
    setError("");
    const r = await onEnviar(motivo, desc || null, archivo);
    setEnviando(false);
    if (r?.error) return setError(r.error.message || "No se pudo enviar el reporte.");
    setListo(true);
  };

  return createPortal(
    <div className="tz-rep-fondo" onClick={() => !enviando && onCerrar(listo)}>
      <style>{ESTILO}</style>
      <div className="tz-rep-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Reportar un problema">
        <button type="button" className="tz-mirep-cerrar" onClick={() => onCerrar(listo)} aria-label="Cerrar" disabled={enviando}>
          <X size={18} />
        </button>
        {listo ? (
          <div className="tz-rep-listo">
            <span className="tz-rep-listo-icono"><CheckCircle2 size={46} /></span>
            <h3>¡Reporte enviado!</h3>
            <p>Lo revisaremos y te avisaremos en el chat {avisoDonde}.</p>
            <button type="button" className="tz-rep-enviar" onClick={() => onCerrar(true)}>Listo</button>
          </div>
        ) : (
          <>
            <h3 className="tz-rep-titulo"><Flag size={17} /> Reportar un problema</h3>
            <div className="tz-mirep-item-cab tz-rep-quien">
              <Avatar foto={item.foto_url} nombre={item.nombre} />
              <div className="tz-mirep-info">
                <b>{item.nombre}</b>
                <span>{[item.detalle, fechaCorta(item.fecha)].filter(Boolean).join(" · ")}</span>
              </div>
            </div>

            <p className="tz-rep-etiqueta">¿Qué pasó?</p>
            <div className="tz-rep-motivos">
              {motivos.map(([id, label], i) => (
                <button
                  key={id}
                  type="button"
                  className={`tz-rep-motivo ${motivo === id ? "is-activo" : ""}`}
                  style={{ "--d": `${i * 45}ms` }}
                  onClick={() => setMotivo(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            <p className="tz-rep-etiqueta">
              Cuéntanos más {motivo === "otro" ? "" : <small>(opcional)</small>}
            </p>
            <textarea
              className="tz-rep-texto"
              value={descripcion}
              maxLength={600}
              rows={3}
              placeholder="Qué pasó, dónde, a qué hora…"
              onChange={(e) => setDescripcion(e.target.value)}
            />
            <div className="tz-rep-cuenta">
              {faltaDesc ? <span>Escribe al menos 10 letras</span> : <span />}
              <span>{descripcion.length}/600</span>
            </div>

            <input ref={input} type="file" accept="image/*" hidden onChange={elegirFoto} />
            {vista ? (
              <div className="tz-rep-foto">
                <img src={vista} alt="Foto del reporte" />
                <button
                  type="button"
                  className="tz-rep-foto-quitar"
                  onClick={() => {
                    setArchivo(null);
                    setVista("");
                  }}
                  aria-label="Quitar foto"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ) : (
              <button type="button" className="tz-rep-foto-btn" onClick={() => input.current?.click()}>
                <Camera size={16} /> Agregar foto <small>(opcional)</small>
              </button>
            )}

            <p className="tz-rep-anonimo"><ShieldCheck size={14} /> {item.nombre} no sabrá quién lo reportó.</p>
            {error && <p className="tz-mirep-error">{error}</p>}
            <button type="button" className="tz-rep-enviar" disabled={!puede} onClick={enviar}>
              {enviando ? <Loader2 size={16} className="tz-spin" /> : <Send size={15} />} Enviar reporte
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

const ESTILO = `
/* Lo que ReportarModal toma de Mi reputación, para que también se vea bien
   abierto solo (p. ej. "Reportar cliente" desde un pedido). */
.tz-rep-modal .tz-mirep-cerrar { position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border-radius: 50%; border: 0; cursor: pointer;
  display: grid; place-items: center; color: var(--text-dim); background: rgba(255,255,255,0.06); transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
.tz-rep-modal .tz-mirep-cerrar:hover { transform: rotate(90deg); }
.tz-rep-modal .tz-mirep-item-cab { display: flex; align-items: center; gap: 10px; min-width: 0; }
.tz-rep-modal .tz-mirep-avatar { width: 42px; height: 42px; flex-shrink: 0; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,216,74,0.6);
  box-shadow: 0 0 12px rgba(255,216,74,0.3); background-color: #14101f;
  background-image:
    radial-gradient(circle at 20% 25%, rgba(43,232,255,0.65) 0%, rgba(43,232,255,0.22) 32%, transparent 62%),
    radial-gradient(circle at 80% 30%, rgba(255,47,158,0.6) 0%, rgba(255,47,158,0.2) 34%, transparent 64%),
    radial-gradient(circle at 50% 85%, rgba(215,255,59,0.5) 0%, rgba(215,255,59,0.16) 34%, transparent 64%);
  background-size: 200% 200%; animation: tz-rep-aurora 5s ease-in-out infinite alternate; }
.tz-rep-modal .tz-mirep-avatar.is-letra { display: grid; place-items: center; font-size: 18px; font-weight: 900; color: #ffd84a; }
.tz-rep-modal .tz-mirep-info { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
.tz-rep-modal .tz-mirep-info b { max-width: 100%; font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tz-rep-modal .tz-mirep-info > span { max-width: 100%; font-size: 11.5px; color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@keyframes tz-rep-aurora { 0% { background-position: 10% 15%; } 50% { background-position: 70% 55%; } 100% { background-position: 30% 80%; } }
.tz-rep { display: flex; flex-direction: column; gap: 8px; }
.tz-rep-nota { margin: 0; display: flex; gap: 7px; align-items: flex-start; padding: 9px 11px; border-radius: 14px; font-size: 12px; line-height: 1.4;
  color: var(--text-dim); background: rgba(43,232,255,0.05); border: 1px solid rgba(43,232,255,0.2); }
.tz-rep-nota svg { flex-shrink: 0; color: #2be8ff; margin-top: 1px; }
.tz-rep-sub { margin: 6px 2px 0; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #ffd84a; }
.tz-rep-estado { flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 800;
  color: #2be8ff; background: rgba(43,232,255,0.08); border: 1px solid rgba(43,232,255,0.4); animation: tz-mirep-pop .5s cubic-bezier(.34,1.56,.64,1) both; }
.tz-rep-estado.is-en_revision { color: #ffd84a; background: rgba(255,216,74,0.08); border-color: rgba(255,216,74,0.45); }
.tz-rep-estado.is-resuelto { color: #39ffb0; background: rgba(57,255,176,0.08); border-color: rgba(57,255,176,0.45); }
.tz-rep-estado.is-descartado { color: var(--text-dim); background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.18); }
.tz-rep-resultado { margin: 0; padding: 6px 9px; border-radius: 10px; font-size: 12px; color: var(--text-dim); background: rgba(255,255,255,0.04); }
.tz-rep-resultado.is-medidas { color: #39ffb0; background: rgba(57,255,176,0.07); }
.tz-rep-btn { color: #ff5470; background: rgba(255,84,112,0.07); border-color: rgba(255,84,112,0.45); }
.tz-rep-btn:hover { box-shadow: 0 0 14px rgba(255,84,112,0.45); }
.tz-rep-hecho { flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; font-weight: 800; color: var(--text-dim); }
.tz-rep-fondo { position: fixed; inset: 0; z-index: 9000; display: grid; grid-template-columns: minmax(0, 1fr); place-items: center; padding: 16px;
  background: rgba(5,3,12,0.72); backdrop-filter: blur(6px); animation: tz-mirep-fade .3s ease both; }
.tz-rep-modal, .tz-rep-modal *, .tz-rep-modal *::before, .tz-rep-modal *::after { box-sizing: border-box; }
.tz-rep-modal { position: relative; width: min(440px, 100%); max-height: 92vh; overflow: hidden auto; scrollbar-width: none; display: flex; flex-direction: column; gap: 9px;
  padding: 18px 16px 16px; border-radius: 24px; color: var(--text); background: var(--panel-solid, #140d28);
  border: 1px solid rgba(255,84,112,0.4); box-shadow: 0 0 36px rgba(255,84,112,0.2); animation: tz-mirep-in .55s cubic-bezier(.34,1.56,.64,1) both; }
.tz-rep-modal::-webkit-scrollbar { display: none; }
.tz-rep-titulo { margin: 0; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 17px; color: #ff5470;
  text-shadow: 0 0 14px rgba(255,84,112,0.45); }
.tz-rep-quien { padding: 9px 10px; border-radius: 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
.tz-rep-etiqueta { margin: 4px 2px 0; font-size: 12.5px; font-weight: 800; color: var(--text); }
.tz-rep-etiqueta small { font-weight: 600; color: var(--text-dim); }
.tz-rep-motivos { display: flex; flex-wrap: wrap; gap: 6px; }
.tz-rep-motivo { padding: 7px 12px; border-radius: 999px; cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 700; color: var(--text-dim);
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.14);
  animation: tz-mirep-item .45s var(--d) cubic-bezier(.34,1.56,.64,1) both;
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), color .3s ease, background .3s ease, border-color .3s ease, box-shadow .3s ease; }
.tz-rep-motivo:hover { transform: translateY(-2px); }
.tz-rep-motivo.is-activo { color: #fff; background: linear-gradient(110deg, rgba(255,84,112,0.85), rgba(255,149,0,0.75)); border-color: transparent;
  box-shadow: 0 0 16px rgba(255,84,112,0.5); transform: scale(1.04); }
.tz-rep-texto { width: 100%; resize: vertical; min-height: 74px; padding: 10px 12px; border-radius: 14px; font: inherit; font-size: 13.5px; color: var(--text);
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.14); outline: none; transition: border-color .3s ease, box-shadow .3s ease; }
.tz-rep-texto:focus { border-color: rgba(255,84,112,0.6); box-shadow: 0 0 14px rgba(255,84,112,0.25); }
.tz-rep-cuenta { display: flex; justify-content: space-between; margin-top: -4px; font-size: 11px; color: var(--text-dim); }
.tz-rep-cuenta span:first-child { color: #ff9500; }
.tz-rep-foto-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 10px; border-radius: 14px; cursor: pointer;
  font: inherit; font-size: 13px; font-weight: 800; color: #2be8ff; background: rgba(43,232,255,0.06); border: 1px dashed rgba(43,232,255,0.45);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease; }
.tz-rep-foto-btn:hover { transform: translateY(-2px); box-shadow: 0 0 14px rgba(43,232,255,0.35); }
.tz-rep-foto-btn small { font-weight: 600; color: var(--text-dim); }
.tz-rep-foto { position: relative; align-self: center; animation: tz-mirep-pop .5s cubic-bezier(.34,1.56,.64,1) both; }
.tz-rep-foto img { display: block; max-width: 100%; max-height: 170px; border-radius: 14px; border: 1px solid rgba(43,232,255,0.4); box-shadow: 0 0 16px rgba(43,232,255,0.25); }
.tz-rep-foto-quitar { position: absolute; top: 6px; right: 6px; width: 30px; height: 30px; border-radius: 50%; border: 0; cursor: pointer;
  display: grid; place-items: center; color: #fff; background: rgba(255,84,112,0.9); box-shadow: 0 0 12px rgba(255,84,112,0.6);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
.tz-rep-foto-quitar:hover { transform: scale(1.12); }
.tz-rep-anonimo { margin: 2px 0 0; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; color: var(--text-dim); }
.tz-rep-anonimo svg { color: #39ffb0; }
.tz-rep-enviar { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 12px; border-radius: 16px; border: 0; cursor: pointer;
  font: inherit; font-size: 14px; font-weight: 900; color: #fff; background: linear-gradient(110deg, #ff5470, #ff9500);
  box-shadow: 0 0 18px rgba(255,84,112,0.45); transition: transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease, opacity .3s ease, filter .3s ease; }
.tz-rep-enviar:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 0 26px rgba(255,84,112,0.6); }
.tz-rep-enviar:disabled { opacity: .45; filter: saturate(.5); cursor: default; box-shadow: none; }
.tz-rep-listo { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 18px 6px 4px; text-align: center; }
.tz-rep-listo h3 { margin: 0; font-size: 19px; color: #39ffb0; text-shadow: 0 0 14px rgba(57,255,176,0.45); animation: tz-mirep-item .5s .15s cubic-bezier(.34,1.56,.64,1) both; }
.tz-rep-listo p { margin: 0; font-size: 13.5px; color: var(--text-dim); animation: tz-mirep-item .5s .25s cubic-bezier(.34,1.56,.64,1) both; }
.tz-rep-listo .tz-rep-enviar { width: 100%; margin-top: 6px; background: linear-gradient(110deg, #39ffb0, #2be8ff); color: #04211a; box-shadow: 0 0 18px rgba(57,255,176,0.45);
  animation: tz-mirep-item .5s .35s cubic-bezier(.34,1.56,.64,1) both; }
.tz-rep-listo-icono { display: grid; place-items: center; width: 84px; height: 84px; border-radius: 50%; color: #39ffb0;
  background: radial-gradient(circle, rgba(57,255,176,0.22), rgba(57,255,176,0.04)); box-shadow: 0 0 34px rgba(57,255,176,0.45);
  animation: tz-rep-listo 0.8s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes tz-rep-listo { 0% { opacity: 0; transform: scale(.3) rotate(-25deg); } 60% { opacity: 1; transform: scale(1.12) rotate(4deg); } 100% { transform: none; } }
@keyframes tz-mirep-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes tz-mirep-in { from { opacity: 0; transform: translateY(18px) scale(.92); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes tz-mirep-item { from { opacity: 0; transform: translateY(14px) scale(.95); } to { opacity: 1; transform: none; } }
@keyframes tz-mirep-pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: none; } }
`;
