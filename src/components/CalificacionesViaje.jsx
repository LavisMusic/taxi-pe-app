import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "../supabaseClient";
import CalificarModal from "./CalificarModal";
import { RUTA_ESTRELLA } from "./Estrellas";
import { avisarCambioReputacion } from "../lib/reputacion";

/* Viajes por calificar (fase 1a de Reportes y reputación). Va en la
   pantalla del pasajero y en la del conductor:
   - Al terminar un viaje (y apenas se cierra el chat o el festejo, ver
     `bloqueado`) se abre sola la ventana para calificar UNA vez por viaje.
   - Si se cierra con "Después", queda una pastilla "Califica tu viaje"
     mientras haya pendientes (7 días para calificar). */

const CLAVE = "tz-calificaciones-ofrecidas";
const POLL_MS = 45000;

function leerOfrecidas() {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(CLAVE) || "[]"));
  } catch {
    return new Set();
  }
}
function guardarOfrecida(ref) {
  try {
    const s = leerOfrecidas();
    s.add(ref);
    window.localStorage.setItem(CLAVE, JSON.stringify([...s].slice(-300)));
  } catch {
    /* sin almacenamiento: a lo sumo se vuelve a ofrecer */
  }
}

const fechaCorta = (f) =>
  new Date(f).toLocaleDateString("es-PE", { day: "numeric", month: "short" });

export default function CalificacionesViaje({ bloqueado = false }) {
  const [pendientes, setPendientes] = useState([]);
  const [abierta, setAbierta] = useState(null);
  const bloqueadoRef = useRef(bloqueado);
  bloqueadoRef.current = bloqueado;

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("taxi_calificaciones_pendientes");
    if (error || !Array.isArray(data)) return;
    setPendientes(data);
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, POLL_MS);
    const alVolver = () => document.visibilityState === "visible" && cargar();
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("tz-reputacion-cambio", cargar);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("tz-reputacion-cambio", cargar);
    };
  }, [cargar]);

  // Al cerrar el chat o terminar el festejo, se revisa al toque.
  useEffect(() => {
    if (!bloqueado) cargar();
  }, [bloqueado, cargar]);

  // Abrir sola la ventana del viaje recién terminado (una vez por viaje).
  useEffect(() => {
    if (bloqueado || abierta || !pendientes.length) return undefined;
    const ofrecidas = leerOfrecidas();
    const nuevo = pendientes.find((p) => !ofrecidas.has(p.ref));
    if (!nuevo) return undefined;
    const t = setTimeout(() => {
      if (bloqueadoRef.current) return;
      guardarOfrecida(nuevo.ref);
      setAbierta(nuevo);
    }, 900);
    return () => clearTimeout(t);
  }, [pendientes, bloqueado, abierta]);

  const enviar = async (estrellas, comentario) => {
    const { error } = await supabase.rpc("taxi_calificar", {
      p_ref: abierta.ref,
      p_estrellas: estrellas,
      p_comentario: comentario || null,
    });
    if (error) return { error };
    setPendientes((l) => l.filter((p) => p.ref !== abierta.ref));
    avisarCambioReputacion();
    return {};
  };

  const cerrar = () => setAbierta(null);

  return (
    <>
      {abierta && (
        <CalificarModal
          key={abierta.ref}
          nombre={abierta.nombre}
          foto={abierta.foto_url}
          titulo={abierta.calificado_tipo === "conductor" ? "¿Cómo te fue con tu conductor?" : "¿Qué tal tu pasajero?"}
          detalle={[abierta.detalle, fechaCorta(abierta.fecha)].filter(Boolean).join(" · ")}
          onEnviar={enviar}
          onCerrar={cerrar}
        />
      )}
      {!abierta && !bloqueado && pendientes.length > 0 &&
        createPortal(
          <button type="button" className="tz-calif-pastilla" onClick={() => setAbierta(pendientes[0])}>
            <style>{ESTILO}</style>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={RUTA_ESTRELLA} /></svg>
            Califica tu viaje
            {pendientes.length > 1 && <b>{pendientes.length}</b>}
          </button>,
          document.body
        )}
    </>
  );
}

const ESTILO = `
.tz-calif-pastilla { position: fixed; z-index: 800; left: 50%; bottom: 104px; transform: translateX(-50%);
  display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: 999px; cursor: pointer;
  font: inherit; font-size: 14px; font-weight: 800; color: #1a1300; border: 0;
  background: linear-gradient(110deg, #ffd84a, #ff9500); box-shadow: 0 0 22px rgba(255,216,74,0.55), 0 8px 24px rgba(0,0,0,0.35);
  animation: tz-calif-pastilla-in .6s cubic-bezier(.34,1.56,.64,1) both, tz-calif-pastilla-late 2.4s 1s ease-in-out infinite; }
.tz-calif-pastilla:hover { filter: brightness(1.08); }
.tz-calif-pastilla svg { width: 18px; height: 18px; fill: #fff7cc; filter: drop-shadow(0 0 4px #fff); animation: tz-calif-pastilla-gira 3s linear infinite; }
.tz-calif-pastilla b { min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; display: grid; place-items: center;
  font-size: 11px; color: #ffd84a; background: #1a1300; }
@keyframes tz-calif-pastilla-in { from { opacity: 0; transform: translate(-50%, 30px) scale(.7); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
@keyframes tz-calif-pastilla-late { 0%, 100% { box-shadow: 0 0 22px rgba(255,216,74,0.55), 0 8px 24px rgba(0,0,0,0.35); }
  50% { box-shadow: 0 0 34px rgba(255,216,74,0.85), 0 8px 24px rgba(0,0,0,0.35); } }
@keyframes tz-calif-pastilla-gira { to { transform: rotate(360deg); } }
`;
