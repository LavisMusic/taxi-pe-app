import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

/* ¿Sigue siendo "Nuevo"? (regla: solo los primeros 3 días desde que se
   creó la cuenta y mientras no tenga sus primeras calificaciones; eso
   último lo decide InsigniaReputacion con el total). useEsNuevo(tipo, id)
   — tipo "conductor" (conductores.id) o "pasajero" (usuarios.id). Las
   pedidas en el mismo instante van en una sola consulta (taxi_nuevos,
   migración 20261124100000) y se recuerdan en memoria. Mismo uso que
   src/lib/esNuevo.js de Caja. */

const cache = new Map(); // "tipo:id" -> ms hasta cuándo es nuevo (0 = no)
const oyentes = new Map();
let porPedir = new Set();
let temporizador = null;

const clave = (tipo, id) => `${tipo}:${id}`;

async function consultar(tipo, ids) {
  // "repartidor" = su fila de conductor.
  const { data, error } = await supabase.rpc("taxi_nuevos", { p_tipo: tipo === "repartidor" ? "conductor" : tipo, p_ids: ids });
  return error ? null : data || [];
}

async function pedir() {
  temporizador = null;
  const lote = [...porPedir];
  porPedir = new Set();
  const porTipo = {};
  lote.forEach((k) => {
    const i = k.indexOf(":");
    (porTipo[k.slice(0, i)] ||= []).push(k.slice(i + 1));
  });
  await Promise.all(
    Object.entries(porTipo).map(async ([tipo, ids]) => {
      const filas = await consultar(tipo, ids);
      if (!filas) return;
      ids.forEach((id) => {
        const f = filas.find((x) => String(x.id) === String(id));
        const k = clave(tipo, id);
        cache.set(k, f ? new Date(f.nuevo_hasta).getTime() : 0);
        (oyentes.get(k) || []).forEach((fn) => fn(cache.get(k)));
      });
    })
  );
}

export function useEsNuevo(tipo, id) {
  const k = tipo && id ? clave(tipo, id) : null;
  const [hasta, setHasta] = useState(() => (k ? cache.get(k) ?? 0 : 0));
  useEffect(() => {
    if (!k) {
      setHasta(0);
      return undefined;
    }
    const fn = (v) => setHasta(v || 0);
    if (!oyentes.has(k)) oyentes.set(k, new Set());
    oyentes.get(k).add(fn);
    if (cache.has(k)) setHasta(cache.get(k));
    else {
      porPedir.add(k);
      if (!temporizador) temporizador = setTimeout(pedir, 40);
    }
    return () => {
      oyentes.get(k)?.delete(fn);
    };
  }, [k]);
  return hasta > Date.now();
}
