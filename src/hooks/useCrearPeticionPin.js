import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import { hashPin } from "../lib/pinAuth";
import { ESTADO_PETICION_PENDIENTE, ESTADO_PETICION_VERIFICADO, ESTADO_PETICION_RESUELTO } from "../lib/taxiEnums";

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

    const { data: existente, error: checkError } = await supabase
      .from("peticiones_pin")
      .select("id, estado")
      .eq("dni", dni)
      .neq("estado", ESTADO_PETICION_RESUELTO)
      .maybeSingle();

    if (checkError) {
      setLoading(false);
      return { error: checkError, message: "No se pudo enviar tu solicitud. Intenta de nuevo." };
    }

    if (existente?.estado === ESTADO_PETICION_VERIFICADO) {
      setLoading(false);
      return { error: null, peticionVerificada: { id: existente.id, dni } };
    }
    if (existente?.estado === ESTADO_PETICION_PENDIENTE) {
      setLoading(false);
      return {
        error: new Error("pendiente"),
        message: "Ya enviaste una solicitud para este DNI — un Admin va a contactarte por WhatsApp para verificar tu identidad antes de dejarte elegir tu PIN nuevo.",
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

  // Paso 2 (self-service): ya verificado por WhatsApp, el propio dueño
  // de la cuenta elige su PIN nuevo acá — nadie más lo ve ni lo elige
  // por él. Busca la cuenta por DNI (mismo criterio que ya usaba el
  // lado Admin en usePeticionesPin.js), guarda el hash y cierra la
  // petición. Devuelve el `usuario` completo para poder loguearlo
  // directo, igual que ya hace useVincularConductor.js en
  // /registro-conductor.
  const fijarNuevoPin = useCallback(async ({ peticionId, dni, nuevoPin }) => {
    setLoading(true);

    const { data: usuario, error: usuarioError } = await supabase
      .from("usuarios")
      .select("*")
      .eq("dni", dni)
      .maybeSingle();
    if (usuarioError || !usuario) {
      setLoading(false);
      return { error: usuarioError || new Error("sin cuenta"), message: "No se encontró tu cuenta. Contacta a un Admin." };
    }

    let pinHash;
    try {
      pinHash = await hashPin(nuevoPin);
    } catch (hashError) {
      setLoading(false);
      return { error: hashError, message: "No se pudo proteger tu PIN. Intenta de nuevo." };
    }

    const { data: usuarioActualizado, error: updateError } = await supabase
      .from("usuarios")
      .update({ pin: pinHash })
      .eq("id", usuario.id)
      .select()
      .single();
    if (updateError || !usuarioActualizado) {
      setLoading(false);
      return { error: updateError || new Error("no actualizado"), message: "No se pudo guardar tu PIN nuevo. Intenta de nuevo." };
    }

    // Si esto falla no revertimos el PIN ya guardado — perder el
    // "cierre" de la petición es un problema cosmético (queda una fila
    // vieja en el Centro de Peticiones del Admin), muy distinto a
    // dejar a la persona sin poder loguearse con su PIN nuevo.
    await supabase.from("peticiones_pin").update({ estado: ESTADO_PETICION_RESUELTO }).eq("id", peticionId);

    setLoading(false);
    return { error: null, usuario: usuarioActualizado };
  }, []);

  return { crear, fijarNuevoPin, loading };
}
