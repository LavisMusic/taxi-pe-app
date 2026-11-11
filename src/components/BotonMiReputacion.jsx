import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Star, ExternalLink } from "lucide-react";
import { supabase } from "../supabaseClient";
import MiReputacionModal from "./MiReputacionModal";

/* Botón "Reputación" de la cabecera (fase 3b): abre "Mi reputación" del
   pasajero (HomePage) o del conductor/repartidor (ConductorPage), con un
   número por lo que tiene por calificar. */

const TITULOS = {
  conductor: "¿Cómo te fue con tu conductor?",
  pasajero: "¿Qué tal tu pasajero?",
  negocio: "¿Qué tal el negocio?",
  cliente: "¿Qué tal el cliente?",
};
const POLL_MS = 60000;

export default function BotonMiReputacion({ rol, conductorId }) {
  const navigate = useNavigate();
  const [abierto, setAbierto] = useState(false);
  const [num, setNum] = useState(0);

  // Pendientes de este rol (un conductor también puede viajar de pasajero).
  const pendientes = useCallback(async () => {
    const r = await supabase.rpc("taxi_calificaciones_pendientes");
    if (r.error) return r;
    const lista = (Array.isArray(r.data) ? r.data : []).filter((p) =>
      rol === "pasajero" ? p.calificado_tipo === "conductor" : p.calificado_tipo !== "conductor"
    );
    return { data: lista };
  }, [rol]);

  useEffect(() => {
    let activo = true;
    const contar = () =>
      pendientes().then((r) => {
        if (activo && !r.error) setNum(r.data.length);
      });
    contar();
    const t = setInterval(() => document.visibilityState === "visible" && contar(), POLL_MS);
    window.addEventListener("tz-reputacion-cambio", contar);
    return () => {
      activo = false;
      clearInterval(t);
      window.removeEventListener("tz-reputacion-cambio", contar);
    };
  }, [pendientes]);

  const acciones = useMemo(
    () => ({
      resumen: () => supabase.rpc("taxi_mi_reputacion", { p_rol: rol }),
      pendientes,
      calificar: (item, estrellas, comentario) =>
        item.servicio === "entrega"
          ? supabase.rpc("taxi_calificar_entrega", {
              p_entrega_id: item.entrega_id,
              p_calificado_tipo: item.calificado_tipo,
              p_estrellas: estrellas,
              p_comentario: comentario,
            })
          : supabase.rpc("taxi_calificar", { p_ref: item.ref, p_estrellas: estrellas, p_comentario: comentario }),
      borrar: (item) => supabase.rpc("taxi_borrar_calificacion", { p_ref: item.ref, p_calificado_tipo: item.calificado_tipo }),
    }),
    [rol, pendientes]
  );

  return (
    <>
      <button
        className="tz-header-btn"
        onClick={() => setAbierto(true)}
        aria-label="Mi reputación"
        title="Mi reputación"
        style={{ position: "relative" }}
      >
        <Star size={19} />
        <span className="tz-header-btn-label">Reputación</span>
        {num > 0 && <span className="tz-header-btn-badge">{num > 9 ? "+9" : num}</span>}
      </button>
      {abierto && (
        <MiReputacionModal
          acciones={acciones}
          titulos={TITULOS}
          pestanaInicial={num > 0 ? "pendientes" : "estrellas"}
          descripcion={
            rol === "conductor"
              ? "Te califican tus pasajeros y, en los repartos, los negocios y sus clientes."
              : "Te califican los conductores después de cada viaje."
          }
          extra={
            rol === "conductor" && conductorId ? (
              <button type="button" className="tz-mirep-pagina" onClick={() => navigate(`/conductores/${conductorId}`)}>
                <ExternalLink size={15} /> Ver mi página y comentarios
              </button>
            ) : null
          }
          onClose={() => setAbierto(false)}
        />
      )}
    </>
  );
}
