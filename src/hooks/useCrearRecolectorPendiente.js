import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import { ESTADO_CUENTA_PENDIENTE, TIPO_USUARIO_RECOLECTOR } from "../lib/taxiEnums";

// Auto-registro público de Recolector (botón "Recolectores" del header
// de la Home) — a diferencia del conductor, un recolector NO tiene fila
// en `conductores`, así que no hay un `aprobado` de tabla ajena para
// colgarse: el gate acá es `usuarios.estado_cuenta = 'pendiente'`. Cae
// en el Centro de Peticiones (pestaña Registro, sección Recolectores)
// para que el Admin lo pase a 'activo'. Mismo patrón de PIN diferido
// que el conductor: nace en NULL, se crea en el primer login.
export function useCrearRecolectorPendiente() {
  const [saving, setSaving] = useState(false);

  const crear = useCallback(async ({ nombre, telefono, dni, fotoUrl }) => {
    setSaving(true);

    const { data: existente, error: checkError } = await supabase
      .from("usuarios")
      .select("id")
      .or(`dni.eq.${dni},telefono.eq.${telefono}`)
      .maybeSingle();
    if (checkError) {
      setSaving(false);
      return { error: checkError, message: "No se pudo verificar tus datos. Intenta de nuevo." };
    }
    if (existente) {
      setSaving(false);
      return { error: new Error("duplicado"), message: "Ya existe una cuenta con ese DNI o teléfono." };
    }

    const { data, error: insertError } = await supabase
      .from("usuarios")
      .insert({
        dni,
        telefono,
        pin: null,
        nombre,
        rol: TIPO_USUARIO_RECOLECTOR,
        estado_cuenta: ESTADO_CUENTA_PENDIENTE,
        foto_url: fotoUrl || null,
      })
      .select()
      .single();

    setSaving(false);
    if (insertError) {
      return { error: insertError, message: "No se pudo enviar tu solicitud. Intenta de nuevo." };
    }
    return { error: null, usuario: data };
  }, []);

  return { crear, saving };
}
