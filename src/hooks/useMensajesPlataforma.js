import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { subscribeTable } from "../lib/realtime";
import { sonarMensaje } from "../lib/sonidoMensaje";
import { asegurarSuscripcion } from "../lib/push";

// Chats fijados "Taxi PE" y "Tonazo" (migración 20261022110000): los
// mensajes que le tocan a esta cuenta (la base filtra por rol, envío
// programado y vencimiento), cuántos no leyó de cada chat y su
// preferencia de avisos (usuarios.notificaciones_activas). Un mensaje
// nuevo suena si tiene los avisos activados. Los programados aparecen al
// llegar su hora: se revisa cada minuto y al volver a la app.
export const CANALES = ["taxipe", "tonazo"];
const REVISAR_MS = 60 * 1000;

export function useMensajesPlataforma(usuarioId) {
  const [mensajes, setMensajes] = useState([]);
  const [leidos, setLeidos] = useState({});
  const [avisosActivos, setAvisosActivos] = useState(true);
  const [cargando, setCargando] = useState(true);
  const vistos = useRef(null);
  const avisosRef = useRef(true);

  const cargar = useCallback(async () => {
    if (!usuarioId) return;
    const [msj, lei, usu] = await Promise.all([
      supabase
        .from("mensajes_plataforma")
        .select("id, canal, titulo, mensaje, programado_para")
        .order("programado_para", { ascending: true })
        .limit(300),
      supabase.from("mensajes_plataforma_leidos").select("canal, leido_hasta"),
      supabase.from("usuarios").select("notificaciones_activas").eq("id", usuarioId).maybeSingle(),
    ]);
    if (msj.error) {
      setCargando(false);
      return;
    }
    const lista = msj.data ?? [];
    // Suena solo por mensajes que aparecen después de la primera carga.
    if (vistos.current && avisosRef.current && lista.some((m) => !vistos.current.has(m.id))) sonarMensaje();
    vistos.current = new Set(lista.map((m) => m.id));
    setMensajes(lista);
    if (!lei.error) setLeidos(Object.fromEntries((lei.data ?? []).map((l) => [l.canal, l.leido_hasta])));
    if (!usu.error && usu.data) {
      avisosRef.current = usu.data.notificaciones_activas !== false;
      setAvisosActivos(avisosRef.current);
    }
    setCargando(false);
  }, [usuarioId]);

  useEffect(() => {
    if (!usuarioId) return undefined;
    vistos.current = null;
    cargar();
    // Si este navegador ya dio permiso, el dispositivo queda suscrito a
    // esta cuenta para los avisos emergentes.
    asegurarSuscripcion();
    const desuscribir = subscribeTable("mensajes_plataforma", () => cargar());
    const intervalo = setInterval(cargar, REVISAR_MS);
    const alVolver = () => document.visibilityState === "visible" && cargar();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      desuscribir?.();
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [usuarioId, cargar]);

  const canales = useMemo(() => {
    const salida = {};
    CANALES.forEach((canal) => {
      const lista = mensajes.filter((m) => m.canal === canal);
      const desde = leidos[canal] ? new Date(leidos[canal]).getTime() : 0;
      salida[canal] = {
        mensajes: lista,
        ultimo: lista[lista.length - 1] ?? null,
        noLeidos: lista.filter((m) => new Date(m.programado_para).getTime() > desde).length,
      };
    });
    return salida;
  }, [mensajes, leidos]);

  const totalNoLeidos = canales.taxipe.noLeidos + canales.tonazo.noLeidos;

  const marcarLeido = useCallback(async (canal) => {
    setLeidos((prev) => ({ ...prev, [canal]: new Date().toISOString() }));
    await supabase.rpc("taxi_marcar_mensajes_leidos", { p_canal: canal });
  }, []);

  const cambiarAvisos = useCallback(async (activos) => {
    avisosRef.current = activos;
    setAvisosActivos(activos);
    const { data, error } = await supabase.rpc("taxi_set_notificaciones", { p_activas: activos });
    if (error || data !== true) {
      avisosRef.current = !activos;
      setAvisosActivos(!activos);
    }
  }, []);

  return { canales, totalNoLeidos, cargando, marcarLeido, avisosActivos, cambiarAvisos };
}
