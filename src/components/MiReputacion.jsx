import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { supabase } from "../supabaseClient";
import { subirComprobantePrivado, subirFotoReporteACaja } from "../lib/comprobantes";
import MiReputacionModal, { TarjetaReputacion } from "./MiReputacionModal";

/* "Mi reputación" (fase 3b) dentro de "Mi perfil" del pasajero y del
   conductor/repartidor: la tarjeta con el resumen abre MiReputacionModal.
   usePendientesReputacion(rol): cuántos tiene por calificar (el número del
   botón "Editar Perfil" de la cabecera). */

const TITULOS = {
  conductor: "¿Cómo te fue con tu conductor?",
  pasajero: "¿Qué tal tu pasajero?",
  negocio: "¿Qué tal el negocio?",
  cliente: "¿Qué tal el cliente?",
};
const POLL_MS = 60000;

// Pendientes de este rol (un conductor también puede viajar de pasajero).
async function leerPendientes(rol) {
  const r = await supabase.rpc("taxi_calificaciones_pendientes");
  if (r.error) return r;
  const lista = (Array.isArray(r.data) ? r.data : []).filter((p) =>
    rol === "pasajero" ? p.calificado_tipo === "conductor" : p.calificado_tipo !== "conductor"
  );
  return { data: lista };
}

export function usePendientesReputacion(rol) {
  const [num, setNum] = useState(0);
  useEffect(() => {
    if (!rol) {
      setNum(0);
      return undefined;
    }
    let activo = true;
    const contar = () =>
      leerPendientes(rol).then((r) => {
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
  }, [rol]);
  return num;
}

export default function TarjetaMiReputacion({ rol, conductorId }) {
  const navigate = useNavigate();
  const [abierto, setAbierto] = useState(false);
  const [resumen, setResumen] = useState(null);
  const num = usePendientesReputacion(rol);

  const pendientes = useCallback(() => leerPendientes(rol), [rol]);
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
      // Fase 4a: pestaña "Reportes" (viajes de los últimos 30 días).
      reportes: {
        leer: () => supabase.rpc("taxi_mis_reportes", { p_rol: rol }),
        reportar: async (item, motivo, descripcion, archivo) => {
          let foto = null;
          if (archivo && String(item.ref).startsWith("entrega:")) {
            // Reparto (4b-2): el negocio o el cliente los resuelve el
            // superadmin en Caja → la foto va al bucket privado de Caja.
            const subida = await subirFotoReporteACaja(archivo);
            if (subida.error) return { error: new Error("No se pudo subir la foto. Inténtalo otra vez.") };
            foto = subida.valor;
          } else if (archivo) {
            // Bucket privado: solo el Admin y quien la subió la ven.
            const { data } = await supabase.auth.getSession();
            const uid = data?.session?.user?.id;
            if (!uid) return { error: new Error("Inicia sesión para reportar.") };
            const subida = await subirComprobantePrivado(archivo, `reportes/${uid}`);
            if (subida.error) return { error: new Error("No se pudo subir la foto. Inténtalo otra vez.") };
            foto = subida.valor;
          }
          return supabase.rpc("taxi_reportar", {
            p_ref: item.ref,
            p_reportado_tipo: item.reportado_tipo,
            p_motivo: motivo,
            p_descripcion: descripcion,
            p_foto: foto,
          });
        },
      },
    }),
    [rol, pendientes]
  );

  useEffect(() => {
    let activo = true;
    const leer = () =>
      acciones.resumen().then(({ data, error }) => {
        if (activo && !error && data) setResumen(data);
      });
    leer();
    window.addEventListener("tz-reputacion-cambio", leer);
    return () => {
      activo = false;
      window.removeEventListener("tz-reputacion-cambio", leer);
    };
  }, [acciones]);

  return (
    <>
      <TarjetaReputacion resumen={resumen} pendientes={num} onAbrir={() => setAbierto(true)} />
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
