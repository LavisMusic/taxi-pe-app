import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../supabaseClient";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Descuento de Créditos (24h) — arquitectura elegida: "catch-up" acá en
// vez de un cron server-side. Este proyecto es 100% cliente + Supabase
// (anon key, sin Edge Functions ni backend propio) — pg_cron existe
// como alternativa (ver el SQL entregado aparte) pero exige que alguien
// habilite la extensión desde el Dashboard y viva ahí mantenido, para
// una app que hoy no tiene ningún otro proceso corriendo del lado del
// servidor. El catch-up además calza bien con CUÁNDO importa de verdad
// este descuento: un conductor sin la app abierta ni transmitiendo GPS
// (useGpsBroadcaster.js) ya está invisible en el Radar igual — no hace
// falta que el descuento corra "en vivo" mientras nadie lo está viendo,
// alcanza con que esté al día la próxima vez que abra sesión, y ahí
// coincide exactamente con el momento en que este hook se ejecuta.
//
// Recalcula cuántos días de 24hs pasaron desde `ultimo_descuento_creditos`
// y resta esa cantidad de `creditos` (nunca por debajo de 0) — se avanza
// el reloj en múltiplos EXACTOS de 24h (no a "ahora") para no acumular
// corrimiento: si pasaron 2.5 días, se descuentan 2 créditos y el
// próximo corte queda a mitad del tercer día, no se reinicia a este
// instante.
function calcularDescuentoCreditos(fila) {
  if (!fila?.ultimo_descuento_creditos || Number(fila.creditos || 0) <= 0) return null;
  const inicio = new Date(fila.ultimo_descuento_creditos).getTime();
  const diasTranscurridos = Math.floor((Date.now() - inicio) / MS_POR_DIA);
  if (diasTranscurridos < 1) return null;

  const creditosActuales = Number(fila.creditos || 0);
  const aDescontar = Math.min(diasTranscurridos, creditosActuales);
  const nuevoUltimoDescuento = new Date(inicio + diasTranscurridos * MS_POR_DIA).toISOString();
  return { creditos: creditosActuales - aDescontar, ultimo_descuento_creditos: nuevoUltimoDescuento };
}

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

    const descuento = data ? calcularDescuentoCreditos(data) : null;
    if (descuento) {
      // Best-effort: si el UPDATE falla (RLS, red), se sigue mostrando
      // el dato viejo tal cual vino — el catch-up simplemente se
      // reintenta en el próximo refresh, no es un error fatal para
      // poder usar la app.
      const { data: actualizado, error: descuentoError } = await supabase
        .from("conductores")
        .update(descuento)
        .eq("id", data.id)
        .select()
        .maybeSingle();
      if (!descuentoError && actualizado) {
        setConductor(actualizado);
        setLoading(false);
        return;
      }
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
