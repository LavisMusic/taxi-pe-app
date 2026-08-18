import { supabase } from "../supabaseClient";

// Los PIN de `usuarios.pin` viven hasheados con pgcrypto (bcrypt) desde
// esta ronda — nunca se comparan ni se guardan en texto plano. Las dos
// funciones (`hash_pin`/`verify_pin`) corren en la base vía RPC (ver el
// SQL entregado) porque el cliente solo tiene la anon key, no puede
// instalar una librería de hashing de confianza por su cuenta — dejar
// que Postgres/pgcrypto haga el cómputo es lo más cercano a "server
// side" que hay en esta arquitectura sin Supabase Auth.
export async function hashPin(pin) {
  const { data, error } = await supabase.rpc("hash_pin", { pin });
  if (error) throw error;
  return data;
}

export async function verifyPin(pin, hash) {
  if (!hash) return false;
  const { data, error } = await supabase.rpc("verify_pin", { pin, hash });
  if (error) throw error;
  return data === true;
}

// Genera un PIN nuevo de 6 dígitos para el flujo "Generar y Enviar PIN"
// del Centro de Peticiones — con ceros a la izquierda si hace falta.
export function generarPinAleatorio() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}
