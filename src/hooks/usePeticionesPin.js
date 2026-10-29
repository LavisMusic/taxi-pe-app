import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { leerTokenAdmin } from "../lib/taxiAuth";
import { subscribeTable } from "../lib/realtime";
import { ESTADO_PETICION_RESUELTO } from "../lib/taxiEnums";

// Lado ADMIN del flujo de recuperación de PIN (Centro de Peticiones,
// pestaña "Recuperación de PIN"). Desde la migración 20261015100000 la
// petición ya trae el teléfono y el usuario_id de la cuenta (la base la
// arma con el celular que dio la persona). Las peticiones de antes, sin
// teléfono, lo buscan en `usuarios` por DNI como antes.
//
// Bug reportado: acá ANTES también vivía `generarYEnviarPin` — el
// Admin generaba el PIN nuevo y se lo mandaba él mismo por WhatsApp,
// como si fuera su contraseña para repartir. Se eliminó: el Admin solo
// le manda un código de un solo uso (`enviarCodigo`), y quien elige el
// PIN nuevo es el propio dueño de la cuenta en /restablecer-pin.
export function usePeticionesPin() {
  const [peticiones, setPeticiones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data: filas, error: fetchError } = await supabase
      .from("peticiones_pin")
      .select("id, nombre, dni, placa, tipo_usuario, estado, created_at, codigo_expira, telefono, usuario_id")
      .neq("estado", ESTADO_PETICION_RESUELTO)
      // Los códigos de "Recuperar cuenta" van en su propia pestaña.
      .eq("origen", "pin")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError("No se pudieron cargar las peticiones de PIN.");
      setPeticiones([]);
      setLoading(false);
      return;
    }

    const dnis = [...new Set((filas ?? []).filter((p) => !p.telefono && p.dni).map((p) => p.dni))];
    let usuariosPorDni = new Map();
    if (dnis.length > 0) {
      const { data: usuarios } = await supabase.from("usuarios").select("id, dni, telefono, rol").in("dni", dnis);
      usuariosPorDni = new Map((usuarios ?? []).map((u) => [u.dni, u]));
    }

    setPeticiones(
      (filas ?? []).map((p) => {
        const usuario = usuariosPorDni.get(p.dni);
        return {
          ...p,
          usuarioId: p.usuario_id ?? usuario?.id ?? null,
          telefono: p.telefono ?? usuario?.telefono ?? null,
        };
      })
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Una solicitud pública nueva (/recuperar-pin) tiene que aparecer en
  // el Centro de Peticiones sin F5.
  useEffect(() => subscribeTable("peticiones_pin", () => refresh(), { respaldo: true }), [refresh]);

  // El Admin genera un código de un solo uso (8 caracteres, vence en 30
  // min; migración 20261014220000) y lo manda por WhatsApp con el enlace a
  // /restablecer-pin. Ya NO confirma nada: la petición se resuelve sola
  // cuando el usuario escribe el código correcto. Reenviar anula el
  // anterior. Devuelve { error, codigo, telefono, nombre, expira }.
  const enviarCodigo = useCallback(
    async (id) => {
      const { data, error: rpcError } = await supabase.rpc("taxi_admin_codigo_pin", {
        p_peticion_id: String(id),
        p_token: leerTokenAdmin() || null,
      });
      if (rpcError || data?.estado !== "ok") {
        return {
          error: rpcError || new Error(data?.estado || "error"),
          message:
            data?.estado === "sin_sesion"
              ? "Tu sesión de Admin venció. Vuelve a entrar."
              : data?.estado === "sin_telefono"
                ? "Esta cuenta no tiene teléfono registrado."
                : "No se pudo generar el código.",
        };
      }
      await refresh();
      return { error: null, ...data };
    },
    [refresh]
  );

  // Descarta una petición inválida/duplicada sin tocar el PIN — hace
  // falta porque el formulario público bloquea una nueva petición
  // mientras exista una en 'pendiente'/'verificado' con el mismo DNI;
  // sin una salida, un pedido erróneo dejaría a esa persona sin poder
  // volver a pedir su PIN.
  const descartar = useCallback(
    async (id) => {
      const { error: updateError } = await supabase
        .from("peticiones_pin")
        .update({ estado: ESTADO_PETICION_RESUELTO })
        .eq("id", id);
      if (!updateError) await refresh();
      return { error: updateError };
    },
    [refresh]
  );

  return { peticiones, loading, error, refresh, enviarCodigo, descartar };
}
