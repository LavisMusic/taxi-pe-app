import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";

// Auto-registro público de Recolector (botón "Recolectores" del header
// de la Home) — a diferencia del conductor, un recolector NO tiene fila
// en `conductores`, así que no hay un `aprobado` de tabla ajena para
// colgarse: el gate acá es `usuarios.estado_cuenta = 'pendiente'`. Cae
// en el Centro de Peticiones (pestaña Registro, sección Recolectores)
// para que el Admin lo pase a 'activo'. Mismo patrón de PIN diferido
// que el conductor: nace en NULL, se crea en el primer login.
export function useCrearRecolectorPendiente() {
  const [saving, setSaving] = useState(false);

  const crear = useCallback(async ({ nombre, telefono, dni, ruc = null, fotoUrl }) => {
    setSaving(true);

    // Lo crea la base (taxi_registrar_recolector): sin sesión no se
    // puede leer ni escribir 'usuarios'.
    const { data, error: rpcError } = await supabase.rpc("taxi_registrar_recolector", {
      p_nombre: nombre,
      p_telefono: telefono,
      p_dni: dni,
      p_ruc: ruc || null,
      p_foto_url: fotoUrl || null,
    });
    setSaving(false);
    if (data?.estado === "duplicado") {
      return { error: new Error("duplicado"), message: "Ya existe una cuenta con ese DNI o teléfono." };
    }
    if (rpcError || data?.estado !== "ok") {
      return { error: rpcError || new Error("error"), message: "No se pudo enviar tu solicitud. Intenta de nuevo." };
    }
    return { error: null, usuario: data.usuario };
  }, []);

  return { crear, saving };
}
