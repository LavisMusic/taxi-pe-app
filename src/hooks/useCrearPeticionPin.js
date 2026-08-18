import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import { ESTADO_PETICION_RESUELTO } from "../lib/taxiEnums";

// Lado PÚBLICO del flujo de recuperación de PIN — la página
// /recuperar-pin (sin sesión, es justo para quien no puede loguearse).
// Bloquea duplicados: si ya hay una petición de este mismo DNI que no
// esté resuelta todavía, no deja crear otra — evita que alguien spamee
// el Centro de Peticiones pidiendo el mismo cambio muchas veces.
export function useCrearPeticionPin() {
  const [loading, setLoading] = useState(false);

  const crear = useCallback(async ({ nombre, dni, placa, tipoUsuario }) => {
    setLoading(true);

    const { data: existente, error: checkError } = await supabase
      .from("peticiones_pin")
      .select("id")
      .eq("dni", dni)
      .neq("estado", ESTADO_PETICION_RESUELTO)
      .maybeSingle();

    if (checkError) {
      setLoading(false);
      return { error: checkError, message: "No se pudo enviar tu solicitud. Intenta de nuevo." };
    }
    if (existente) {
      setLoading(false);
      return {
        error: new Error("duplicado"),
        message: "Ya hay una solicitud en trámite para este DNI. Espera a que el admin la resuelva.",
      };
    }

    const { error: insertError } = await supabase
      .from("peticiones_pin")
      .insert({ nombre, dni, placa: placa || null, tipo_usuario: tipoUsuario });

    setLoading(false);
    if (insertError) {
      return { error: insertError, message: "No se pudo enviar tu solicitud. Intenta de nuevo." };
    }
    return { error: null };
  }, []);

  return { crear, loading };
}
