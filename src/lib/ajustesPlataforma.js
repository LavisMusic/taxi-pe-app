import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Ajustes de la plataforma de Taxi PE (tabla taxi_plataforma_ajustes,
// migración 20261211110000): modo mantenimiento y umbral de reportes. Se
// cargan al abrir la app y se mantienen al día por Realtime.
const DEFECTO = { mantenimiento: false, mantenimiento_mensaje: null, umbral_reportes: 0 };

let actual = { ...DEFECTO };
let cargado = false;
const oyentes = new Set();

function aplicar(fila) {
  actual = { ...DEFECTO, ...(fila || {}) };
  cargado = true;
  oyentes.forEach((f) => f(actual));
}

let iniciado = false;
export function iniciarAjustesPlataforma() {
  if (iniciado) return;
  iniciado = true;
  const leer = () =>
    supabase
      .from("taxi_plataforma_ajustes")
      .select("*")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data, error }) => {
        // Sin la migración todavía: sin mantenimiento.
        if (!error) aplicar(data);
      });
  leer();
  supabase
    .channel("taxi-plataforma-ajustes")
    .on("postgres_changes", { event: "*", schema: "public", table: "taxi_plataforma_ajustes" }, (p) => {
      if (p.new) aplicar(p.new);
    })
    .subscribe();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && leer());
}

export function useAjustesPlataforma() {
  const [a, setA] = useState(actual);
  useEffect(() => {
    iniciarAjustesPlataforma();
    oyentes.add(setA);
    if (cargado) setA(actual);
    return () => oyentes.delete(setA);
  }, []);
  return a;
}

// Admin de Taxi (la base lo verifica).
export async function guardarAjustesPlataforma(cambios) {
  const { data, error } = await supabase.rpc("taxi_guardar_ajustes_plataforma", { p: cambios });
  if (!error && data) aplicar(data);
  return { data, error };
}
