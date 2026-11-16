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
// Los anuncios de Taxi PE van en el chat "Taxi PE".
const CANAL_ANUNCIOS = "taxipe";
const REVISAR_MS = 60 * 1000;

export function useMensajesPlataforma(usuarioId) {
  const [mensajes, setMensajes] = useState([]);
  const [leidos, setLeidos] = useState({});
  const [avisosActivos, setAvisosActivos] = useState(true);
  const [cargando, setCargando] = useState(true);
  const vistos = useRef(null);
  const avisosRef = useRef(true);


  // Anuncios vigentes para este rol: también quedan en el chat de su app,
  // para volver a verlos después de cerrar el pop-up.
  const traerAnuncios = async (rol) => {
    if (!rol) return [];
    const ahora = new Date().toISOString();
    const { data, error } = await supabase
      .from("anuncios")
      .select("id, titulo, descripcion, imagen_url, video_url, boton_url, boton_texto, fecha_inicio, created_at")
      .eq("activo", true)
      .contains("roles", [rol])
      .or(`fecha_inicio.is.null,fecha_inicio.lte.${ahora}`)
      .or(`fecha_fin.is.null,fecha_fin.gte.${ahora}`);
    if (error) return [];
    return (data ?? []).map((a) => ({
      id: `anuncio-${a.id}`,
      canal: CANAL_ANUNCIOS,
      titulo: a.titulo,
      mensaje: a.descripcion,
      imagen_url: a.imagen_url,
      video_url: a.video_url,
      boton_url: a.boton_url,
      boton_texto: a.boton_texto,
      programado_para: a.fecha_inicio || a.created_at,
    }));
  };

  const cargar = useCallback(async () => {
    if (!usuarioId) return;
    // Si a la base le falta una columna nueva (migración sin correr), igual
    // se cargan los mensajes con las columnas de siempre.
    const traerMensajes = async () => {
      const consulta = (columnas, soloMios = false) => {
        let q = supabase.from("mensajes_plataforma").select(columnas);
        // Los mensajes para UNA persona (resultado de un reporte, sanción):
        // el admin/superadmin puede leerlos todos, pero en su chat solo
        // van los generales y los suyos.
        if (soloMios) q = q.or(`destinatario_id.is.null,destinatario_id.eq.${usuarioId}`);
        return q.order("programado_para", { ascending: true }).limit(300);
      };
      const r = await consulta("id, canal, titulo, mensaje, imagen_url, video_url, boton_url, boton_texto, programado_para", true);
      if (!r.error) return r;
      const r2 = await consulta("id, canal, titulo, mensaje, imagen_url, video_url, boton_url, boton_texto, programado_para");
      return r2.error ? consulta("id, canal, titulo, mensaje, programado_para") : r2;
    };
    const [msj, lei, usu] = await Promise.all([
      traerMensajes(),
      supabase.from("mensajes_plataforma_leidos").select("canal, leido_hasta"),
      supabase.from("usuarios").select("notificaciones_activas, rol").eq("id", usuarioId).maybeSingle(),
    ]);
    if (msj.error) {
      setCargando(false);
      return;
    }
    const anuncios = await traerAnuncios(usu.data?.rol);
    const lista = [...(msj.data ?? []), ...anuncios].sort(
      (a, b) => new Date(a.programado_para) - new Date(b.programado_para)
    );
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
      // Regla de las 24 h (migración 20261027140000): lo anterior no se muestra.
      const lista = mensajes.filter(
        (m) => m.canal === canal && new Date(m.programado_para).getTime() >= Date.now() - 24 * 60 * 60 * 1000
      );
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
    if (!(await guardarAvisos(activos))) {
      avisosRef.current = !activos;
      setAvisosActivos(!activos);
    }
  }, []);

  // Cambiados desde "Configuraciones y permisos" (otro componente).
  useEffect(() => {
    const alCambiar = (e) => {
      avisosRef.current = e.detail === true;
      setAvisosActivos(e.detail === true);
    };
    window.addEventListener(EVENTO_AVISOS, alCambiar);
    return () => window.removeEventListener(EVENTO_AVISOS, alCambiar);
  }, []);

  return { canales, totalNoLeidos, cargando, marcarLeido, avisosActivos, cambiarAvisos };
}

// ---------- Avisos y sonido de la cuenta ----------------------------------
// "Configuraciones y permisos" los cambia fuera de Mensajes: se guarda en la
// base y se avisa por un evento del navegador a los demás que los usan.
const EVENTO_AVISOS = "tz-avisos-cambiados";

async function guardarAvisos(activos) {
  const { data, error } = await supabase.rpc("taxi_set_notificaciones", { p_activas: activos });
  const ok = !error && data === true;
  if (ok) window.dispatchEvent(new CustomEvent(EVENTO_AVISOS, { detail: activos }));
  return ok;
}

// Preferencia de avisos de la cuenta (null mientras carga) y cómo cambiarla.
export function useAvisosCuenta(usuarioId) {
  const [activos, setActivos] = useState(null);
  useEffect(() => {
    if (!usuarioId) return undefined;
    let vivo = true;
    supabase
      .from("usuarios")
      .select("notificaciones_activas")
      .eq("id", usuarioId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (vivo) setActivos(!error && data ? data.notificaciones_activas !== false : true);
      });
    const alCambiar = (e) => setActivos(e.detail === true);
    window.addEventListener(EVENTO_AVISOS, alCambiar);
    return () => {
      vivo = false;
      window.removeEventListener(EVENTO_AVISOS, alCambiar);
    };
  }, [usuarioId]);
  const cambiar = useCallback(async (valor) => {
    setActivos(valor);
    if (!(await guardarAvisos(valor))) setActivos(!valor);
  }, []);
  return { activos, cambiar };
}
