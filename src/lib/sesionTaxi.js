import { supabase } from "../supabaseClient";

// Sesión real de Supabase para Taxi-PE (fase 2A de seguridad). Al entrar,
// la base devuelve un ticket de un solo uso junto con el usuario
// (taxi_login, taxi_crear_pin, taxi_registrar_temporal, taxi_admin_login…)
// y la Edge Function 'taxi-sesion' lo canjea por una sesión normal de
// Supabase Auth, que el cliente guarda y renueva solo. Ver la migración
// 20261010100000_sesiones_reales.sql.
//
// Mientras los permisos de la base sigan abiertos (fase 2A), no tener
// sesión no rompe nada: si falla, se avisa en consola y la app sigue; al
// volver a abrirla se intenta otra vez (TaxiAuthContext).
export async function abrirSesion(ticket) {
  if (!ticket) return false;
  try {
    const { data, error } = await supabase.functions.invoke("taxi-sesion", { body: { ticket } });
    if (error || !data?.access_token) throw error || new Error("sin sesión");
    const { error: setError } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (setError) throw setError;
    return true;
  } catch (e) {
    console.warn("[Taxi-PE] No se pudo abrir la sesión:", e?.message || e);
    return false;
  }
}

export async function cerrarSesion() {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // sin sesión que cerrar
  }
}

// Rol de la sesión abierta en este navegador (o null si no hay).
export async function rolDeSesion() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.app_metadata?.rol ?? null;
}
