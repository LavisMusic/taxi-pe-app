import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { hashPin } from "../lib/pinAuth";
import { subscribeTable } from "../lib/realtime";
import { ESTADO_CUENTA_ACTIVO, ESTADO_CUENTA_RECHAZADO } from "../lib/taxiEnums";

// Lista completa de `usuarios` (id, nombre, rol, ...) — la usan el
// ranking de Recolectores (ventas.recolector_id -> usuarios.id, ya que
// un recolector no tiene fila propia en `conductores`), el placeholder
// de Pasajeros, y ahora el módulo "Usuarios" del admin (alta/edición
// manual de cuentas — equivalente al viejo `profiles`).
export function useUsuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Sin esto, cada evento de Realtime (alguien cambia de estado, llega
  // una petición nueva) volvía a poner `loading:true` un instante — en
  // cualquier pantalla que lo use como "pantalla completa de carga" eso
  // se veía como un parpadeo/recarga cada vez, aunque los datos ya
  // estaban ahí. Solo la carga INICIAL debe mostrar ese estado.
  const yaCargoUnaVez = useRef(false);

  const refresh = useCallback(async () => {
    if (!yaCargoUnaVez.current) setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("usuarios")
      .select(
        "id, dni, telefono, pin, nombre, rol, estado_cuenta, foto_url, creditos_disponibles, membresia_vencimiento, created_at"
      )
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError("No se pudieron cargar los usuarios.");
      setUsuarios([]);
    } else {
      setUsuarios(data ?? []);
    }
    yaCargoUnaVez.current = true;
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Un recolector auto-registrado nuevo (pendiente) tiene que aparecer
  // en el Centro de Peticiones sin F5 — y el saldo (creditos_disponibles/
  // membresia_vencimiento) también vive acá, así que esto también cubre
  // que la tarjeta del Directorio se actualice sola tras una aprobación.
  useEffect(() => subscribeTable("usuarios", () => refresh()), [refresh]);

  // Mismo chequeo anti-duplicado que useVincularConductor.js (el login
  // matchea por dni+telefono a la vez, así que dos cuentas con el mismo
  // dni o teléfono serían ambiguas o se pisarían la una a la otra). El
  // PIN se hashea acá (bcrypt vía pgcrypto, RPC hash_pin) — nunca se
  // manda texto plano al INSERT.
  // `pin` ya NO se pide en el alta manual del Admin (para NINGÚN rol) —
  // nace en NULL a propósito, igual que ya hacía useCrearConductorConUsuario.js
  // para conductores: la persona lo crea sola en su primer login (ver
  // StaffLoginForm.jsx / PasajeroAuthForm.jsx, los dos detectan `pin`
  // null y fuerzan ese paso antes de dejar entrar). `pin` queda como
  // parámetro opcional solo por si algún caller viejo todavía lo manda.
  const crearUsuario = useCallback(async ({ dni, telefono, pin, nombre, rol, fotoUrl }) => {
    const { data: existente, error: checkError } = await supabase
      .from("usuarios")
      .select("id")
      .or(`dni.eq.${dni},telefono.eq.${telefono}`)
      .maybeSingle();

    if (checkError) return { error: checkError };
    if (existente) return { error: new Error("Ya existe una cuenta con ese DNI o teléfono.") };

    let pinHash = null;
    if (pin) {
      try {
        pinHash = await hashPin(pin);
      } catch (hashError) {
        return { error: hashError };
      }
    }

    const { error: insertError } = await supabase.from("usuarios").insert({
      dni,
      telefono,
      pin: pinHash,
      nombre,
      rol,
      foto_url: fotoUrl || null,
      estado_cuenta: ESTADO_CUENTA_ACTIVO,
    });
    if (!insertError) await refresh();
    return { error: insertError };
  }, [refresh]);

  // Edición: mismo chequeo anti-duplicado que crearUsuario, pero con
  // `.neq("id", id)` — sin esa exclusión, la fila que se está editando
  // siempre "se encuentra a sí misma" (su propio dni/teléfono, sin
  // cambiar) y se reporta como si ya estuviera en uso por otra cuenta,
  // que es justo el bug reportado.
  //
  // Además: sin policy RLS de UPDATE en `usuarios`, Postgres/PostgREST
  // no tira error — devuelve 200 OK con 0 filas afectadas. .select()
  // después del update + chequear que volvió al menos 1 fila convierte
  // ese silencio en un error real y visible (era la causa del "guardar
  // cierra el modal pero no cambia nada" de la ronda anterior).
  // `patch.pin`, si viene, llega en texto plano desde el form (el Admin
  // "sobrescribiendo" el PIN de alguien) — se hashea acá antes del
  // UPDATE, igual que en crearUsuario, para que nunca quede plano en la
  // base ni un momento.
  const actualizarUsuario = useCallback(
    async (id, patch) => {
      if (patch.dni || patch.telefono) {
        const filtros = [];
        if (patch.dni) filtros.push(`dni.eq.${patch.dni}`);
        if (patch.telefono) filtros.push(`telefono.eq.${patch.telefono}`);
        const { data: existente, error: checkError } = await supabase
          .from("usuarios")
          .select("id")
          .or(filtros.join(","))
          .neq("id", id)
          .maybeSingle();
        if (checkError) return { error: checkError };
        if (existente) {
          return { error: new Error("Ya existe OTRA cuenta con ese DNI o teléfono.") };
        }
      }

      let finalPatch = patch;
      if (patch.pin) {
        try {
          finalPatch = { ...patch, pin: await hashPin(patch.pin) };
        } catch (hashError) {
          return { error: hashError };
        }
      }

      const { data, error: updateError } = await supabase
        .from("usuarios")
        .update(finalPatch)
        .eq("id", id)
        .select();
      if (updateError) return { error: updateError };
      if (!data || data.length === 0) {
        return {
          error: new Error(
            "No se guardó ningún cambio (0 filas afectadas — revisa la política RLS de UPDATE en `usuarios`)."
          ),
        };
      }
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  // Hard delete: `usuarios` es solo la cuenta de login, no tiene el
  // peso histórico de `ventas` — a diferencia del patrón soft-delete
  // (anulado) usado ahí, acá borrar de verdad es aceptable y es lo que
  // pidió el admin.
  //
  // Bug "conductor fantasma": borrar solo `usuarios` dejaba viva la
  // fila de `conductores` (tablas separadas, unidas por `telefono`) —
  // ese conductor "eliminado" seguía apareciendo en el buscador de
  // Recarga Rápida y en el Directorio porque, para esas pantallas,
  // seguía existiendo de verdad. Si el usuario borrado era rol
  // "conductor", se borra también su fila de `conductores` — recién ahí
  // "eliminar" borra al conductor entero, no solo su login.
  const eliminarUsuario = useCallback(
    async (id) => {
      const usuario = usuarios.find((u) => u.id === id);
      const { error: deleteError } = await supabase.from("usuarios").delete().eq("id", id);
      if (deleteError) return { error: deleteError };

      if (usuario?.rol === "conductor" && usuario.telefono) {
        await supabase.from("conductores").delete().eq("telefono", usuario.telefono);
      }

      await refresh();
      return { error: null };
    },
    [refresh, usuarios]
  );

  // Aprobar/rechazar un Recolector auto-registrado (Centro de
  // Peticiones, pestaña Registro) — el equivalente de
  // useConductores.aprobar/rechazar pero para cuentas sin fila en
  // `conductores`. Reusa updateConductor... no, `usuarios` no tiene ese
  // helper: mismo patrón .select()+chequeo de 0 filas que
  // actualizarUsuario, directo acá.
  const aprobarUsuario = useCallback(
    (id) => actualizarUsuario(id, { estado_cuenta: ESTADO_CUENTA_ACTIVO }),
    [actualizarUsuario]
  );

  const rechazarUsuario = useCallback(
    (id) => actualizarUsuario(id, { estado_cuenta: ESTADO_CUENTA_RECHAZADO }),
    [actualizarUsuario]
  );

  return {
    usuarios,
    loading,
    error,
    refresh,
    crearUsuario,
    actualizarUsuario,
    eliminarUsuario,
    aprobarUsuario,
    rechazarUsuario,
  };
}
