import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import {
  ESTADO_FIADO_ANULADO,
  METODO_PAGO_FIADO,
  parseCantidadCreditosFromDetalle,
  parseDiasMembresiaFromDetalle,
  TIPO_ITEM_CREDITOS,
  TIPO_ITEM_MEMBRESIA,
} from "../lib/taxiEnums";

// Anular una venta: revierte al conductor (resta los créditos que
// había sumado, o le quita los días de membresía que le había
// extendido — parseados del propio `detalle`, NO de la configuración
// actual, para que revertir una venta vieja siga siendo correcta
// aunque el admin haya cambiado la duración después) y marca
// `ventas.anulado = true` — no se borra la fila, queda en el
// Historial con su badge.
//
// Si la venta anulada fue Fiado, busca la deuda vinculada por
// `fiados_conductores.venta_id` y la marca 'anulado' (deja de sumar al
// saldo pendiente, pero el registro queda para auditoría). Si no
// encuentra ninguna (datos de antes de que existiera venta_id), avisa
// al llamador para que el admin la revise a mano.
export function useAnularVenta({ onDone }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const anular = useCallback(
    async (venta, conductor) => {
      setBusyId(venta.id);
      setError("");

      const patch = {};
      if (conductor) {
        if (venta.tipo_item === TIPO_ITEM_MEMBRESIA && conductor.vencimiento_suscripcion) {
          const dias = parseDiasMembresiaFromDetalle(venta.detalle);
          const nuevaFecha = new Date(conductor.vencimiento_suscripcion);
          nuevaFecha.setDate(nuevaFecha.getDate() - dias);
          patch.vencimiento_suscripcion = nuevaFecha.toISOString();
        } else if (venta.tipo_item === TIPO_ITEM_CREDITOS) {
          const cantidad = parseCantidadCreditosFromDetalle(venta.detalle);
          patch.creditos = Math.max(0, Number(conductor.creditos || 0) - cantidad);
        }
      }

      if (conductor && Object.keys(patch).length > 0) {
        const { error: conductorError } = await supabase
          .from("conductores")
          .update(patch)
          .eq("id", conductor.id);
        if (conductorError) {
          setError("No se pudo revertir el saldo del conductor.");
          setBusyId(null);
          return { error: conductorError };
        }
      }

      const { error: ventaError } = await supabase
        .from("ventas")
        .update({ anulado: true })
        .eq("id", venta.id);
      if (ventaError) {
        setError("No se pudo anular la venta.");
        setBusyId(null);
        return { error: ventaError };
      }

      let fiadoEncontrado = true;
      if (venta.metodo_pago === METODO_PAGO_FIADO) {
        const { data: fiado, error: fiadoFetchError } = await supabase
          .from("fiados_conductores")
          .select("id")
          .eq("venta_id", venta.id)
          .maybeSingle();

        if (!fiadoFetchError && fiado) {
          await supabase
            .from("fiados_conductores")
            .update({ estado: ESTADO_FIADO_ANULADO })
            .eq("id", fiado.id);
        } else {
          fiadoEncontrado = false;
        }
      }

      setBusyId(null);
      onDone?.();
      return {
        error: null,
        eraFiado: venta.metodo_pago === METODO_PAGO_FIADO,
        fiadoEncontrado,
      };
    },
    [onDone]
  );

  return { anular, busyId, error };
}
