import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { subscribeTable } from "../lib/realtime";
import { copiarComprobantePrivado, subirComprobantePrivado } from "../lib/comprobantes";
import { ESTADO_RECARGA_APROBADO, ESTADO_RECARGA_PENDIENTE, ESTADO_RECARGA_RECHAZADO } from "../lib/taxiEnums";

// Recargas que pide el propio conductor (botón "Recargar" de /conductor):
// membresía o gemas, con Yape/Plin/Otros y la foto del comprobante. Queda
// 'pendiente' hasta que el Admin la aprueba en el Centro de Peticiones
// (pestaña Recargas → Conductores); recién ahí se registra la venta con
// taxi_registrar_recarga, igual que una Recarga Rápida del Admin. La base
// copia el paquete de `paquetes` (precio incluido) y rechaza la petición
// con membresía vigente (migración 20261014170000).

const CAMPOS =
  "id, conductor_id, paquete_id, paquete_nombre, tipo_item, creditos, dias_membresia, monto, metodo_pago, comprobante_url, estado, created_at, resuelto_at";

// Lado conductor: su última petición (para mostrar "en revisión",
// "aprobada" o "rechazada") y crear una nueva.
export function useMiRecargaConductor(conductorId) {
  const [ultima, setUltima] = useState(null);
  const [cargando, setCargando] = useState(true);

  const refresh = useCallback(async () => {
    if (!conductorId) return;
    const { data } = await supabase
      .from("peticiones_recarga_conductor")
      .select(CAMPOS)
      .eq("conductor_id", conductorId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setUltima(data ?? null);
    setCargando(false);
  }, [conductorId]);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(
    () => (conductorId ? subscribeTable("peticiones_recarga_conductor", () => refresh(), { respaldo: true }) : undefined),
    [conductorId, refresh]
  );

  const crear = useCallback(
    async ({ paquete, metodoPago, archivo }) => {
      const { valor, error: errSubida } = await subirComprobantePrivado(archivo, `comprobantes/${conductorId}`);
      if (errSubida) return { error: errSubida, message: "No se pudo subir el comprobante. Intenta de nuevo." };
      const { error } = await supabase.from("peticiones_recarga_conductor").insert({
        conductor_id: conductorId,
        paquete_id: String(paquete.id),
        metodo_pago: metodoPago,
        comprobante_url: valor,
      });
      if (error) {
        const message =
          error.code === "23505"
            ? "Ya tienes una solicitud en revisión."
            : error.code === "22023"
              ? error.message
              : "No se pudo enviar la solicitud.";
        return { error, message };
      }
      await refresh();
      return { error: null };
    },
    [conductorId, refresh]
  );

  const pendiente = ultima?.estado === ESTADO_RECARGA_PENDIENTE ? ultima : null;
  return { ultima, pendiente, cargando, crear, refresh };
}

// Lado Admin: las pendientes de todos los conductores.
export function useRecargasConductorAdmin() {
  const [pendientes, setPendientes] = useState([]);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("peticiones_recarga_conductor")
      .select(CAMPOS)
      .eq("estado", ESTADO_RECARGA_PENDIENTE)
      .order("created_at", { ascending: true });
    if (!error) setPendientes(data ?? []);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => subscribeTable("peticiones_recarga_conductor", () => refresh(), { respaldo: true }), [refresh]);

  // `registrarRecarga` es el de useRecargas (taxi_registrar_recarga): crea
  // la venta y le da la membresía o las gemas al conductor.
  const aprobar = useCallback(
    async (peticion, conductor, registrarRecarga) => {
      if (!conductor) return { error: new Error("No se encontró al conductor.") };
      const { url, error: errCopia } = await copiarComprobantePrivado(peticion.comprobante_url, `admin/${conductor.id}`);
      if (errCopia) return { error: errCopia, message: "No se pudo copiar el comprobante." };
      const r = await registrarRecarga({
        conductor,
        tipoItem: peticion.tipo_item,
        cantidadCreditos: Number(peticion.creditos) || 0,
        diasMembresia: Number(peticion.dias_membresia) || undefined,
        paqueteId: peticion.paquete_id,
        metodoPago: peticion.metodo_pago,
        comprobante: url ? { voucherUrl: url } : null,
      });
      if (r.error) return r;
      await supabase
        .from("peticiones_recarga_conductor")
        .update({
          estado: ESTADO_RECARGA_APROBADO,
          resuelto_at: new Date().toISOString(),
          venta_id: r.venta?.id != null ? String(r.venta.id) : null,
        })
        .eq("id", peticion.id);
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  const rechazar = useCallback(
    async (id) => {
      const { error } = await supabase
        .from("peticiones_recarga_conductor")
        .update({ estado: ESTADO_RECARGA_RECHAZADO, resuelto_at: new Date().toISOString() })
        .eq("id", id);
      if (!error) await refresh();
      return { error };
    },
    [refresh]
  );

  return { pendientes, aprobar, rechazar, refresh };
}
