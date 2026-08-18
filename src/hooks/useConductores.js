import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { subscribeTable } from "../lib/realtime";
import {
  ESTADO_CONDUCTOR_ACTIVO,
  ESTADO_CONDUCTOR_RECHAZADO,
  NIVEL_SERVICIO_ECONOMICO,
} from "../lib/taxiEnums";

// Directorio de conductores + categorías (Autos/Mototaxis/Minivans...,
// vienen de la tabla `categorias`, ordenadas por `orden`).
//
// `conductores` NO tiene columna `usuario_id`, así que no hay FK
// explícita hacia `usuarios` — y el Registro Rápido del Recolector
// (crearConductor, más abajo) confirma que un conductor puede existir
// SIN tener nunca una fila en `usuarios` (el recolector solo pide
// nombre/placa/teléfono/categoría/foto, sin DNI ni PIN). El puente más
// probable entre un futuro login (usuarios.rol='conductor') y esta
// fila es `telefono` en ambas tablas, no un id compartido — a resolver
// cuando se construya /conductor.
export function useConductores() {
  const [conductores, setConductores] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [subgrupos, setSubgrupos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Solo la carga INICIAL prende `loading` (que en el Directorio pinta
  // una pantalla completa de spinner) — un refresh disparado por
  // Realtime (alguien cambió de Libre a En Carrera) no debe volver a
  // tapar toda la lista, solo actualizar los datos por debajo.
  const yaCargoUnaVez = useRef(false);

  const refresh = useCallback(async () => {
    if (!yaCargoUnaVez.current) setLoading(true);
    setError("");
    const [conductoresRes, categoriasRes, subgruposRes] = await Promise.all([
      supabase
        .from("conductores")
        .select(
          "id, nombre, placa, telefono, dni, localidad, foto_url, foto_portada_url, descripcion, estado, creditos, vencimiento_suscripcion, categoria_id, subgrupo_id, nivel_servicio, aprobado, foto_general_url, foto_interior_url, foto_conductor_dni_url, created_at"
        )
        .order("created_at", { ascending: false }),
      supabase.from("categorias").select("id, nombre, orden").order("orden", { ascending: true }),
      // Solo lectura acá — el CRUD completo de subgrupos vive en
      // useCategorias.js (usado por CategoriasModal). Esto es para
      // poblar los desplegables de Directorio/Registro de conductor.
      supabase.from("subgrupos").select("id, categoria_id, nombre, orden").order("orden", { ascending: true }),
    ]);

    if (conductoresRes.error || categoriasRes.error || subgruposRes.error) {
      setError("No se pudo cargar el directorio de conductores.");
    } else {
      setConductores(conductoresRes.data ?? []);
      setCategorias(categoriasRes.data ?? []);
      setSubgrupos(subgruposRes.data ?? []);
    }
    yaCargoUnaVez.current = true;
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: cambio de estado (Libre/En carrera), aprobación, alta de
  // un conductor nuevo pendiente — todo eso son filas de `conductores`,
  // así que un solo canal cubre el Directorio Y el badge del Centro de
  // Peticiones sin que el Admin tenga que darle F5.
  useEffect(() => subscribeTable("conductores", () => refresh()), [refresh]);

  // .select() después del update + chequear que volvió al menos 1 fila:
  // sin esto, un UPDATE bloqueado en silencio por RLS (0 filas
  // afectadas, sin error de Postgres) se reportaba como "éxito" aunque
  // no hubiera cambiado nada — mismo bug que apareció en
  // useUsuarios.js/actualizarUsuario.
  const updateConductor = useCallback(
    async (id, patch) => {
      const { data, error: updateError } = await supabase
        .from("conductores")
        .update(patch)
        .eq("id", id)
        .select();
      if (updateError) return { error: updateError };
      if (!data || data.length === 0) {
        return { error: new Error("No se guardó ningún cambio (0 filas afectadas).") };
      }
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  const setEstado = useCallback((id, estado) => updateConductor(id, { estado }), [updateConductor]);

  // Aprobar deja al conductor operativo Y marca `aprobado: true` — las
  // dos cosas a la vez, porque el Centro de Peticiones filtra su lista
  // "Registro" por `aprobado`, no por `estado` (ver PeticionesModal).
  const aprobar = useCallback(
    (id, categoriaId) =>
      updateConductor(id, { estado: ESTADO_CONDUCTOR_ACTIVO, categoria_id: categoriaId, aprobado: true }),
    [updateConductor]
  );

  const rechazar = useCallback(
    (id) => updateConductor(id, { estado: ESTADO_CONDUCTOR_RECHAZADO, aprobado: false }),
    [updateConductor]
  );

  // Alta de un conductor SIN cuenta de login propia (perfil solo) — lo
  // usa RegistroConductorModal en modo Recolector, siempre con
  // `aprobado: false` (revisión en el Centro de Peticiones). El modo
  // Admin/Auto-registro, que también crea la fila de `usuarios`, vive
  // en useCrearConductorConUsuario.js — `aprobado` viaja como parámetro
  // en vez de estar hardcodeado porque el MISMO RegistroConductorModal
  // se reusa en los 3 contextos, y solo el caller sabe cuál es cuál.
  // `fotoUrl` (perfil, opcional) es independiente de las 3 fotos de
  // verificación — no hay fallback automático entre ellas.
  const crearConductor = useCallback(
    async ({
      nombre,
      placa,
      telefono,
      dni,
      localidad,
      categoriaId,
      subgrupoId,
      nivelServicio,
      fotoUrl,
      fotoGeneralUrl,
      fotoInteriorUrl,
      fotoConductorDniUrl,
      aprobado = false,
    }) => {
      const { data, error: insertError } = await supabase
        .from("conductores")
        .insert({
          nombre,
          placa,
          telefono: telefono || null,
          dni: dni || null,
          localidad: localidad || null,
          categoria_id: categoriaId || null,
          subgrupo_id: subgrupoId || null,
          nivel_servicio: nivelServicio || NIVEL_SERVICIO_ECONOMICO,
          foto_url: fotoUrl || null,
          foto_general_url: fotoGeneralUrl || null,
          foto_interior_url: fotoInteriorUrl || null,
          foto_conductor_dni_url: fotoConductorDniUrl || null,
          aprobado,
          // Explícito (no lo omitimos): así no depende de qué DEFAULT
          // tenga la columna en la base — era justo la causa del bug
          // "conductor fantasma" (un default viejo de `estado` distinto
          // de NULL hacía que esConductorPendiente() nunca lo detectara).
          estado: null,
        })
        .select()
        .single();
      if (!insertError) await refresh();
      return { error: insertError, conductor: data };
    },
    [refresh]
  );

  return {
    conductores,
    categorias,
    subgrupos,
    loading,
    error,
    refresh,
    updateConductor,
    setEstado,
    aprobar,
    rechazar,
    crearConductor,
  };
}
