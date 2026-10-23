import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { leerTokenAdmin } from "../lib/taxiAuth";
import { subscribeTable } from "../lib/realtime";
import { BUCKET_PRIVADO, esImagenPrivada } from "../lib/imagenesPrivadas";

// Peticiones de "Recuperar cuenta" del sistema antirrobo (Soporte ->
// Recuperar cuenta; migración 20261021100000), para el Centro de
// Peticiones del Admin. Cada una trae si la cuenta tiene el bloqueo de
// emergencia puesto.
//   aceptar: genera un código de 30 min para el número de recuperación
//            (el Admin lo manda por WhatsApp con el enlace a
//            /restablecer-pin). Si venció, aceptar de nuevo lo reenvía.
//   rechazar: la descarta (el bloqueo, si había, sigue).
// En ambos casos la foto con el DNI se borra del almacenamiento.
async function borrarFoto(valor) {
  if (!esImagenPrivada(valor)) return;
  const { error } = await supabase.storage.from(BUCKET_PRIVADO).remove([valor.slice("privado:".length)]);
  if (error) console.error("[usePeticionesRecuperacion] no se pudo borrar la foto:", error);
}

export function usePeticionesRecuperacion() {
  const [peticiones, setPeticiones] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from("peticiones_recuperacion")
      .select("id, usuario_id, telefono, nombre_completo, dni, telefono_recuperacion, comentario, foto, estado, created_at")
      .in("estado", ["pendiente", "aceptada"])
      .order("created_at", { ascending: false });
    if (error) {
      setLoading(false);
      return;
    }
    const filas = data ?? [];
    const conBloqueo = await Promise.all(
      filas.map(async (p) => {
        const { data: bloqueada } = await supabase.rpc("taxi_cuenta_bloqueada", { p_usuario_id: p.usuario_id });
        return { ...p, bloqueada: bloqueada === true };
      })
    );
    setPeticiones(conBloqueo);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => subscribeTable("peticiones_recuperacion", () => refresh(), { respaldo: true }), [refresh]);

  // Devuelve { error, message } o { codigo, telefono, nombre, expira }.
  const aceptar = useCallback(
    async (id) => {
      const { data, error } = await supabase.rpc("taxi_admin_aceptar_recuperacion", {
        p_id: String(id),
        p_token: leerTokenAdmin() || null,
      });
      if (error || data?.estado !== "ok") {
        return {
          error: error || new Error(data?.estado || "error"),
          message:
            data?.estado === "sin_sesion"
              ? "Tu sesión de Admin venció. Vuelve a entrar."
              : "No se pudo generar el código.",
        };
      }
      await borrarFoto(data.foto);
      await refresh();
      return { error: null, ...data };
    },
    [refresh]
  );

  const rechazar = useCallback(
    async (id) => {
      const { data, error } = await supabase.rpc("taxi_admin_rechazar_recuperacion", {
        p_id: String(id),
        p_token: leerTokenAdmin() || null,
      });
      if (error || data?.estado !== "ok") {
        return { error: error || new Error(data?.estado || "error"), message: "No se pudo rechazar la petición." };
      }
      await borrarFoto(data.foto);
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  return { peticiones, loading, refresh, aceptar, rechazar };
}
