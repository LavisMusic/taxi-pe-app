import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// WhatsApp de contacto de la plataforma (pagos / soporte / afiliación).
// Se edita en el panel /superadmin de Caja Tonazo y llega acá copiado
// por webhook (tabla plataforma_contacto, una sola fila).
//
// Cache a nivel de módulo + UN solo canal de Realtime compartido por
// todos los componentes que lo usan: cuando el super admin guarda un
// cambio, cada botón/aviso montado se actualiza al instante, sin
// recargar la página.
const CAMPOS = "whatsapp_pagos, whatsapp_soporte, whatsapp_afiliacion";
let cache = null;
let enVuelo = null;
let canal = null;
const oyentes = new Set();

function publicar(nuevo) {
  cache = nuevo || {};
  oyentes.forEach((fn) => fn(cache));
}

function cargar() {
  if (!enVuelo) {
    enVuelo = supabase
      .from("plataforma_contacto")
      .select(CAMPOS)
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        publicar(data || {});
        return cache;
      })
      .catch(() => {
        enVuelo = null;
        return {};
      });
  }
  return enVuelo;
}

function escuchar() {
  if (canal) return;
  canal = supabase
    .channel("plataforma-contacto")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "plataforma_contacto" },
      ({ new: fila }) => {
        if (fila && fila.id === 1) publicar({ ...(cache || {}), ...fila });
      }
    )
    .subscribe();
}

// Después de guardar en el gestor: se publica ya mismo, sin esperar el
// eco de Realtime.
export function invalidarContactoPlataforma(nuevo) {
  if (nuevo) publicar({ ...(cache || {}), ...nuevo });
  enVuelo = nuevo ? Promise.resolve(cache) : null;
}

export function useContactoPlataforma() {
  const [contacto, setContacto] = useState(cache);

  useEffect(() => {
    oyentes.add(setContacto);
    escuchar();
    if (!cache) cargar();
    else setContacto(cache);
    return () => {
      oyentes.delete(setContacto);
    };
  }, []);

  return contacto || {};
}
