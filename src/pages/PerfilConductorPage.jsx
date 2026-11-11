import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Car, PackageCheck, CalendarDays, Users, Gauge, Loader2, Share2, Check } from "lucide-react";
import Styles from "../components/Styles";
import Opiniones from "../components/Opiniones";
import InsigniaReputacion from "../components/InsigniaReputacion";
import { supabase } from "../supabaseClient";
import { avisarCambioReputacion } from "../lib/reputacion";
import { NIVELES_SERVICIO } from "../lib/taxiEnums";

/* /conductores/<usuario> (fase 2 de Reportes y reputación): la página
   pública del conductor — portada, foto, datos, reputación y comentarios
   anónimos de pasajeros, clientes y negocios. El conductor responde, el
   autor edita o borra lo suyo y el admin oculta lo ofensivo. */

const SERVICIOS = { viaje: "Viaje", entrega: "Entrega" };

export default function PerfilConductorPage() {
  const { clave } = useParams();
  const navigate = useNavigate();
  const [perfil, setPerfil] = useState(undefined);
  const [copiado, setCopiado] = useState(false);

  const leer = useCallback(async () => {
    const { data, error } = await supabase.rpc("taxi_perfil_conductor", { p_clave: clave });
    if (error) return setPerfil(null);
    setPerfil(data || null);
    // Dirección linda: /conductores/<usuario> aunque se haya entrado por id.
    if (data?.nombre_usuario && clave !== data.nombre_usuario) {
      window.history.replaceState(null, "", `/conductores/${data.nombre_usuario}`);
    }
  }, [clave]);

  useEffect(() => {
    leer();
  }, [leer]);

  const cargar = useCallback(
    (estrellas, antes) =>
      perfil?.id
        ? supabase.rpc("taxi_comentarios_conductor", {
            p_conductor_id: perfil.id, p_estrellas: estrellas, p_antes: antes, p_limite: 15,
          })
        : Promise.resolve({ data: [] }),
    [perfil?.id]
  );

  const tras = async (p) => {
    const r = await p;
    if (!r.error) avisarCambioReputacion();
    return r;
  };
  const acciones = useMemo(() => ({
    miCalificacion: (it) => supabase.rpc("taxi_mi_calificacion", { p_ref: it.ref, p_calificado_tipo: "conductor" }),
    guardar: (it, e, c) => tras(supabase.rpc("taxi_calificar", { p_ref: it.ref, p_estrellas: e, p_comentario: c || null })),
    borrar: (it) => tras(supabase.rpc("taxi_borrar_calificacion", { p_ref: it.ref, p_calificado_tipo: "conductor" })),
    responder: (it, t) => supabase.rpc("taxi_responder_calificacion", { p_id: it.id, p_respuesta: t }),
    ocultar: (it, o) => supabase.rpc("taxi_ocultar_calificacion", { p_id: it.id, p_oculto: o }),
    ocultarPropio: (it, o) => supabase.rpc("taxi_ocultar_mi_comentario", { p_id: it.id, p_oculto: o }),
  }), []);

  const compartir = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: perfil?.nombre, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1800);
      }
    } catch {
      /* cancelado */
    }
  };

  const nivel = NIVELES_SERVICIO.find((n) => n.value === perfil?.nivel_servicio)?.label;
  const desde = perfil?.desde ? new Date(perfil.desde).toLocaleDateString("es-PE", { month: "long", year: "numeric" }) : null;

  return (
    <div className="tz-root tz-pc-pagina">
      <Styles />
      <style>{ESTILO}</style>
      <header className="tz-pc-barra">
        <button type="button" className="tz-pc-volver" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}>
          <ArrowLeft size={16} /> Volver
        </button>
        {perfil && (
          <button type="button" className="tz-pc-volver" onClick={compartir}>
            {copiado ? <Check size={16} /> : <Share2 size={16} />} {copiado ? "Copiado" : "Compartir"}
          </button>
        )}
      </header>

      {perfil === undefined ? (
        <p className="tz-pc-centro"><Loader2 size={22} className="tz-spin" /></p>
      ) : perfil === null ? (
        <p className="tz-pc-centro">No encontramos a este conductor.</p>
      ) : (
        <main className="tz-pc">
          <section className="tz-pc-tarjeta">
            <div className="tz-pc-portada" style={perfil.foto_portada_url ? { backgroundImage: `url(${perfil.foto_portada_url})` } : undefined} />
            <div className="tz-pc-foto">
              {perfil.foto_url ? <img src={perfil.foto_url} alt="" /> : <span>{(perfil.nombre || "?").slice(0, 1)}</span>}
            </div>
            <h1 className="tz-pc-nombre">{perfil.nombre}</h1>
            {perfil.nombre_usuario && <p className="tz-pc-usuario">@{perfil.nombre_usuario}</p>}
            <InsigniaReputacion rep={perfil.reputacion} etiquetas={perfil.etiquetas} />
            <ul className="tz-pc-datos">
              <li style={{ "--d": "0ms" }}><Car size={16} /><b>{perfil.viajes}</b><span>viajes</span></li>
              <li style={{ "--d": "80ms" }}><PackageCheck size={16} /><b>{perfil.entregas}</b><span>entregas</span></li>
              {desde && <li style={{ "--d": "160ms" }}><CalendarDays size={16} /><b>{desde}</b><span>en Taxi PE</span></li>}
            </ul>
            <div className="tz-pc-vehiculo">
              {perfil.placa && <span className="tz-pc-placa">{perfil.placa}</span>}
              {nivel && <span><Gauge size={14} /> {nivel}</span>}
              {perfil.asientos_totales ? <span><Users size={14} /> {perfil.asientos_totales} asientos</span> : null}
            </div>
            {perfil.descripcion && <p className="tz-pc-desc">{perfil.descripcion}</p>}
          </section>

          <section className="tz-pc-seccion">
            <h2>Opiniones</h2>
            <Opiniones
              resumen={{ reputacion: perfil.reputacion, etiquetas: perfil.etiquetas, puede_responder: perfil.es_mio, puede_ocultar: perfil.puede_ocultar }}
              cargar={cargar}
              acciones={acciones}
              nombre={perfil.nombre}
              quienResponde={perfil.es_mio ? "ti" : "el conductor"}
              quienOculta="el conductor"
              servicios={SERVICIOS}
              onCambio={leer}
            />
          </section>
        </main>
      )}
    </div>
  );
}

const ESTILO = `
.tz-pc-pagina { min-height: 100vh; padding: 14px 16px 40px; }
.tz-pc-barra { max-width: 720px; margin: 0 auto 10px; display: flex; justify-content: space-between; gap: 8px; }
.tz-pc-volver { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 999px; cursor: pointer; font: inherit;
  font-weight: 700; font-size: 13px; color: var(--cyan); background: rgba(43,232,255,0.08); border: 1px solid rgba(43,232,255,0.35);
  transition: transform .3s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease; }
.tz-pc-volver:hover { transform: translateY(-1px); box-shadow: 0 0 14px rgba(43,232,255,0.35); }
.tz-pc-centro { display: flex; justify-content: center; margin-top: 80px; color: var(--text-dim); }
.tz-pc { max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
.tz-pc-tarjeta { position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 0 16px 18px;
  border-radius: 24px; background: var(--panel); border: 1px solid rgba(43,232,255,0.25); text-align: center;
  box-shadow: 0 0 30px rgba(43,232,255,0.1); animation: tz-pc-in .6s cubic-bezier(.34,1.56,.64,1) both; }
.tz-pc-portada { align-self: stretch; margin: 0 -16px; height: 140px; background: linear-gradient(120deg, rgba(43,232,255,0.35), rgba(255,47,158,0.35));
  background-size: cover; background-position: center; animation: tz-pc-portada 1.2s ease both; }
.tz-pc-foto { width: 104px; height: 104px; margin-top: -54px; border-radius: 50%; overflow: hidden; display: grid; place-items: center;
  border: 3px solid #2be8ff; box-shadow: 0 0 26px rgba(43,232,255,0.55); background: #14101f; font-size: 40px; font-weight: 900; color: #2be8ff;
  animation: tz-pc-foto .8s .15s cubic-bezier(.34,1.56,.64,1) both; }
.tz-pc-foto img { width: 100%; height: 100%; object-fit: cover; }
.tz-pc-nombre { margin: 4px 0 0; font-size: 22px; color: var(--text); }
.tz-pc-usuario { margin: -4px 0 0; font-size: 13px; color: var(--text-dim); }
.tz-pc-datos { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
.tz-pc-datos li { display: flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 14px; background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.09); font-size: 12.5px; color: var(--text-dim); animation: tz-pc-in .5s var(--d) cubic-bezier(.34,1.56,.64,1) both; }
.tz-pc-datos svg { color: #2be8ff; }
.tz-pc-datos b { color: var(--text); font-size: 14px; }
.tz-pc-vehiculo { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; font-size: 12.5px; color: var(--text-dim); }
.tz-pc-vehiculo span { display: inline-flex; align-items: center; gap: 5px; }
.tz-pc-placa { padding: 3px 10px; border-radius: 8px; font-weight: 900; letter-spacing: .08em; color: #ff2f9e; background: rgba(255,47,158,0.1);
  border: 1px solid rgba(255,47,158,0.4); text-shadow: 0 0 8px rgba(255,47,158,0.5); }
.tz-pc-desc { margin: 4px 0 0; max-width: 520px; font-size: 13.5px; line-height: 1.5; color: var(--text); white-space: pre-wrap; }
.tz-pc-seccion h2 { margin: 0 0 10px; font-size: 15px; letter-spacing: .08em; text-transform: uppercase; color: #ffd84a; }
@keyframes tz-pc-in { from { opacity: 0; transform: translateY(14px) scale(.98); filter: blur(4px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes tz-pc-portada { from { opacity: 0; transform: scale(1.08); } to { opacity: 1; transform: none; } }
@keyframes tz-pc-foto { from { opacity: 0; transform: scale(.4) rotate(-12deg); } to { opacity: 1; transform: none; } }
`;
