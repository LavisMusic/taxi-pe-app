import { supabase } from "../supabaseClient";

// Suscripción genérica a TODOS los cambios (insert/update/delete) de
// una tabla vía Supabase Realtime — cada hook que la usa simplemente
// vuelve a pedir su propia lista (`onChange` normalmente es su propio
// `refresh`), sin intentar aplicar el parche fila por fila: el volumen
// de esta app (conductores/usuarios/peticiones de un taxi local, no un
// feed masivo) hace que un refetch completo sea más simple y a la vez
// suficientemente barato. Requiere que la tabla esté agregada a la
// publicación `supabase_realtime` (ver SQL entregado) — si no lo está,
// el canal se suscribe igual pero nunca llega ningún evento.
//
// `respaldo: true` (paneles del Admin y del recolector): además vuelve a
// pedir la lista al volver a la pestaña y cada 60 s mientras está a la
// vista — si la conexión de Realtime se cae en silencio, el panel nunca
// queda desactualizado más de un minuto.
const RESPALDO_MS = 60000;

export function subscribeTable(table, onChange, { respaldo = false } = {}) {
  const channel = supabase
    .channel(`realtime-${table}-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "*", schema: "public", table }, onChange)
    .subscribe();
  if (!respaldo) return () => supabase.removeChannel(channel);

  const sondeo = setInterval(() => {
    if (document.visibilityState === "visible") onChange();
  }, RESPALDO_MS);
  const alVolver = () => {
    if (document.visibilityState === "visible") onChange();
  };
  document.addEventListener("visibilitychange", alVolver);
  return () => {
    clearInterval(sondeo);
    document.removeEventListener("visibilitychange", alVolver);
    supabase.removeChannel(channel);
  };
}
