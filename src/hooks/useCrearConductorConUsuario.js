import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import { ESTADO_CONDUCTOR_DESCONECTADO, ESTADO_CUENTA_ACTIVO, NIVEL_SERVICIO_ECONOMICO } from "../lib/taxiEnums";

// Alta completa (login + perfil) — el ÚNICO camino que crea una fila en
// `conductores` CON `usuarios` incluido, usado por los 4 contextos que
// dan de alta un conductor que después necesita poder loguearse: alta
// desde Usuarios (Admin), auto-registro (LoginPage.jsx), Registro
// Rápido del Recolector y el alta inline ("crear nuevo conductor") de
// RecargaRapidaForm.jsx. Las DOS filas quedan unidas por `telefono`, el
// único vínculo que existe entre ambas tablas (ver
// useConductorSesion.js). Antes existía un segundo camino en
// useConductores.js (`crearConductor`) que insertaba SOLO en
// `conductores` para las altas de Recolector — eso causaba que ese
// conductor nunca pudiera loguearse (StaffLoginForm busca por teléfono
// en `usuarios`, fila que jamás llegaba a existir). Se eliminó: ahora
// todos pasan por acá.
//
// `aprobado` decide todo el resto sin ningún "switch" visible en el
// formulario — lo fija el CALLER según quién esté creando la cuenta:
//   - Admin (UsuariosModal): aprobado=true, estado=desconectado — entra
//     operativo de una, no pasa por el Centro de Peticiones.
//   - Todos los demás (auto-registro, Recolector, alta inline):
//     aprobado=false, estado=null — cae en la cola de "Registro" del
//     Centro de Peticiones.
//
// `usuarios.pin` se crea en NULL a propósito — ya no se pide/inventa un
// PIN acá. El conductor lo elige solo en su primer login (ver
// StaffLoginForm.jsx: detecta pin=null y deja crear+guardar el PIN con
// bcrypt ahí mismo, sin pedir DNI de nuevo).
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
      asientosTotales,
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
          // Fase 4 (Colectivo): 4 como fallback si por lo que sea llega
          // sin este campo (ej. un caller viejo que no lo manda todavía).
          asientos_totales: Number.isInteger(Number(asientosTotales)) && Number(asientosTotales) > 0 ? Number(asientosTotales) : 4,
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
