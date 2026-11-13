import { supabase } from "../supabaseClient";
import { subirComprobantePrivado, subirFotoReporteACaja } from "./comprobantes";

// Enviar un reporte desde Taxi-PE (Mi reputación, en pleno viaje, la
// página del conductor o la ventana de calificar). item: { ref,
// reportado_tipo }; archivo: foto opcional. Un reparto ('entrega:') lo
// resuelve el superadmin en Caja → su foto va al bucket privado de Caja;
// un viaje, al bucket privado de acá (solo el Admin y quien la subió la ven).
export async function reportarServicio(item, motivo, descripcion, archivo) {
  let foto = null;
  if (archivo && String(item.ref).startsWith("entrega:")) {
    const subida = await subirFotoReporteACaja(archivo);
    if (subida.error) return { error: new Error("No se pudo subir la foto. Inténtalo otra vez.") };
    foto = subida.valor;
  } else if (archivo) {
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
}

// El servicio para el botón "Reportar": un viaje (en curso o terminado) o
// tu viaje más reciente con ese conductor. { data: item | null, error }.
export const servicioParaReportar = ({ ref = null, conductorId = null }) =>
  supabase.rpc("taxi_servicio_para_reportar", { p_ref: ref, p_conductor_id: conductorId });
