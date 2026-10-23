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
// Si el canal falla (ej. la tabla todavía no existía cuando se abrió la
// pantalla) se vuelve a suscribir solo a los 5 s; y cada vez que se
// reconecta pide la lista de nuevo, porque los cambios del rato sin
// conexión no llegan por el canal.
//
// `respaldo: true` (paneles del Admin, del recolector y del conductor):
// además vuelve a pedir la lista al volver a la pestaña, al recuperar la
// red y cada 30 s mientras está a la vista.
const RESPALDO_MS = 30000;
const REINTENTO_MS = 5000;

export function subscribeTable(table, onChange, { respaldo = false } = {}) {
  let channel = null;
  let cerrado = false;
  let reintento = null;
  let yaSuscrito = false;
  const conectar = () => {
    channel = supabase
      .channel(`realtime-${table}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, onChange)
      .subscribe((status) => {
        if (cerrado) return;
        if (status === "SUBSCRIBED") {
          if (yaSuscrito) onChange({ reconexion: true });
          yaSuscrito = true;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(reintento);
          reintento = setTimeout(() => {
            if (cerrado) return;
            supabase.removeChannel(channel);
            conectar();
          }, REINTENTO_MS);
        }
      });
  };
  conectar();
  const cerrar = () => {
    cerrado = true;
    clearTimeout(reintento);
    supabase.removeChannel(channel);
  };
  if (!respaldo) return cerrar;

  const sondeo = setInterval(() => {
    if (document.visibilityState === "visible") onChange();
  }, RESPALDO_MS);
  const alVolver = () => {
    if (document.visibilityState === "visible") onChange();
  };
  document.addEventListener("visibilitychange", alVolver);
  window.addEventListener("online", alVolver);
  return () => {
    clearInterval(sondeo);
    document.removeEventListener("visibilitychange", alVolver);
    window.removeEventListener("online", alVolver);
    cerrar();
  };
}
