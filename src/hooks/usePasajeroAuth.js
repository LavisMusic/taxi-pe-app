import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import { loginConPin, crearPin as crearPinBase, MENSAJE_BLOQUEADO } from "../lib/pinAuth";
import { mirrorCuentaACaja } from "../lib/mirrorCaja";
import {
  ESTADO_VERIFICACION_PERMANENTE,
  ESTADO_VERIFICACION_TEMPORAL,
  fechaExpiracionCuentaTemporal,
} from "../lib/taxiEnums";

// Registro/Login específico de Pasajero. Registro exprés (bug/pedido:
// nadie quiere llenar un formulario completo solo para pedir un taxi):
// `registrarTemporal` pide SOLO nombre de usuario + teléfono, deja
// entrar de una (estado_verificacion='temporal', sin PIN todavía) y da
// 7 días para completar los datos reales antes de que el cron la borre
// (ver migración cuentas_temporales.sql). `verificarCuenta` es ese
// segundo paso — lo dispara PasajeroAuthForm cuando el login encuentra
// una cuenta con `pin: null` Y `estado_verificacion: 'temporal'` (ver
// `login` más abajo): ahí sí se piden nombre/apellido reales, edad,
// sexo y el PIN, y la cuenta pasa directo a 'permanente' (Pasajero no
// tiene gate de Admin, a diferencia de Conductor).
export function usePasajeroAuth() {
  const [loading, setLoading] = useState(false);

  const registrarTemporal = useCallback(async ({ nombreUsuario, telefono }) => {
    setLoading(true);
    const { data: existente, error: checkError } = await supabase
      .from("usuarios")
      .select("id")
      .or(`nombre_usuario.eq.${nombreUsuario},telefono.eq.${telefono}`)
      .maybeSingle();

    if (checkError) {
      setLoading(false);
      return { error: checkError, message: "No se pudo verificar tus datos. Intenta de nuevo." };
    }
    if (existente) {
      setLoading(false);
      return { error: new Error("duplicado"), message: "Ya existe una cuenta con ese usuario o teléfono." };
    }

    const { data, error: insertError } = await supabase
      .from("usuarios")
      .insert({
        nombre_usuario: nombreUsuario,
        telefono,
        pin: null,
        dni: null,
        rol: "pasajero",
        estado_verificacion: ESTADO_VERIFICACION_TEMPORAL,
        expira_en: fechaExpiracionCuentaTemporal(),
      })
      .select()
      .single();

    setLoading(false);
    if (insertError) {
      return { error: insertError, message: "No se pudo crear tu cuenta. Intenta de nuevo." };
    }
    return { usuario: data, error: null };
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
    if (resultado?.estado !== "ok") {
      return { error: new Error("pin incorrecto"), message: "Teléfono o PIN incorrectos." };
    }
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
