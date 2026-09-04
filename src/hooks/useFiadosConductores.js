import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { fiadoEstaPendiente } from "../lib/taxiEnums";

// Libreta de fiados — rediseño para calzar con la versión anterior de
// la caja: acá cada CUENTA es un conductor, con un saldo agregado
// (no un ítem individual con su propio botón "Pagado"). `fiados_conductores`
// sigue siendo los CARGOS (igual que antes — una fila por deuda
// generada, típicamente desde una Recarga Rápida en Fiado). Lo nuevo es
// `pagos_fiados_conductores`: cada abono (parcial con "Restar Crédito"
// o total con "Cancelar Cuenta") es una fila ahí, con su método de pago
// y comprobante si fue digital — así queda un historial de cobros
// separado de los cargos, igual que "Cobros registrados" en la versión
// vieja.
//
// saldo(conductor) = suma de cargos PENDIENTES (fiadoEstaPendiente,
// sin tocar esa lógica — un cargo ya anulado por useAnularVenta.js
// sigue excluido igual que siempre) − suma de pagos registrados. No se
// reparte un pago entre cargos puntuales (eso exigiría un ledger por
// ítem); alcanza con el total para reproducir el comportamiento de la
// libreta vieja (un solo número por cliente).
export function useFiadosConductores() {
  const [cargos, setCargos] = useState([]);
  const [pagos, setPagos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const [cargosRes, pagosRes] = await Promise.all([
      supabase
        .from("fiados_conductores")
        .select("id, conductor_id, concepto, monto, estado, fecha_fiado, fecha_pago")
        .order("fecha_fiado", { ascending: false }),
      supabase
        .from("pagos_fiados_conductores")
        .select("id, conductor_id, monto, metodo_pago, comprobante_url, created_at")
        .order("created_at", { ascending: false }),
    ]);

    if (cargosRes.error || pagosRes.error) {
      setError("No se pudo cargar la libreta de fiados.");
      setCargos([]);
      setPagos([]);
    } else {
      setCargos(cargosRes.data ?? []);
      setPagos(pagosRes.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const agregarFiado = useCallback(
    async ({ conductorId, concepto, monto }) => {
      const { error: insertError } = await supabase.from("fiados_conductores").insert({
        conductor_id: conductorId,
        concepto,
        monto,
        fecha_fiado: new Date().toISOString(),
      });
      if (!insertError) await refresh();
      return { error: insertError };
    },
    [refresh]
  );

  // Registra un abono (parcial o total) contra el saldo agregado de un
  // conductor — "Restar Crédito" y "Cancelar Cuenta" en el modal son la
  // misma operación, solo cambia si `monto` viene prellenado con el
  // saldo completo o no. `comprobanteUrl` solo aplica a Yape/Plin/Otros
  // (el escaneo es obligatorio para esos métodos, ver LibretaFiadosModal).
  const registrarPago = useCallback(
    async ({ conductorId, monto, metodoPago, comprobanteUrl }) => {
      const { error: insertError } = await supabase.from("pagos_fiados_conductores").insert({
        conductor_id: conductorId,
        monto,
        metodo_pago: metodoPago,
        comprobante_url: comprobanteUrl || null,
      });
      if (!insertError) await refresh();
      return { error: insertError };
    },
    [refresh]
  );

  // Blindaje de Cuentas Fiadas (guard clause): "Eliminar" borra la
  // cuenta entera de un conductor — no tiene sentido dejar borrar el
  // rastro de una deuda que TODAVÍA no se cobró, sería la forma más
  // fácil de "perdonar" una deuda sin que quede registro. Antes de
  // tocar nada, relee el saldo REAL desde la base (no confía en un
  // número que le pase el caller, que podría estar desactualizado) —
  // mismo cálculo exacto que `porConductor` de más abajo (cargos
  // pendientes − pagos), pero acotado a este conductor puntual. El
  // Admin sigue pudiendo "Restar Crédito"/"Cancelar Cuenta"
  // (registrarPago, sin cambios) para bajar el saldo a 0 — recién ahí
  // esto deja borrar.
  const eliminarCuentaConductor = useCallback(
    async (conductorId) => {
      const [cargosRes, pagosRes] = await Promise.all([
        supabase.from("fiados_conductores").select("monto, estado").eq("conductor_id", conductorId),
        supabase.from("pagos_fiados_conductores").select("monto").eq("conductor_id", conductorId),
      ]);
      if (cargosRes.error || pagosRes.error) return { error: cargosRes.error || pagosRes.error };

      const totalPendiente = (cargosRes.data ?? [])
        .filter(fiadoEstaPendiente)
        .reduce((sum, c) => sum + Number(c.monto || 0), 0);
      const totalPagado = (pagosRes.data ?? []).reduce((sum, p) => sum + Number(p.monto || 0), 0);
      const saldoReal = totalPendiente - totalPagado;
      if (saldoReal > 0) {
        return {
          error: new Error(
            `Esta cuenta todavía debe ${saldoReal.toFixed(2)} — salda la deuda (Restar Crédito/Cancelar Cuenta) antes de poder eliminarla.`
          ),
        };
      }

      const [r1, r2] = await Promise.all([
        supabase.from("fiados_conductores").delete().eq("conductor_id", conductorId),
        supabase.from("pagos_fiados_conductores").delete().eq("conductor_id", conductorId),
      ]);
      if (r1.error || r2.error) return { error: r1.error || r2.error };
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  // Agrupado por conductor: saldo (cargos pendientes − pagos) + listas
  // separadas de cargos y pagos para mostrar el detalle expandible,
  // mismo espíritu que FiadoDetalle.jsx tenía en el sistema viejo
  // (items adeudados / cobros registrados) pero con los nombres de
  // campo de acá.
  const porConductor = {};
  const getEntry = (conductorId) => {
    if (!porConductor[conductorId]) {
      porConductor[conductorId] = { saldo: 0, cargos: [], pagos: [] };
    }
    return porConductor[conductorId];
  };
  for (const c of cargos) {
    if (!c.conductor_id) continue;
    const entry = getEntry(c.conductor_id);
    entry.cargos.push(c);
    if (fiadoEstaPendiente(c)) entry.saldo += Number(c.monto || 0);
  }
  for (const p of pagos) {
    if (!p.conductor_id) continue;
    const entry = getEntry(p.conductor_id);
    entry.pagos.push(p);
    entry.saldo -= Number(p.monto || 0);
  }

  return {
    cargos,
    pagos,
    porConductor,
    loading,
    error,
    refresh,
    agregarFiado,
    registrarPago,
    eliminarCuentaConductor,
  };
}
