import { supabase } from "../supabaseClient";

// Espejo de cuentas (Taxi-PE -> Caja Tonazo): justo después de que un
// pasajero crea o cambia su PIN real acá, se replica la MISMA cuenta
// (teléfono+PIN) en Caja para que pueda entrar ahí con las mismas
// credenciales — la mitad "de vuelta" del espejo (ver create-cliente/
// set-initial-pin/manage-usuario en caja-app para la otra dirección).
//
// Best-effort y no bloqueante a propósito: el pasajero YA inició sesión
// en Taxi-PE con éxito antes de llamar esto — un fallo acá (Caja caída,
// red, etc.) nunca debe tumbar ni demorar su propio login.
export async function mirrorCuentaACaja({ telefono, pin, nombre }) {
  try {
    await supabase.functions.invoke("mirror-a-caja", {
      body: { telefono, pin, nombre: nombre || null },
    });
  } catch (err) {
    console.error("[mirrorCuentaACaja] no se pudo espejar la cuenta a Caja:", err);
  }
}
