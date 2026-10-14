import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import { ESTADO_PETICION_PENDIENTE, ESTADO_PETICION_VERIFICADO, ESTADO_PETICION_CODIGO_ENVIADO } from "../lib/taxiEnums";

// Lado PÚBLICO del flujo de recuperación de PIN — la página
// /recuperar-pin (sin sesión, es justo para quien no puede loguearse).
//
// Bug reportado: antes, una vez que el Admin verificaba la identidad
// por WhatsApp, era EL ADMIN quien generaba el PIN nuevo y se lo
// mandaba (usePeticionesPin.js/generarYEnviarPin, ahora eliminado) — el
// dueño de la cuenta nunca elegía su propio PIN. El Admin solo debería
// "aceptar" (verificar identidad), no fabricar la contraseña de otro.
// Ahora el 2FA manual por WhatsApp sigue igual (eso sí lo hace el
// Admin), pero el PASO 2 — elegir el PIN nuevo de verdad — lo hace acá,
// el propio dueño de la cuenta, en la MISMA página donde pidió el
// cambio: `crear()` sigue creando la petición la primera vez, pero si
// ya existe una para ese DNI y quedó 'verificado', devuelve esa
// petición para que RecuperarPinPage.jsx cambie al paso "Elegí tu PIN
// nuevo" — sin esto, alguien que ya fue verificado no tendría cómo
// completar el resto del flujo.
export function useCrearPeticionPin() {
  const [loading, setLoading] = useState(false);

  const crear = useCallback(async ({ nombre, dni, placa, tipoUsuario }) => {
    setLoading(true);

    // Estado de la petición abierta de este DNI, sin datos personales
    // (la tabla solo la lee el Admin; ver la migración 20261011100000).
    const { data: existente, error: checkError } = await supabase.rpc("taxi_peticion_pin_estado", { p_dni: dni });

    if (checkError) {
      setLoading(false);
      return { error: checkError, message: "No se pudo enviar tu solicitud. Intenta de nuevo." };
    }

    if (existente?.estado === ESTADO_PETICION_CODIGO_ENVIADO) {
      setLoading(false);
      return {
        error: new Error("codigo_enviado"),
        message: "Ya te enviamos un código por WhatsApp: escríbelo en \"Ya tengo mi código\". Si venció, pide al Admin que te lo reenvíe.",
      };
    }
    if (existente?.estado === ESTADO_PETICION_PENDIENTE || existente?.estado === ESTADO_PETICION_VERIFICADO) {
      setLoading(false);
      return {
        error: new Error("pendiente"),
        message: "Ya enviaste una solicitud para este DNI: un Admin te enviará un código por WhatsApp para que elijas tu PIN nuevo.",
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
