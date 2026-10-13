import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import { crearPin, registrarTemporal as registrarTemporalBase } from "../lib/pinAuth";
import {
  ESTADO_CONDUCTOR_RECHAZADO,
  ESTADO_VERIFICACION_EN_REVISION,
  ESTADO_VERIFICACION_TEMPORAL,
  fechaExpiracionCuentaTemporal,
} from "../lib/taxiEnums";

// Registro exprés de Conductor: reemplaza el viejo camino de
// "RegistroConductorForm todo junto" cuando NO hay un Recolector que lo
// haya pre-registrado en persona (ese camino sigue intacto en
// useVincularConductor.js/RegistroConductorPage.jsx). Acá el conductor
// entra con SOLO nombre+teléfono (estado_verificacion='temporal',
// pin:null; la base le crea su fila en `conductores` con el mes de
// membresía de bienvenida) y tiene
// DIAS_EXPIRACION_CUENTA_TEMPORAL días para completar el resto — ver
// `verificarCuenta`, que dispara StaffLoginForm cuando encuentra una
// cuenta 'temporal' con `pin: null`.
export function useConductorTemporal() {
  const [loading, setLoading] = useState(false);

  // `rol`: 'conductor' (default) o 'recolector' — mismo registro exprés
  // (nombre y teléfono); los dos entran de una a la app (el recolector con
  // sus créditos de bienvenida) y verifican su cuenta dentro de 7 días.
  const registrarTemporal = useCallback(async ({ nombre, telefono, rol = "conductor" }) => {
    setLoading(true);
    // La cuenta la crea la base (taxi_registrar_temporal), que además
    // devuelve el ticket de la sesión.
    let resultado;
    try {
      resultado = await registrarTemporalBase({
        rol,
        telefono,
        nombre,
        expiraEn: fechaExpiracionCuentaTemporal(),
      });
    } catch (rpcError) {
      setLoading(false);
      return { error: rpcError, message: "No se pudo crear tu cuenta. Intenta de nuevo." };
    }

    setLoading(false);
    if (resultado?.estado === "duplicado") {
      return { error: new Error("duplicado"), message: "Ya existe una cuenta con ese teléfono." };
    }
    if (resultado?.estado !== "ok") {
      return { error: new Error(resultado?.estado || "error"), message: "No se pudo crear tu cuenta. Intenta de nuevo." };
    }
    return { usuario: resultado.usuario, error: null };
  }, []);

  // Segundo paso: la verificación. Datos personales + PIN van a la cuenta
  // (taxi_crear_pin, que además abre la sesión) y los del vehículo a su
  // fila de conductor — la crea el registro exprés; si es una cuenta vieja
  // sin fila, se crea acá. Cae en 'en_revision' y espera al Admin en el
  // Centro de Peticiones; mientras tanto sigue usando la app. `aprobar`/
  // `rechazar` en useConductores.js deciden si termina en 'permanente' o
  // vuelve a 'temporal'.
  const verificarCuenta = useCallback(
    async ({
      usuarioId,
      telefono,
      nombre,
      edad,
      sexo,
      dni,
      placa,
      asientosTotales,
      localidad,
      categoriaId,
      subgrupoId,
      nivelServicioSolicitado,
      fotoUrl,
      fotoGeneralUrl,
      fotoInteriorUrl,
      fotoConductorDniUrl,
      pin,
    }) => {
      setLoading(true);

      // ¿Otro usuario ya tiene ese DNI? (la base responde solo sí o no).
      const { data: dniExistente, error: dniCheckError } = await supabase.rpc("taxi_existe_cuenta", {
        p_dni: dni,
        p_excluir: usuarioId,
      });
      if (dniCheckError) {
        setLoading(false);
        return { error: dniCheckError, message: "No se pudo verificar tu DNI. Intenta de nuevo." };
      }
      if (dniExistente) {
        setLoading(false);
        return { error: new Error("duplicado"), message: "Ya existe una cuenta con ese DNI." };
      }

      let resultadoPin = null;
      try {
        resultadoPin = await crearPin(usuarioId, pin, {
          edad,
          sexo,
          dni,
          estado_verificacion: ESTADO_VERIFICACION_EN_REVISION,
        });
      } catch {
        resultadoPin = null;
      }
      const usuario = resultadoPin?.usuario;
      if (resultadoPin?.estado !== "ok" || !usuario) {
        setLoading(false);
        return { error: new Error(resultadoPin?.estado || "pin"), message: "No se pudo guardar tu verificación. Intenta de nuevo." };
      }

      const { data: conductorExistente } = await supabase
        .from("conductores")
        .select("id, estado")
        .eq("telefono", telefono)
        .maybeSingle();

      const conductorPayload = {
        placa,
        dni,
        asientos_totales: asientosTotales,
        localidad,
        categoria_id: categoriaId,
        subgrupo_id: subgrupoId,
        nivel_servicio_solicitado: nivelServicioSolicitado,
        foto_url: fotoUrl,
        foto_general_url: fotoGeneralUrl || null,
        foto_interior_url: fotoInteriorUrl || null,
        foto_conductor_dni_url: fotoConductorDniUrl || null,
      };
      // Rechazado antes: reenviar la verificación lo saca de 'rechazado'.
      if (conductorExistente?.estado === ESTADO_CONDUCTOR_RECHAZADO) conductorPayload.estado = null;

      const { error: conductorError } = conductorExistente
        ? await supabase.from("conductores").update(conductorPayload).eq("id", conductorExistente.id)
        : await supabase.from("conductores").insert({ ...conductorPayload, nombre, telefono });

      if (conductorError) {
        // Se revierte el estado de revisión para que no quede una cuenta
        // 'en_revision' sin sus datos de conductor detrás.
        await supabase
          .from("usuarios")
          .update({ estado_verificacion: ESTADO_VERIFICACION_TEMPORAL })
          .eq("id", usuarioId);
        setLoading(false);
        return { error: conductorError, message: "No se pudo guardar tu perfil de conductor. Intenta de nuevo." };
      }

      setLoading(false);
      return { usuario: { ...usuario, estado_verificacion: ESTADO_VERIFICACION_EN_REVISION }, error: null };
    },
    []
  );

  return { registrarTemporal, verificarCuenta, loading };
}
