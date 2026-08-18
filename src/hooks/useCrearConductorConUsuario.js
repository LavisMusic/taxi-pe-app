import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import { ESTADO_CONDUCTOR_DESCONECTADO, ESTADO_CUENTA_ACTIVO, NIVEL_SERVICIO_ECONOMICO } from "../lib/taxiEnums";

// Alta completa (login + perfil) — segundo de los DOS caminos que
// crean una fila en `conductores` con `usuarios` incluido (el otro es
// el self-registro de LoginPage.jsx, que llama a este mismo hook). Las
// DOS filas quedan unidas por `telefono`, el único vínculo que existe
// entre ambas tablas (ver useConductorSesion.js).
//
// `aprobado` decide todo el resto sin ningún "switch" visible en el
// formulario — lo fija el CALLER según quién esté creando la cuenta:
//   - Admin (UsuariosModal): aprobado=true, estado=desconectado — entra
//     operativo de una, no pasa por el Centro de Peticiones.
//   - Auto-registro (LoginPage.jsx): aprobado=false, estado=null — cae
//     en la cola de "Registro" del Centro de Peticiones, igual que el
//     alta del Recolector (useConductores.crearConductor).
//
// `usuarios.pin` se crea en NULL a propósito — ya no se pide/inventa un
// PIN acá. El conductor lo elige solo en su primer login (ver
// LoginPage.jsx: detecta pin=null, exige Teléfono+DNI, y recién ahí
// deja crear+guardar el PIN con bcrypt).
//
// No hay transacciones multi-tabla desde el cliente anon — si el
// segundo insert falla, se borra el primero a mano para no dejar un
// login "fantasma" sin conductor operativo detrás.
export function useCrearConductorConUsuario({ onDone } = {}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const crear = useCallback(
    async ({
      nombre,
      dni,
      telefono,
      localidad,
      placa,
      categoriaId,
      subgrupoId,
      nivelServicio,
      fotoUrl,
      fotoGeneralUrl,
      fotoInteriorUrl,
      fotoConductorDniUrl,
      aprobado = false,
    }) => {
      setSaving(true);
      setError("");

      const { data: existente, error: checkError } = await supabase
        .from("usuarios")
        .select("id")
        .or(`dni.eq.${dni},telefono.eq.${telefono}`)
        .maybeSingle();
      if (checkError) {
        const message = "No se pudo verificar los datos.";
        setError(message);
        setSaving(false);
        return { error: checkError, message };
      }
      if (existente) {
        const message = "Ya existe una cuenta con ese DNI o teléfono.";
        setError(message);
        setSaving(false);
        return { error: new Error(message), message };
      }

      const { data: usuario, error: usuarioError } = await supabase
        .from("usuarios")
        .insert({ dni, telefono, pin: null, nombre, rol: "conductor", estado_cuenta: ESTADO_CUENTA_ACTIVO })
        .select()
        .single();
      if (usuarioError) {
        const message = "No se pudo crear la cuenta de acceso.";
        setError(message);
        setSaving(false);
        return { error: usuarioError, message };
      }

      const { data: conductor, error: conductorError } = await supabase
        .from("conductores")
        .insert({
          nombre,
          placa,
          telefono,
          dni,
          localidad: localidad || null,
          categoria_id: categoriaId || null,
          subgrupo_id: subgrupoId || null,
          nivel_servicio: nivelServicio || NIVEL_SERVICIO_ECONOMICO,
          foto_url: fotoUrl || null,
          foto_general_url: fotoGeneralUrl || null,
          foto_interior_url: fotoInteriorUrl || null,
          foto_conductor_dni_url: fotoConductorDniUrl || null,
          aprobado,
          estado: aprobado ? ESTADO_CONDUCTOR_DESCONECTADO : null,
        })
        .select()
        .single();
      if (conductorError) {
        await supabase.from("usuarios").delete().eq("id", usuario.id);
        const message = "No se pudo crear el perfil de conductor; se deshizo la cuenta de acceso.";
        setError(message);
        setSaving(false);
        return { error: conductorError, message };
      }

      setSaving(false);
      onDone?.();
      return { error: null, usuario, conductor };
    },
    [onDone]
  );

  return { crear, saving, error };
}
