import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// WhatsApp de contacto de la plataforma (pagos / soporte / afiliación).
// Se edita en el panel /superadmin de Caja Tonazo y llega acá copiado
// por webhook (tabla plataforma_contacto, una sola fila). Cache a nivel
// de módulo: varios botones en la misma pantalla comparten UNA consulta.
let cache = null;
let enVuelo = null;

function cargar() {
  if (!enVuelo) {
    enVuelo = supabase
      .from("plataforma_contacto")
      .select("whatsapp_pagos, whatsapp_soporte, whatsapp_afiliacion")
      .eq("id", 1)
      .maybeSingle()
      .then(({ data }) => {
        cache = data || {};
        return cache;
      })
      .catch(() => {
        enVuelo = null;
        return {};
      });
  }
  return enVuelo;
}

export function useContactoPlataforma() {
  const [contacto, setContacto] = useState(cache);

  useEffect(() => {
    if (cache) return undefined;
    let activo = true;
    cargar().then((c) => {
      if (activo) setContacto(c);
    });
    return () => {
      activo = false;
    };
  }, []);

  return contacto || {};
}
