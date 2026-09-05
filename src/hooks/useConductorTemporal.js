import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import { hashPin } from "../lib/pinAuth";
import {
  ESTADO_CUENTA_ACTIVO,
  ESTADO_VERIFICACION_EN_REVISION,
  ESTADO_VERIFICACION_TEMPORAL,
  fechaExpiracionCuentaTemporal,
} from "../lib/taxiEnums";

// Registro exprés de Conductor: reemplaza el viejo camino de
// "RegistroConductorForm todo junto" cuando NO hay un Recolector que lo
// haya pre-registrado en persona (ese camino sigue intacto en
// useVincularConductor.js/RegistroConductorPage.jsx). Acá el conductor
// entra con SOLO nombre+teléfono (estado_verificacion='temporal',
// pin:null, sin fila en `conductores` todavía) y tiene
// DIAS_EXPIRACION_CUENTA_TEMPORAL días para completar el resto — ver
// `verificarCuenta`, que dispara StaffLoginForm cuando encuentra una
// cuenta 'temporal' con `pin: null`.
export function useConductorTemporal() {
  const [loading, setLoading] = useState(false);

  const registrarTemporal = useCallback(async ({ nombre, telefono }) => {
    setLoading(true);
    const { data: existente, error: checkError } = await supabase
      .from("usuarios")
      .select("id")
      .eq("telefono", telefono)
      .maybeSingle();

    if (checkError) {
      setLoading(false);
      return { error: checkError, message: "No se pudo verificar tus datos. Intenta de nuevo." };
    }
    if (existente) {
      setLoading(false);
      return { error: new Error("duplicado"), message: "Ya existe una cuenta con ese teléfono." };
    }

    const { data, error: insertError } = await supabase
      .from("usuarios")
      .insert({
        nombre,
        telefono,
        pin: null,
        dni: null,
        rol: "conductor",
        estado_cuenta: ESTADO_CUENTA_ACTIVO,
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

  // Segundo paso: completa apellido/edad/sexo/DNI/placa/fotos/PIN. A
  // diferencia de Pasajero, acá NO pasa a 'permanente' de una — cae en
  // 'en_revision' y espera al Admin en el Centro de Peticiones de
  // siempre (misma cola que ya usa `conductores.aprobado`, ver
  // ConductoresDirectorio.jsx/PeticionesModal.jsx) — `aprobar`/
  // `rechazar` en useConductores.js son quienes deciden si esta cuenta
  // termina en 'permanente' o vuelve a 'temporal'.
  const verificarCuenta = useCallback(
    async ({
      usuarioId,
      telefono,
      nombre,
      apellido,
      edad,
      sexo,
      dni,
      placa,
      fotoGeneralUrl,
      fotoInteriorUrl,
      fotoConductorDniUrl,
      pin,
    }) => {
      setLoading(true);

      const { data: dniExistente, error: dniCheckError } = await supabase
        .from("usuarios")
        .select("id")
        .eq("dni", dni)
        .neq("id", usuarioId)
        .maybeSingle();
      if (dniCheckError) {
        setLoading(false);
        return { error: dniCheckError, message: "No se pudo verificar tu DNI. Intenta de nuevo." };
      }
      if (dniExistente) {
        setLoading(false);
        return { error: new Error("duplicado"), message: "Ya existe una cuenta con ese DNI." };
      }

      let pinHash;
      try {
        pinHash = await hashPin(pin);
      } catch (hashError) {
        setLoading(false);
        return { error: hashError, message: "No se pudo proteger tu PIN. Intenta de nuevo." };
      }

      const { data: usuario, error: usuarioError } = await supabase
        .from("usuarios")
        .update({
          apellido,
          edad,
          sexo,
          dni,
          pin: pinHash,
          estado_verificacion: ESTADO_VERIFICACION_EN_REVISION,
        })
        .eq("id", usuarioId)
        .select()
        .single();
      if (usuarioError || !usuario) {
        setLoading(false);
        return { error: usuarioError, message: "No se pudo guardar tu verificación. Intenta de nuevo." };
      }

      // Un rechazo previo (ver useConductores.js `rechazar`) deja la fila
      // vieja en `conductores` con estado='rechazado' — si el conductor
      // vuelve a mandar su verificación, se actualiza esa MISMA fila en
      // vez de insertar una nueva (teléfono es único de hecho, un INSERT
      // chocaría). `estado: null` la vuelve a poner en la cola de
      // pendientes de revisión.
      const { data: conductorExistente } = await supabase
        .from("conductores")
        .select("id")
        .eq("telefono", telefono)
        .maybeSingle();

      const conductorPayload = {
        nombre: `${nombre} ${apellido}`.trim(),
        placa,
        telefono,
        dni,
        foto_general_url: fotoGeneralUrl || null,
        foto_interior_url: fotoInteriorUrl || null,
        foto_conductor_dni_url: fotoConductorDniUrl || null,
        aprobado: false,
        estado: null,
      };

      const { error: conductorError } = conductorExistente
        ? await supabase.from("conductores").update(conductorPayload).eq("id", conductorExistente.id)
        : await supabase.from("conductores").insert(conductorPayload);

      if (conductorError) {
        // Best-effort: no hay transacciones desde el cliente anon (mismo
        // criterio que useCrearConductorConUsuario.js) — se revierte el
        // estado de revisión para que no quede una cuenta 'en_revision'
        // sin fila en `conductores` detrás.
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
