import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import {
  buildDetalleRecarga,
  generarCodigoVenta,
  MEMBRESIA_DIAS_EXTENSION,
  METODO_PAGO_FIADO,
  TIPO_ITEM_MEMBRESIA,
} from "../lib/taxiEnums";

// Registra una recarga completa del Recolector (o del Admin): inserta
// la venta, actualiza al conductor (créditos o vencimiento) y, si el
// método fue Fiado, además abre una deuda en `fiados_conductores` — el
// conductor recibe el beneficio de inmediato en todos los casos,
// "Fiado" solo cambia de dónde sale la plata (no se cobró hoy, queda
// pendiente en la Libreta en vez de contarse como recaudado).
//
// `diasMembresia` ahora viene del PAQUETE elegido en Recarga Rápida
// (cada paquete de tipo "membresia" define su propia duración) — se
// pasa por llamada, no por hook, para que dos paquetes distintos en la
// misma sesión no compartan un valor fijo. Si no se pasa (no debería
// pasar con la UI actual, pero por las dudas), cae al respaldo de
// taxiEnums.js.
//
// `comprobante` (opcional, Yape/Plin/Otros): { opId, fecha, hora,
// voucherUrl } del escaneo — voucherUrl va a `ventas.voucher_url`, el
// resto se anota al final de `detalle` (texto libre) para que quede en
// el Historial sin necesitar columnas nuevas.
export function useRecargas({ onDone }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const registrarRecarga = useCallback(
    async ({ conductor, recolectorId, tipoItem, monto, cantidadCreditos, diasMembresia, metodoPago, comprobante }) => {
      setSaving(true);
      setError("");

      const dias = diasMembresia || MEMBRESIA_DIAS_EXTENSION;
      const detalleBase = buildDetalleRecarga(tipoItem, cantidadCreditos, dias);
      const detalle =
        comprobante && (comprobante.opId || comprobante.fecha || comprobante.hora)
          ? `${detalleBase} · Op: ${comprobante.opId || "s/d"} · ${comprobante.fecha || ""} ${comprobante.hora || ""}`.trim()
          : detalleBase;

      // select().single() para recuperar el id de la venta recién
      // creada: fiados_conductores.venta_id lo necesita para que
      // Anular pueda encontrar exactamente esta deuda después.
      const { data: ventaCreada, error: ventaError } = await supabase
        .from("ventas")
        .insert({
          codigo_venta: generarCodigoVenta(),
          conductor_id: conductor.id,
          recolector_id: recolectorId,
          tipo_item: tipoItem,
          detalle,
          monto,
          metodo_pago: metodoPago,
          voucher_url: comprobante?.voucherUrl || null,
        })
        .select()
        .single();
      if (ventaError) {
        setError("No se pudo registrar la venta.");
        setSaving(false);
        return { error: ventaError };
      }

      const patch = {};
      if (tipoItem === TIPO_ITEM_MEMBRESIA) {
        const vencimientoActual = conductor.vencimiento_suscripcion
          ? new Date(conductor.vencimiento_suscripcion)
          : null;
        const base = vencimientoActual && vencimientoActual > new Date() ? vencimientoActual : new Date();
        base.setDate(base.getDate() + dias);
        patch.vencimiento_suscripcion = base.toISOString();
      } else {
        patch.creditos = Number(conductor.creditos || 0) + Number(cantidadCreditos);
      }

      const { data: conductorActualizado, error: conductorError } = await supabase
        .from("conductores")
        .update(patch)
        .eq("id", conductor.id)
        .select();
      if (conductorError) {
        setError("La venta se registró, pero no se pudo actualizar al conductor.");
        setSaving(false);
        return { error: conductorError };
      }
      if (!conductorActualizado || conductorActualizado.length === 0) {
        setError(
          "La venta se registró, pero el conductor no se actualizó (0 filas — revisa la política RLS de UPDATE en `conductores`)."
        );
        setSaving(false);
        return { error: new Error("0 filas afectadas") };
      }

      if (metodoPago === METODO_PAGO_FIADO) {
        const { error: fiadoError } = await supabase.from("fiados_conductores").insert({
          conductor_id: conductor.id,
          venta_id: ventaCreada.id,
          concepto: detalle,
          monto,
          fecha_fiado: new Date().toISOString(),
        });
        if (fiadoError) {
          setError("La venta y el conductor se actualizaron, pero no se pudo generar el fiado.");
          setSaving(false);
          return { error: fiadoError };
        }
      }

      setSaving(false);
      onDone?.();
      return { error: null };
    },
    [onDone]
  );

  return { registrarRecarga, saving, error };
}
