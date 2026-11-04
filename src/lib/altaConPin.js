import { supabase } from "../supabaseClient";

// Después de crear una cuenta para otra persona (Admin o recolector):
//   { pin }        → la persona escribió su PIN en el teclado privado
//                    (PinPrivado.jsx); se guarda sin abrir sesión.
//   { ausente }    → se genera un código de activación de un solo uso
//                    para que ella cree su PIN en su primer ingreso.
// Devuelve { codigo } (solo si hubo que generarlo) o { error }.
export async function activarCuentaNueva(usuarioId, resultadoPin) {
  if (resultadoPin?.pin) {
    const { data, error } = await supabase.rpc("taxi_fijar_pin_alta", { p_usuario_id: usuarioId, p_pin: resultadoPin.pin });
    if (error || data?.estado !== "ok") return { error: "La cuenta se creó, pero no se pudo guardar su PIN. Genera un código para que lo cree." };
    return {};
  }
  return generarCodigoActivacion(usuarioId);
}

export async function generarCodigoActivacion(usuarioId) {
  const { data, error } = await supabase.rpc("taxi_generar_codigo", { p_usuario_id: usuarioId });
  if (error || data?.estado !== "ok") {
    return {
      error:
        data?.estado === "ya_tiene_pin"
          ? "Esa cuenta ya tiene PIN."
          : data?.estado === "sin_permiso"
            ? "No puedes generar un código para esta cuenta."
            : "No se pudo generar el código.",
    };
  }
  return { codigo: data.codigo };
}
