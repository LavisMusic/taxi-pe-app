import { createClient } from "@supabase/supabase-js";

// SEGUNDO cliente Supabase, apuntando a Caja Tonazo (xaerfywydzwifohjsvwa),
// solo con la llave PUBLICABLE. Se usa para leer, con RPCs públicas que
// validan lo que reciben, datos de Caja que el repartidor necesita (fase 3
// de Reportes y reputación: estrellas del negocio y del cliente de SU
// entrega, validadas con el token de esa entrega). Sin sesión propia, para
// no pisar la de Taxi-PE.
const url = import.meta.env.VITE_CAJA_SUPABASE_URL || "https://xaerfywydzwifohjsvwa.supabase.co";
const llave = import.meta.env.VITE_CAJA_SUPABASE_KEY || "sb_publishable_UY6VtQa2Qm77tQ_RtcD3Ww_EmBb0knR";

export const supabaseCaja = createClient(url, llave, {
  auth: { persistSession: false, autoRefreshToken: false, storageKey: "tz-caja-lectura" },
});
