import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";
import { subscribeTable } from "../lib/realtime";
import {
  ESTADO_CONDUCTOR_DESCONECTADO,
  ESTADO_CONDUCTOR_RECHAZADO,
  ESTADO_VERIFICACION_PERMANENTE,
  ESTADO_VERIFICACION_TEMPORAL,
  fechaExpiracionCuentaTemporal,
} from "../lib/taxiEnums";

// Directorio de conductores + categorías (Autos/Mototaxis/Minivans...,
// vienen de la tabla `categorias`, ordenadas por `orden`).
//
// `conductores` NO tiene columna `usuario_id`, así que no hay FK
// explícita hacia `usuarios` — el puente entre un login
// (usuarios.rol='conductor') y esta fila es `telefono` en ambas tablas,
// no un id compartido (ver useConductorSesion.js).
//
// Este hook YA NO trae un `crearConductor` propio — existió una versión
// acá que insertaba SOLO en `conductores`, sin fila en `usuarios`
// (pensado para "alta sin cuenta de login propia"). Eso causaba el bug
// de sincronía "conductor recién registrado no puede loguearse, dice
// Teléfono o PIN incorrectos": StaffLoginForm busca por teléfono en
// `usuarios`, y esa fila simplemente no existía todavía. Cualquier alta
// de conductor que deba poder loguearse (Registro Rápido del
// Recolector, alta inline desde Recarga Rápida, alta desde Usuarios del
// Admin, auto-registro en /login) usa useCrearConductorConUsuario.js,
// que crea las DOS filas juntas (`pin: null`, se crea en el primer
// login) — `aprobado` viaja como parámetro porque el mismo
// RegistroConductorModal se reusa en los 4 contextos y solo el caller
// sabe cuál es cuál.
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
          "id, nombre, placa, telefono, dni, localidad, foto_url, foto_portada_url, descripcion, estado, creditos, vencimiento_suscripcion, categoria_id, subgrupo_id, nivel_servicio, aprobado, foto_general_url, foto_interior_url, foto_conductor_dni_url, asientos_totales, asientos_ocupados, membresia_paquete_id, created_at"
        )
        .order("created_at", { ascending: false }),
      supabase.from("categorias").select("id, nombre, orden, icono_url").order("orden", { ascending: true }),
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
  //
  // `estado: DESCONECTADO`, NO Activo (bug reportado: un conductor
  // recién aprobado aparecía como "Libre" en el Directorio, como si ya
  // estuviera listo para recibir carreras). Un alta recién aprobada
  // todavía no tiene créditos ni membresía — no tiene sentido que
  // arranque "disponible". Esto además iguala este camino con el que ya
  // usaba el alta directa del Admin desde Usuarios
  // (useCrearConductorConUsuario.js: `aprobado ? DESCONECTADO : null`),
  // que nunca tuvo este problema.
  // Además de operar `conductores`, sincroniza `usuarios.estado_verificacion`
  // de esa misma persona (vínculo por teléfono, igual que
  // useConductorSesion.js) — es la cuenta de LOGIN la que decide si el
  // registro exprés vence a los 7 días o no, y solo el Admin (acá) puede
  // sacarla de 'en_revision'. Best-effort: si esto falla no se revierte
  // la aprobación/rechazo del conductor, que ya quedó guardada.
  const aprobar = useCallback(
    async (id, categoriaId) => {
      const conductor = conductores.find((c) => c.id === id);
      const resultado = await updateConductor(id, {
        estado: ESTADO_CONDUCTOR_DESCONECTADO,
        categoria_id: categoriaId,
        aprobado: true,
      });
      if (!resultado.error && conductor?.telefono) {
        await supabase
          .from("usuarios")
          .update({ estado_verificacion: ESTADO_VERIFICACION_PERMANENTE, expira_en: null })
          .eq("telefono", conductor.telefono)
          .eq("rol", "conductor");
      }
      return resultado;
    },
    [conductores, updateConductor]
  );

  const rechazar = useCallback(
    async (id) => {
      const conductor = conductores.find((c) => c.id === id);
      const resultado = await updateConductor(id, { estado: ESTADO_CONDUCTOR_RECHAZADO, aprobado: false });
      if (!resultado.error && conductor?.telefono) {
        // Vuelve a 'temporal' con un plazo nuevo de 7 días para que
        // pueda corregir y volver a mandar su verificación.
        await supabase
          .from("usuarios")
          .update({ estado_verificacion: ESTADO_VERIFICACION_TEMPORAL, expira_en: fechaExpiracionCuentaTemporal() })
          .eq("telefono", conductor.telefono)
          .eq("rol", "conductor");
      }
      return resultado;
    },
    [conductores, updateConductor]
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
  };
}
