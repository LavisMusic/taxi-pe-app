import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { subscribeTable } from "./realtime";

/* Reputación de conductores y pasajeros (fase 1a de Reportes y
   reputación). Cada tarjeta pide la suya con useReputacion(tipo, id); las
   pedidas en el mismo instante se juntan en una sola consulta, se guardan
   en memoria y se refrescan solas cuando cambian en la base (Realtime) o
   cuando alguien califica desde este navegador (evento
   "tz-reputacion-cambio"). */

const cache = new Map(); // "tipo:id" -> { rep, etiquetas }
const oyentes = new Map(); // "tipo:id" -> Set<fn>
let porPedir = new Set();
let temporizador = null;
let canal = null;

const clave = (tipo, id) => `${tipo}:${id}`;

function avisar(k) {
  (oyentes.get(k) || []).forEach((fn) => fn(cache.get(k)));
}

async function pedir() {
  temporizador = null;
  const lote = [...porPedir];
  porPedir = new Set();
  if (!lote.length) return;
  const porTipo = {};
  lote.forEach((k) => {
    const [tipo, id] = k.split(":");
    (porTipo[tipo] ||= []).push(id);
  });
  await Promise.all(
    Object.entries(porTipo).map(async ([tipo, ids]) => {
      const [r, e] = await Promise.all([
        supabase.from("taxi_reputacion").select("calificado_id, total, promedio, etiqueta").eq("calificado_tipo", tipo).in("calificado_id", ids),
        supabase.from("taxi_etiquetas").select("calificado_id, etiqueta, color, created_at").eq("calificado_tipo", tipo).in("calificado_id", ids),
      ]);
      ids.forEach((id) => {
        const k = clave(tipo, id);
        cache.set(k, {
          rep: (r.data || []).find((x) => x.calificado_id === id) || null,
          etiquetas: (e.data || [])
            .filter((x) => x.calificado_id === id)
            .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
        });
        avisar(k);
      });
    })
  );
}

function encolar(k) {
  porPedir.add(k);
  if (!temporizador) temporizador = setTimeout(pedir, 40);
}

function refrescarTodo() {
  oyentes.forEach((set, k) => set.size && encolar(k));
}

function asegurarCanal() {
  if (canal) return;
  const cerrarA = subscribeTable("taxi_reputacion", refrescarTodo);
  const cerrarB = subscribeTable("taxi_etiquetas", refrescarTodo);
  window.addEventListener("tz-reputacion-cambio", refrescarTodo);
  canal = () => {
    cerrarA();
    cerrarB();
    window.removeEventListener("tz-reputacion-cambio", refrescarTodo);
  };
}

export function avisarCambioReputacion() {
  window.dispatchEvent(new Event("tz-reputacion-cambio"));
}

export function useReputacion(tipo, id) {
  const k = id ? clave(tipo, id) : null;
  const [valor, setValor] = useState(() => (k ? cache.get(k) : null));
  useEffect(() => {
    if (!k) return undefined;
    asegurarCanal();
    const fn = (v) => setValor(v);
    if (!oyentes.has(k)) oyentes.set(k, new Set());
    oyentes.get(k).add(fn);
    if (cache.has(k)) setValor(cache.get(k));
    else encolar(k);
    return () => {
      oyentes.get(k)?.delete(fn);
    };
  }, [k]);
  return valor || { rep: null, etiquetas: [] };
}
