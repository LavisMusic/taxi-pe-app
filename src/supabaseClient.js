import { createClient } from '@supabase/supabase-js';

// Colocamos la URL y la Key directamente como texto (asegúrate de mantener las comillas)
const supabaseUrl = 'https://silfhbdmfdryjdzpwzvh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNpbGZoYmRtZmRyeWpkenB3enZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4MDc5OTMsImV4cCI6MjEwMjM4Mzk5M30.4oceDaRyxMSPq6171TcHqcdssAxzrakkaNQdh0JiTyg';

// "Mantener sesión iniciada": el cliente de Supabase solo permite fijar
// UN storage al crearlo, así que este adapter decide en cada operación
// si escribe en localStorage (persiste entre reinicios del navegador) o
// en sessionStorage (se borra al cerrar la pestaña), según lo que haya
// elegido el usuario en el checkbox de login — ver setAuthPersistence().
//
// getItem revisa AMBOS: en una recarga de la misma pestaña, la sesión
// puede estar en sessionStorage aunque "rememberMe" haya vuelto a su
// default (true) al recargar el módulo; sin este fallback, se perdería
// la sesión de "no recordar" con solo refrescar la página.
let rememberMe = true;

export function setAuthPersistence(remember) {
  rememberMe = remember;
}

const dynamicStorage = {
  getItem: (key) => {
    return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key);
  },
  setItem: (key, value) => {
    const target = rememberMe ? window.localStorage : window.sessionStorage;
    const other = rememberMe ? window.sessionStorage : window.localStorage;
    target.setItem(key, value);
    other.removeItem(key); // evita un resto duplicado/desincronizado en el otro storage
  },
  removeItem: (key) => {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: dynamicStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
