import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import { hashPin } from "../lib/pinAuth";
import { ESTADOS_CONDUCTOR_OPERATIVOS } from "../lib/taxiEnums";

// El puente final: un conductor pre-registrado por un Recolector tiene
// fila en `conductores` (nombre/placa/telefono/...) pero NINGUNA fila
// en `usuarios` — no puede loguearse todavía. Este hook resuelve las
// dos mitades de /registro-conductor:
//   1) buscarPreRegistro: ¿existe un `conductores.telefono` así?
//   2) crearCuenta: crea la fila en `usuarios` con ESE MISMO teléfono
//      — no hace falta escribir nada en `conductores`, el vínculo YA
//      es el teléfono compartido (useConductorSesion.js busca por ahí).
//
// Sin verificación por SMS/OTP: cualquiera que sepa el teléfono de un
// conductor pre-registrado podría, en teoría, crear la cuenta a su
// nombre. Mismo nivel de confianza que el resto del login (DNI+PIN sin
// verificación) — aceptable para el MVP, pero es el primer candidato a
// endurecer junto con las policies RLS pendientes.
export function useVincularConductor() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Cada función DEVUELVE su propio mensaje de error (además de
  // guardarlo en el estado del hook) — el estado solo se actualiza en
  // el próximo render, así que si el componente lo leyera del closure
  // justo después del `await` (en vez del valor devuelto) leería el
  // valor viejo, de ANTES de esta llamada.
  const buscarPreRegistro = useCallback(async (telefono) => {
    setError("");
    const { data, error: fetchError } = await supabase
      .from("conductores")
      .select("id, nombre, placa, estado")
      .eq("telefono", telefono)
      .maybeSingle();

    if (fetchError) {
      const message = "No se pudo buscar tu registro. Intenta de nuevo.";
      setError(message);
      return { conductor: null, message };
    }
    if (!data) {
      const message =
        "No encontramos un conductor con ese teléfono. Pide a un recolector que te registre primero.";
      setError(message);
      return { conductor: null, message };
    }
    const estadoValido = ESTADOS_CONDUCTOR_OPERATIVOS.some((e) => e.value === data.estado);
    return { conductor: data, yaOperativo: estadoValido };
  }, []);

  const crearCuenta = useCallback(async ({ dni, telefono, pin, nombre }) => {
    setLoading(true);
    setError("");

    // Evita duplicados: ya hay una cuenta con ese DNI o ese teléfono.
    const { data: existente, error: checkError } = await supabase
      .from("usuarios")
      .select("id")
      .or(`dni.eq.${dni},telefono.eq.${telefono}`)
      .maybeSingle();

    if (checkError) {
      const message = "No se pudo verificar tus datos. Intenta de nuevo.";
      setError(message);
      setLoading(false);
      return { error: checkError, message };
    }
    if (existente) {
      const message = "Ya existe una cuenta con ese DNI o teléfono.";
      setError(message);
      setLoading(false);
      return { error: new Error("duplicado"), message };
    }

    let pinHash;
    try {
      pinHash = await hashPin(pin);
    } catch (hashErr) {
      const message = "No se pudo proteger tu PIN. Intenta de nuevo.";
      setError(message);
      setLoading(false);
      return { error: hashErr, message };
    }

    const { data: nuevoUsuario, error: insertError } = await supabase
      .from("usuarios")
      .insert({ dni, telefono, pin: pinHash, nombre, rol: "conductor" })
      .select()
      .single();

    setLoading(false);
    if (insertError) {
      const message = "No se pudo crear tu cuenta. Intenta de nuevo.";
      setError(message);
      return { error: insertError, message };
    }
    return { usuario: nuevoUsuario, error: null };
  }, []);

  return { buscarPreRegistro, crearCuenta, loading, error };
}
