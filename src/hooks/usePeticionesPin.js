import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { subscribeTable } from "../lib/realtime";
import { ESTADO_PETICION_VERIFICADO, ESTADO_PETICION_RESUELTO } from "../lib/taxiEnums";

// Lado ADMIN del flujo de recuperación de PIN (Centro de Peticiones,
// pestaña "Recuperación de PIN"). El formulario público
// (RecuperarPinPage.jsx) solo pide Nombre+DNI+(Placa) — sin teléfono —
// así que para poder abrir WhatsApp acá hace falta resolver el
// teléfono por separado: se hace un segundo SELECT a `usuarios`
// filtrando por los DNI de las peticiones cargadas y se le pega el
// `telefono` a cada fila en memoria (`usuarioId` queda ahí también,
// aunque ya nada de este archivo lo use — ver el bug de abajo).
//
// Bug reportado: acá ANTES también vivía `generarYEnviarPin` — el
// Admin generaba el PIN nuevo y se lo mandaba él mismo por WhatsApp,
// como si fuera su contraseña para repartir. Se eliminó: el Admin solo
// "acepta" (verifica identidad por WhatsApp, `marcarVerificado`), y
// quien elige el PIN nuevo de verdad es el propio dueño de la cuenta,
// en /recuperar-pin — ver useCrearPeticionPin.js/fijarNuevoPin.
export function usePeticionesPin() {
  const [peticiones, setPeticiones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data: filas, error: fetchError } = await supabase
      .from("peticiones_pin")
      .select("id, nombre, dni, placa, tipo_usuario, estado, created_at")
      .neq("estado", ESTADO_PETICION_RESUELTO)
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError("No se pudieron cargar las peticiones de PIN.");
      setPeticiones([]);
      setLoading(false);
      return;
    }

    const dnis = [...new Set((filas ?? []).map((p) => p.dni))];
    let usuariosPorDni = new Map();
    if (dnis.length > 0) {
      const { data: usuarios } = await supabase.from("usuarios").select("id, dni, telefono, rol").in("dni", dnis);
      usuariosPorDni = new Map((usuarios ?? []).map((u) => [u.dni, u]));
    }

    setPeticiones(
      (filas ?? []).map((p) => {
        const usuario = usuariosPorDni.get(p.dni);
        return { ...p, usuarioId: usuario?.id ?? null, telefono: usuario?.telefono ?? null };
      })
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Una solicitud pública nueva (/recuperar-pin) tiene que aparecer en
  // el Centro de Peticiones sin F5.
  useEffect(() => subscribeTable("peticiones_pin", () => refresh()), [refresh]);

  // El Admin ya abrió WhatsApp y mandó "¿confirmas que fuiste tú?" —
  // esto solo mueve el estado a 'verificado', que es lo que le permite
  // al propio dueño de la cuenta volver a /recuperar-pin con su DNI y
  // pasar al paso de elegir su PIN nuevo. La confirmación real de
  // identidad pasa por WhatsApp, no por acá.
  const marcarVerificado = useCallback(
    async (id) => {
      const { error: updateError } = await supabase
        .from("peticiones_pin")
        .update({ estado: ESTADO_PETICION_VERIFICADO })
        .eq("id", id);
      if (!updateError) await refresh();
      return { error: updateError };
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

  return { peticiones, loading, error, refresh, marcarVerificado, descartar };
}
