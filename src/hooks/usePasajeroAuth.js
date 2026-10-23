import { useCallback, useState } from "react";
import { loginConPin, crearPin as crearPinBase, registrarTemporal as registrarTemporalBase, MENSAJE_BLOQUEADO, MENSAJE_CUENTA_BLOQUEADA } from "../lib/pinAuth";
import { mirrorCuentaACaja } from "../lib/mirrorCaja";
import { ESTADO_VERIFICACION_PERMANENTE } from "../lib/taxiEnums";
import { supabase } from "../supabaseClient";
import { TERMINOS_VERSION } from "../components/TerminosTexto";

// Registro/Login específico de Pasajero. Registro exprés: nombre,
// celular y PIN, igual que el registro de cliente de Caja Tonazo (las
// dos cuentas comparten credenciales). `verificarCuenta` queda para las
// cuentas temporales de antes (sin PIN): lo dispara PasajeroAuthForm
// cuando el login encuentra `pin: null` Y `estado_verificacion:
// 'temporal'`, pide nombre/apellido, edad, sexo y el PIN, y la cuenta
// pasa a 'permanente'.
export function usePasajeroAuth() {
  const [loading, setLoading] = useState(false);

  // Registro exprés = el de cliente en Caja Tonazo: nombre, celular y
  // PIN. La cuenta nace permanente (migración 20261017110000) y el mismo
  // celular+PIN sirve para entrar a Caja (se copia allá al terminar).
  const registrarTemporal = useCallback(async ({ nombre, telefono, pin }) => {
    setLoading(true);
    // La cuenta la crea la base (taxi_registrar_temporal), que además
    // devuelve el ticket de la sesión.
    let resultado;
    try {
      resultado = await registrarTemporalBase({
        rol: "pasajero",
        telefono,
        nombre,
        pin,
      });
    } catch (rpcError) {
      setLoading(false);
      return { error: rpcError, message: "No se pudo crear tu cuenta. Intenta de nuevo." };
    }

    setLoading(false);
    if (resultado?.estado === "duplicado") {
      return {
        error: new Error("duplicado"),
        message: "Ya existe una cuenta con ese celular. Ingresa con tu PIN (sirve el mismo de Caja Tonazo).",
      };
    }
    if (resultado?.estado !== "ok") {
      return { error: new Error(resultado?.estado || "error"), message: "No se pudo crear tu cuenta. Intenta de nuevo." };
    }
    mirrorCuentaACaja({ telefono, pin, nombre, motivo: "alta" });
    // Aceptó los Términos en el formulario (la sesión ya está abierta).
    await supabase.rpc("taxi_aceptar_terminos", { p_version: TERMINOS_VERSION });
    return { usuario: { ...resultado.usuario, terminos_version: TERMINOS_VERSION }, error: null };
  }, []);

  // Segundo paso del registro exprés: completa los datos reales y crea
  // el PIN — de acá en más la cuenta ya no vence a los 7 días.
  const verificarCuenta = useCallback(async ({ usuarioId, nombre, apellido, edad, sexo, pin }) => {
    // Datos + PIN en un solo paso en la base (taxi_crear_pin): el PIN
    // nunca se escribe desde acá.
    setLoading(true);
    let resultado;
    try {
      resultado = await crearPinBase(usuarioId, pin, {
        nombre,
        apellido,
        edad,
        sexo,
        estado_verificacion: ESTADO_VERIFICACION_PERMANENTE,
        expira_en: null,
      });
    } catch (rpcError) {
      setLoading(false);
      return { error: rpcError, message: "No se pudo guardar tu verificación. Intenta de nuevo." };
    }

    setLoading(false);
    if (resultado?.estado !== "ok") {
      return { error: new Error(resultado?.estado || "error"), message: "No se pudo guardar tu verificación. Intenta de nuevo." };
    }
    const data = resultado.usuario;
    mirrorCuentaACaja({ telefono: data.telefono, pin, nombre: data.nombre });
    return { usuario: data, error: null };
  }, []);

  // `pin` puede llegar vacío a propósito — el form ya no exige el
  // formato ANTES de saber si esta cuenta tiene PIN o no (puede ser un
  // pasajero de alta manual del Admin, que ahora nace sin PIN). Si
  // `data.pin` es null, ese hallazgo por teléfono YA es la prueba de
  // identidad (nadie más tiene ese teléfono) — se devuelve
  // `usuarioSinPin` para que el form pase al paso de "Crea tu PIN",
  // mismo criterio que StaffLoginForm.jsx usa para conductor/recolector.
  // El PIN se compara en la base (taxi_login): el hash nunca llega acá.
  const login = useCallback(async ({ telefono, pin }) => {
    setLoading(true);
    let resultado;
    try {
      resultado = await loginConPin(telefono, pin, ["pasajero"]);
    } catch (rpcError) {
      setLoading(false);
      return { error: rpcError, message: "No se pudo verificar tus datos. Intenta de nuevo." };
    }
    setLoading(false);

    if (resultado?.estado === "sin_pin") {
      return { usuarioSinPin: resultado.usuario, error: null };
    }
    if (resultado?.estado === "bloqueado") {
      return { error: new Error("bloqueado"), message: MENSAJE_BLOQUEADO };
    }
    if (resultado?.estado === "bloqueada") {
      return { error: new Error("bloqueada"), message: MENSAJE_CUENTA_BLOQUEADA };
    }
    if (resultado?.estado !== "ok") {
      return { error: new Error("pin incorrecto"), message: "Teléfono o PIN incorrectos." };
    }
    // Crea su cuenta de Caja Tonazo si todavía no la tiene (no pisa el PIN
    // de una que ya existe; ver mirror-a-caja).
    mirrorCuentaACaja({ telefono, pin, nombre: resultado.usuario.nombre, motivo: "login" });
    return { usuario: resultado.usuario, error: null };
  }, []);

  // Paso 2 del primer ingreso: crea y guarda el PIN de una cuenta que
  // nació sin uno (alta manual del Admin) — mismo patrón que
  // StaffLoginForm.jsx/handleCrearPin.
  const crearPin = useCallback(async ({ usuarioId, nuevoPin }) => {
    setLoading(true);
    let resultado;
    try {
      resultado = await crearPinBase(usuarioId, nuevoPin);
    } catch (rpcError) {
      setLoading(false);
      return { error: rpcError, message: "No se pudo guardar el PIN. Intenta de nuevo." };
    }
    setLoading(false);
    if (resultado?.estado !== "ok") {
      return { error: new Error(resultado?.estado || "error"), message: "No se pudo guardar el PIN. Intenta de nuevo." };
    }
    const data = resultado.usuario;
    mirrorCuentaACaja({ telefono: data.telefono, pin: nuevoPin, nombre: data.nombre });
    return { usuario: data, error: null };
  }, []);

  return { registrarTemporal, verificarCuenta, login, crearPin, loading };
}
