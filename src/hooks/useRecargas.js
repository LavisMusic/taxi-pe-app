import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import { buildDetalleRecarga, MEMBRESIA_DIAS_EXTENSION } from "../lib/taxiEnums";

// Registra una recarga a un conductor (Recolector o Admin). Si el método
// fue Fiado, la base además abre la deuda en `fiados_conductores`; el
// conductor recibe el beneficio de inmediato en todos los casos.
//
// `diasMembresia`/`cantidadCreditos` vienen del PAQUETE elegido (la base
// los vuelve a leer del paquete; acá solo arman el texto del detalle).
//
// `comprobante` (opcional, Yape/Plin/Otros): { opId, fecha, hora,
// voucherUrl } del escaneo — voucherUrl va a `ventas.voucher_url`, el
// resto se anota al final de `detalle` (texto libre) para que quede en
// el Historial sin necesitar columnas nuevas.

// Mensajes de la base (taxi_registrar_recarga) para cada caso rechazado.
function mensajeRecarga(r) {
  const fecha = r?.vence ? new Date(r.vence).toLocaleDateString("es-PE") : "";
  switch (r?.estado) {
    case "membresia_activa":
      return `Ya tiene una membresía activa hasta el ${fecha} — no se puede recargar otra hasta que esta termine.`;
    case "recolector_sin_membresia":
      return "Necesitas una membresía activa para vender. Cómprala en «Mi membresía».";
    case "recolector_sin_cupo":
      return `Se te acabó el cupo: ya atendiste ${r.usado ?? 0} de ${r.cupo ?? 0} conductores en este periodo. Compra otra membresía para seguir.`;
    case "no_aprobado":
      return "Este conductor está pendiente de aprobación en el Centro de Peticiones. No se pueden procesar pagos aún.";
    case "paquete_invalido":
      return "Ese paquete ya no existe. Elige otro.";
    case "no_existe":
      return "No se encontró al conductor.";
    case "sin_permiso":
      return "Tu sesión no permite registrar recargas. Vuelve a entrar.";
    default:
      return "No se pudo registrar la recarga.";
  }
}

export function useRecargas({ onDone }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Toda la recarga es UNA operación de la base (taxi_registrar_recarga,
  // migración 20261011120000): valida las reglas de créditos/membresías,
  // descuenta al recolector, registra la venta, actualiza al conductor y
  // crea el fiado. Ya no se recarga a clientes (sus créditos son puntos
  // que ganan comprando).
  const registrarRecarga = useCallback(
    async ({ conductor, tipoItem, cantidadCreditos, diasMembresia, paqueteId, metodoPago, comprobante, usarGemas = false, peticionId = null }) => {
      setSaving(true);
      setError("");

      const dias = diasMembresia || MEMBRESIA_DIAS_EXTENSION;
      const detalleBase = buildDetalleRecarga(tipoItem, cantidadCreditos, dias);
      const detalle =
        comprobante && (comprobante.opId || comprobante.fecha || comprobante.hora)
          ? `${detalleBase} · Op: ${comprobante.opId || "s/d"} · ${comprobante.fecha || ""} ${comprobante.hora || ""}`.trim()
          : detalleBase;

      const { data, error: rpcError } = await supabase.rpc("taxi_registrar_recarga", {
        p_conductor_id: conductor?.id,
        p_paquete_id: String(paqueteId ?? ""),
        p_metodo_pago: metodoPago,
        p_voucher_url: comprobante?.voucherUrl || null,
        p_detalle: detalle,
        // Fase 3a de gemas: canjear las gemas del conductor (membresía), o
        // las que ya apartó su petición.
        p_usar_gemas: !!usarGemas,
        p_peticion_id: peticionId != null ? Number(peticionId) : null,
      });
      setSaving(false);
      if (rpcError || data?.estado !== "ok") {
        const message = rpcError ? "No se pudo registrar la recarga." : mensajeRecarga(data);
        setError(message);
        return { error: rpcError || new Error(data?.estado || "error"), message };
      }

      onDone?.();
      // Canje con gemas: la caja del recolector (o del conductor) al instante.
      if (data?.venta?.gemas_usadas > 0) window.dispatchEvent(new Event("tz-gemas-cambio"));
      // La venta creada (con su código TX-… de la base) y el conductor ya
      // actualizado: para el desplegable de venta registrada.
      return { error: null, venta: data.venta, destinatario: data.conductor };
    },
    [onDone]
  );

  return { registrarRecarga, saving, error };
}
