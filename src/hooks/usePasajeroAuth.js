import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import { hashPin, verifyPin } from "../lib/pinAuth";

// Registro/Login específico de Pasajero — a diferencia de LoginPage.jsx
// (DNI+Teléfono+PIN, pensado para Conductor/Recolector que YA tienen
// una cuenta creada por el Recolector o el Admin), acá cualquiera se da
// de alta solo: el Registro pide DNI+Teléfono+PIN, pero una vez creada
// la cuenta el Login diario solo pide Teléfono+PIN — un pasajero no
// necesita cargar con su DNI encima para pedir un taxi.
export function usePasajeroAuth() {
  const [loading, setLoading] = useState(false);

  const registrar = useCallback(async ({ nombre, dni, telefono, pin }) => {
    setLoading(true);
    const { data: existente, error: checkError } = await supabase
      .from("usuarios")
      .select("id")
      .or(`dni.eq.${dni},telefono.eq.${telefono}`)
      .maybeSingle();

    if (checkError) {
      setLoading(false);
      return { error: checkError, message: "No se pudo verificar tus datos. Intenta de nuevo." };
    }
    if (existente) {
      setLoading(false);
      return { error: new Error("duplicado"), message: "Ya existe una cuenta con ese DNI o teléfono." };
    }

    let pinHash;
    try {
      pinHash = await hashPin(pin);
    } catch (hashError) {
      setLoading(false);
      return { error: hashError, message: "No se pudo proteger tu PIN. Intenta de nuevo." };
    }

    const { data, error: insertError } = await supabase
      .from("usuarios")
      .insert({ dni, telefono, pin: pinHash, nombre, rol: "pasajero" })
      .select()
      .single();

    setLoading(false);
    if (insertError) {
      return { error: insertError, message: "No se pudo crear tu cuenta. Intenta de nuevo." };
    }
    return { usuario: data, error: null };
  }, []);

  // `pin` puede llegar vacío a propósito — el form ya no exige el
  // formato ANTES de saber si esta cuenta tiene PIN o no (puede ser un
  // pasajero de alta manual del Admin, que ahora nace sin PIN). Si
  // `data.pin` es null, ese hallazgo por teléfono YA es la prueba de
  // identidad (nadie más tiene ese teléfono) — se devuelve
  // `usuarioSinPin` para que el form pase al paso de "Crea tu PIN",
  // mismo criterio que StaffLoginForm.jsx usa para conductor/recolector.
  const login = useCallback(async ({ telefono, pin }) => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("usuarios")
      .select("*")
      .eq("telefono", telefono)
      .eq("rol", "pasajero")
      .maybeSingle();

    if (fetchError) {
      setLoading(false);
      return { error: fetchError, message: "No se pudo verificar tus datos. Intenta de nuevo." };
    }
    if (!data) {
      setLoading(false);
      return { error: new Error("no encontrado"), message: "Teléfono o PIN incorrectos." };
    }

    if (!data.pin) {
      setLoading(false);
      return { usuarioSinPin: data, error: null };
    }

    if (!/^\d{6}$/.test(pin)) {
      setLoading(false);
      return { error: new Error("pin invalido"), message: "El PIN debe tener 6 dígitos." };
    }

    let valido = false;
    try {
      valido = await verifyPin(pin, data.pin);
    } catch (verifyError) {
      setLoading(false);
      return { error: verifyError, message: "No se pudo verificar tu PIN. Intenta de nuevo." };
    }

    setLoading(false);
    if (!valido) {
      return { error: new Error("pin incorrecto"), message: "Teléfono o PIN incorrectos." };
    }
    return { usuario: data, error: null };
  }, []);

  // Paso 2 del primer ingreso: crea y guarda el PIN de una cuenta que
  // nació sin uno (alta manual del Admin) — mismo patrón que
  // StaffLoginForm.jsx/handleCrearPin.
  const crearPin = useCallback(async ({ usuarioId, nuevoPin }) => {
    setLoading(true);
    let hash;
    try {
      hash = await hashPin(nuevoPin);
    } catch (hashError) {
      setLoading(false);
      return { error: hashError, message: "No se pudo proteger el PIN. Intenta de nuevo." };
    }
    const { data, error: updateError } = await supabase
      .from("usuarios")
      .update({ pin: hash })
      .eq("id", usuarioId)
      .select()
      .single();
    setLoading(false);
    if (updateError || !data) {
      return { error: updateError, message: "No se pudo guardar el PIN. Intenta de nuevo." };
    }
    return { usuario: data, error: null };
  }, []);

  return { registrar, login, crearPin, loading };
}
