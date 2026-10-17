import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";
import { NIVEL_SERVICIO_ECONOMICO } from "../lib/taxiEnums";

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
// Las dos filas las crea la base juntas (taxi_crear_conductor, migración
// 20261012120000): si algo falla no queda un login "fantasma" sin
// conductor operativo detrás.
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

      // Cuenta + fila de conductor en UNA operación de la base
      // (taxi_crear_conductor): valida duplicados y solo el Admin puede
      // crearlo ya aprobado.
      const { data, error: rpcError } = await supabase.rpc("taxi_crear_conductor", {
        p_dni: dni,
        p_telefono: telefono,
        p_nombre: nombre,
        p_conductor: {
          placa,
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
        },
        p_aprobado: aprobado,
      });
      if (rpcError || data?.estado !== "ok") {
        const message =
          data?.estado === "duplicado"
            ? "Ya existe una cuenta con ese DNI o teléfono."
            : data?.estado === "sin_permiso"
              ? "Tu sesión no permite crear conductores. Vuelve a entrar."
              : "No se pudo crear el conductor.";
        setError(message);
        setSaving(false);
        return { error: rpcError || new Error(message), message };
      }
      const { usuario, conductor } = data;

      setSaving(false);
      onDone?.();
      return { error: null, usuario, conductor };
    },
    [onDone]
  );

  return { crear, saving, error };
}
