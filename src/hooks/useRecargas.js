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
// la venta, actualiza al conductor O AL CLIENTE (créditos o
// vencimiento, según `destinatarioTipo` — unificación pasajero/cliente)
// y, si el método fue Fiado, además abre una deuda en
// `fiados_conductores` (solo aplica a conductor: un cliente no tiene
// libreta de fiados) — el destinatario recibe el beneficio de
// inmediato en todos los casos, "Fiado" solo cambia de dónde sale la
// plata (no se cobró hoy, queda pendiente en la Libreta en vez de
// contarse como recaudado).
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
    async ({
      destinatarioTipo = "conductor",
      conductor,
      cliente,
      recolectorId,
      tipoItem,
      monto,
      cantidadCreditos,
      diasMembresia,
      // Bienvenida en varias partes — "Membresía Activada": antes esta
      // venta solo sumaba días a `vencimiento_suscripcion`, sin dejar
      // registrado CUÁL paquete fue. Con `paqueteId` guardado en
      // `conductores.membresia_paquete_id`, ConductorPage.jsx puede
      // detectar en tiempo real (ver useMembresiaActivadaNeon.js) que
      // cambió de membresía y mostrar su nombre/descripción reales.
      //
      // "Compra Confirmada" (créditos): `paqueteNombre`/`paqueteDescripcion`
      // se guardan tal cual — no una referencia al paquete — porque acá
      // lo que hace falta es un "recibo" de lo que se compró en ESE
      // momento (ver useCompraCreditosNeon.js), no un estado "activo"
      // como el de membresía.
      paqueteId,
      paqueteNombre,
      paqueteDescripcion,
      metodoPago,
      comprobante,
    }) => {
      setSaving(true);
      setError("");

      const esCliente = destinatarioTipo === "cliente";
      const destinatario = esCliente ? cliente : conductor;
      const tablaDestino = esCliente ? "usuarios" : "conductores";
      // Mismo campo de negocio, distinto nombre de columna según la
      // audiencia — conductores.vencimiento_suscripcion/.creditos vs
      // usuarios.membresia_vencimiento/.creditos_disponibles (estas
      // últimas ya existían, las usa la autorecarga del recolector).
      const campoVencimiento = esCliente ? "membresia_vencimiento" : "vencimiento_suscripcion";
      const campoCreditos = esCliente ? "creditos_disponibles" : "creditos";

      // Bug/pedido: no se puede vender una membresía nueva a alguien
      // que YA tiene una vigente — antes esto simplemente EXTENDÍA el
      // vencimiento actual (sumaba días sobre lo que ya tenía), lo cual
      // además pisaba `membresia_paquete_id` con el paquete nuevo aunque
      // el viejo todavía no hubiera terminado. Ahora se bloquea de raíz
      // hasta que la vigente termine. Esto NO aplica a créditos — los
      // créditos se siguen pudiendo sumar en cualquier momento.
      if (tipoItem === TIPO_ITEM_MEMBRESIA) {
        const vencimientoActual = destinatario[campoVencimiento] ? new Date(destinatario[campoVencimiento]) : null;
        if (vencimientoActual && vencimientoActual > new Date()) {
          const message = `Ya tiene una membresía activa hasta el ${vencimientoActual.toLocaleDateString("es-PE")} — no se puede recargar otra hasta que esta termine.`;
          setError(message);
          setSaving(false);
          return { error: new Error("membresia_activa"), message };
        }
      }

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
          conductor_id: esCliente ? null : conductor.id,
          cliente_id: esCliente ? cliente.id : null,
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
        const vencimientoActual = destinatario[campoVencimiento] ? new Date(destinatario[campoVencimiento]) : null;
        const base = vencimientoActual && vencimientoActual > new Date() ? vencimientoActual : new Date();
        base.setDate(base.getDate() + dias);
        patch[campoVencimiento] = base.toISOString();
        // Explícito siempre (incluso `null` si por lo que sea no llegó
        // paqueteId) — nunca dejamos que quede el valor viejo puesto:
        // si esto es un downgrade a otro paquete, tiene que reflejar el
        // NUEVO, no arrastrar el anterior.
        patch.membresia_paquete_id = paqueteId ?? null;
      } else {
        patch[campoCreditos] = Number(destinatario[campoCreditos] || 0) + Number(cantidadCreditos);
        // Descuento de Créditos (24h, SOLO conductor): el reloj de "1
        // crédito cada 24h" arranca (o se REINICIA) exactamente cuando
        // el conductor pasa de 0/sin créditos a tener saldo de nuevo —
        // "activó su compra" literal. Un cliente no tiene este descuento
        // automático (sus créditos se consumen por uso, no por reloj),
        // así que esto no le aplica.
        if (!esCliente && Number(destinatario[campoCreditos] || 0) <= 0) {
          patch.ultimo_descuento_creditos = new Date().toISOString();
        }
        // "Compra Confirmada" (pedido nuevo): a diferencia de la
        // membresía, acá SIEMPRE se pisa con la compra más reciente —
        // no hay noción de "cambió de paquete", cualquier compra de
        // créditos (repita el mismo paquete o no) es una novedad que
        // vale la pena confirmarle al destinatario.
        patch.ultimo_paquete_creditos_nombre = paqueteNombre ?? null;
        patch.ultimo_paquete_creditos_descripcion = paqueteDescripcion ?? null;
        patch.ultima_compra_creditos_at = new Date().toISOString();
      }

      const { data: destinatarioActualizado, error: destinatarioError } = await supabase
        .from(tablaDestino)
        .update(patch)
        .eq("id", destinatario.id)
        .select();
      if (destinatarioError) {
        setError(`La venta se registró, pero no se pudo actualizar ${esCliente ? "al cliente" : "al conductor"}.`);
        setSaving(false);
        return { error: destinatarioError };
      }
      if (!destinatarioActualizado || destinatarioActualizado.length === 0) {
        setError(
          `La venta se registró, pero ${esCliente ? "el cliente" : "el conductor"} no se actualizó (0 filas — revisa la política RLS de UPDATE en \`${tablaDestino}\`).`
        );
        setSaving(false);
        return { error: new Error("0 filas afectadas") };
      }

      // Fiado: solo tiene sentido para conductor (Libreta de Fiados es
      // un concepto de conductor/negocio, un cliente no tiene una) — el
      // formulario ya oculta este método de pago cuando la audiencia es
      // cliente, esto es el respaldo del lado del hook.
      if (!esCliente && metodoPago === METODO_PAGO_FIADO) {
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
