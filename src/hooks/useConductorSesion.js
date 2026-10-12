import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

// El descuento de créditos (1 por cada 24 h) y el apagado de quien se
// quedó sin saldo los hace la base cada 10 min (taxi_aplicar_saldos,
// pg_cron) — la app ya no toca `creditos`.

// Puente entre el login (`usuarios`, sin FK propia hacia `conductores`)
// y la fila operativa del conductor: se busca por `telefono`, el único
// campo presente en ambas tablas — hasta que exista un flujo explícito
// de "reclamar" el pre-registro que hizo el Recolector (ver Paso 3).
// Devuelve `conductor: null` (sin error) cuando el teléfono no matchea
// ninguna fila todavía — la pantalla lo muestra como "aún sin vincular",
// no como una falla.
export function useConductorSesion(usuario) {
  const [conductor, setConductor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Bug reportado: "la interfaz del conductor se autorecarga cada
  // rato" — no era un reload de verdad, era ESTA pantalla de carga de
  // pantalla completa (más abajo, `loading` tapa TODO con un
  // spinner) reapareciendo cada vez que `refresh()` corría de fondo
  // (el polling de 10s agregado para el bug de tiempo real, más
  // visibilitychange). `refresh()` seteaba `loading=true` SIEMPRE, sin
  // importar si era la carga inicial o un refresh silencioso — mismo
  // criterio (y mismo fix) que ya usa useConductores.js del lado del
  // Admin: solo la carga INICIAL prende el spinner de pantalla
  // completa, un refresh de fondo actualiza los datos sin taparlos.
  const yaCargoUnaVez = useRef(false);

  const refresh = useCallback(async () => {
    if (!usuario?.telefono) {
      setConductor(null);
      setLoading(false);
      return;
    }
    if (!yaCargoUnaVez.current) setLoading(true);
    yaCargoUnaVez.current = true;
    setError("");
    const { data, error: fetchError } = await supabase
      .from("conductores")
      .select(
        "id, nombre, placa, telefono, foto_url, foto_portada_url, descripcion, estado, creditos, vencimiento_suscripcion, ultimo_descuento_creditos, categoria_id, nivel_servicio, aprobado, asientos_totales, asientos_ocupados, membresia_paquete_id, ultimo_paquete_creditos_nombre, ultimo_paquete_creditos_descripcion, ultima_compra_creditos_at"
      )
      .eq("telefono", usuario.telefono)
      .maybeSingle();

    if (fetchError) {
      setError("No se pudo cargar tu perfil de conductor.");
      setConductor(null);
      setLoading(false);
      return;
    }

    setConductor(data);
    setLoading(false);
  }, [usuario?.telefono]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Fix Stale Data (Fase 5): `asientos_ocupados`/`estado` del conductor
  // ahora también los escribe `sincronizarAsientosYEstado`
  // (useChatMensajes.js) cada vez que otro pasajero sube/baja o cancela
  // — una escritura que NO pasa por `setEstado`/`actualizar` de acá
  // abajo (esos son solo para las acciones que el PROPIO conductor
  // dispara desde esta pantalla). Sin una suscripción propia, la sesión
  // del conductor se quedaba con un `asientos_ocupados` congelado desde
  // el último `refresh()` manual — exactamente lo que alimenta
  // `hayLugar` en useGpsBroadcaster.js, así que un conteo viejo acá
  // podía cortar (o dejar abierto de más) el canal público del Radar.
  useEffect(() => {
    if (!conductor?.id) return undefined;
    const channel = supabase
      .channel(`conductor-sesion-${conductor.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "conductores", filter: `id=eq.${conductor.id}` },
        ({ new: fila }) => {
          if (fila) setConductor((c) => (c ? { ...c, ...fila } : c));
        }
      )
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [conductor?.id]);

  // Fix Contador Congelado (Fase 5): red de seguridad contra el mismo
  // patrón de WebSocket de Supabase Realtime que se puede desconectar en
  // silencio en una pestaña de escritorio dejada abierta mucho tiempo
  // (ver el mismo fix en useConductoresPublicos.js) — un `refresh()`
  // normal (fetch por REST, no depende de que el socket siga vivo) corre
  // solo apenas la pestaña vuelve a estar visible.
  useEffect(() => {
    const alVolverVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", alVolverVisible);
    return () => document.removeEventListener("visibilitychange", alVolverVisible);
  }, [refresh]);

  // Bug reportado: "recargo la página para que salga el cartel de
  // Membresía Activada / Compra Confirmada, si no, no aparece". La
  // suscripción de Realtime de arriba EN TEORÍA ya cubre esto (una
  // recarga hecha por el Recolector desde otro dispositivo dispara un
  // UPDATE en `conductores`, que debería llegar acá solo) — el
  // problema real es que el WebSocket de Realtime se puede desconectar
  // en silencio en un celular con la pantalla apagada/en segundo plano
  // un rato (esperando pasajeros, típico de este teléfono), y
  // `visibilitychange` de arriba solo dispara si la pestaña realmente
  // pasa a estar oculta y vuelve — si el teléfono se quedó con la
  // pantalla prendida pero el socket igual murió, ningún evento avisa
  // que hay que refrescar. Este polling de baja frecuencia es la red de
  // seguridad: como mucho 10s de atraso en vez de tener que reiniciar
  // la página a mano.
  useEffect(() => {
    if (!usuario?.telefono) return undefined;
    const intervalo = setInterval(refresh, 10000);
    return () => clearInterval(intervalo);
  }, [usuario?.telefono, refresh]);

  // Update optimista (sin esperar el refetch) — en /conductor el switch
  // de estado tiene que sentirse instantáneo, es literalmente el único
  // control que el chofer toca mientras maneja.
  const setEstado = useCallback(
    async (estado) => {
      if (!conductor) return { error: new Error("Sin conductor vinculado") };
      const { error: updateError } = await supabase
        .from("conductores")
        .update({ estado })
        .eq("id", conductor.id);
      if (!updateError) setConductor((c) => (c ? { ...c, estado } : c));
      return { error: updateError };
    },
    [conductor]
  );

  // Genérico (foto de perfil, etc.) — misma forma (id, patch) => {error}
  // que `updateConductor` del admin, para poder reusar GestionImagenModal
  // tal cual acá con "Editar Perfil".
  const actualizar = useCallback(
    async (_id, patch) => {
      if (!conductor) return { error: new Error("Sin conductor vinculado") };
      const { error: updateError } = await supabase
        .from("conductores")
        .update(patch)
        .eq("id", conductor.id);
      if (!updateError) setConductor((c) => (c ? { ...c, ...patch } : c));
      return { error: updateError };
    },
    [conductor]
  );

  return { conductor, loading, error, refresh, setEstado, actualizar };
}
