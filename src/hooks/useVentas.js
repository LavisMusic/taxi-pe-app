import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { subscribeTable } from "../lib/realtime";
import {
  COSTO_OPERATIVO_DIARIO,
  startOfTodayISO,
  TIPO_ITEM_CREDITOS,
  TIPO_ITEM_MEMBRESIA,
} from "../lib/taxiEnums";

// Trae TODO `ventas` una sola vez y deriva "hoy" filtrando en el
// cliente por created_at — no hay columna `fecha` separada. Para un
// volumen chico (recargas de conductores, no ventas de un POS masivo)
// esto es más simple que dos queries; si la tabla crece mucho conviene
// mover el conteo/suma a una vista o RPC en Postgres.
export function useVentas() {
  const [ventas, setVentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Fix Realtime Saldos: antes esta tabla NUNCA se resuscribía a
  // cambios — el Admin viendo el turno/recaudado de un Recolector (o el
  // Recolector viendo su propio total) solo se enteraba de una venta
  // nueva de OTRO dispositivo/pestaña con un F5 manual. Mismo patrón ya
  // usado en useConductoresPublicos.js: `yaCargoUnaVez` evita que cada
  // evento de Realtime vuelva a tapar la pantalla con el spinner de
  // carga completo — solo la primerísima carga lo muestra.
  const yaCargoUnaVez = useRef(false);

  const refresh = useCallback(async () => {
    if (!yaCargoUnaVez.current) setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("ventas")
      .select(
        "id, codigo_venta, conductor_id, recolector_id, tipo_item, detalle, monto, metodo_pago, voucher_url, anulado, created_at"
      )
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError("No se pudieron cargar las ventas.");
      setVentas([]);
    } else {
      setVentas(data ?? []);
    }
    yaCargoUnaVez.current = true;
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Sincronización Realtime de Saldos: cualquier venta/recarga nueva (la
  // dispare el propio Recolector, otro Recolector desde otro celular, o
  // el Admin desde RecargaRapidaRecolectorForm.jsx) refresca esta lista
  // sola — el Admin ve el saldo/turno acumulado de CADA Recolector en
  // vivo, sin F5.
  useEffect(() => subscribeTable("ventas", () => refresh()), [refresh]);

  // `ventas` trae TODO (incluidas las anuladas) — el Historial necesita
  // mostrarlas con su badge. Todo lo demás (métricas, turno del
  // recolector, ranking) usa `ventasVigentes`: una venta anulada nunca
  // se cobró de verdad, así que no debe sumar a nada.
  const ventasVigentes = ventas.filter((v) => !v.anulado);

  const startToday = startOfTodayISO();
  const ventasHoy = ventasVigentes.filter((v) => v.created_at && v.created_at >= startToday);

  const recaudadoHoy = ventasHoy.reduce((sum, v) => sum + Number(v.monto || 0), 0);
  const gananciaNetaHoy = recaudadoHoy - COSTO_OPERATIVO_DIARIO;

  // "Conteo de ventas donde tipo_item === 'membresia'" — el enunciado
  // no dice "hoy" para esta métrica (a diferencia de Recaudado y
  // Créditos Vendidos), así que es un conteo histórico total.
  const membresiasActivas = ventasVigentes.filter((v) => v.tipo_item === TIPO_ITEM_MEMBRESIA).length;

  // "Suma de créditos recargados hoy": no existe columna de cantidad
  // de créditos, solo `monto` (soles) y `detalle` (texto libre) — se
  // suma el monto en soles de las ventas de tipo créditos de hoy.
  const creditosVendidosHoy = ventasHoy
    .filter((v) => v.tipo_item === TIPO_ITEM_CREDITOS)
    .reduce((sum, v) => sum + Number(v.monto || 0), 0);

  return {
    ventas,
    ventasVigentes,
    ventasHoy,
    loading,
    error,
    refresh,
    metrics: {
      recaudadoHoy,
      gananciaNetaHoy,
      membresiasActivas,
      creditosVendidosHoy,
    },
  };
}
