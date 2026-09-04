import { createContext, useCallback, useContext, useState } from "react";
import { TAXI_ADMIN_KEY, TAXI_SESSION_KEY } from "../lib/taxiAuth";

const TaxiAuthContext = createContext(null);

// Sesión propia del sistema TaxiP, en paralelo a la de Supabase Auth
// (contexts/AuthContext.jsx, que sigue viva para /admin viejo mientras
// dura la migración). Acá "estar logueado" es tener una fila de
// `usuarios` guardada localmente, no un JWT — el checkbox "Mantener
// sesión iniciada" decide si va a localStorage (sobrevive reinicios) o
// sessionStorage (se borra al cerrar la pestaña), igual que hacía
// supabaseClient.js con la sesión vieja.
function readStoredUsuario() {
  try {
    const raw =
      window.localStorage.getItem(TAXI_SESSION_KEY) ??
      window.sessionStorage.getItem(TAXI_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Bug reportado: la sesión de Admin se cerraba sola al reiniciar o
// salir un momento de la pestaña. Antes SIEMPRE quedaba en
// sessionStorage nomás (deliberado en su momento, para no dejar el
// panel abierto indefinidamente en un dispositivo compartido) —
// sessionStorage en teoría sobrevive un F5 y un cambio de pestaña,
// pero en el celular el sistema operativo puede descartar la pestaña
// en segundo plano y perderlo igual. Mismo checkbox "Mantener sesión"
// que ya tiene el login normal (ver loginUsuario/readStoredUsuario más
// arriba): ahora es el propio Admin quien elige, en /login-admin, si
// quiere que persista o no.
function readStoredAdminMaster() {
  return (
    window.localStorage.getItem(TAXI_ADMIN_KEY) === "1" || window.sessionStorage.getItem(TAXI_ADMIN_KEY) === "1"
  );
}

export function TaxiAuthProvider({ children }) {
  const [usuario, setUsuario] = useState(readStoredUsuario);
  const [isAdminMaster, setIsAdminMaster] = useState(readStoredAdminMaster);

  // Login por DNI + Teléfono + PIN (recolector/conductor/pasajero).
  const loginUsuario = useCallback((row, remember = true) => {
    setUsuario(row);
    const target = remember ? window.localStorage : window.sessionStorage;
    const other = remember ? window.sessionStorage : window.localStorage;
    target.setItem(TAXI_SESSION_KEY, JSON.stringify(row));
    other.removeItem(TAXI_SESSION_KEY);
  }, []);

  // Login por código maestro (/login-admin) — `remember` default false
  // (más restrictivo que loginUsuario, sigue siendo una puerta
  // administrativa): sessionStorage salvo que el propio Admin marque
  // "Mantener sesión iniciada" en el checkbox de /login-admin.
  const loginAdminMaster = useCallback((remember = false) => {
    setIsAdminMaster(true);
    const target = remember ? window.localStorage : window.sessionStorage;
    const other = remember ? window.sessionStorage : window.localStorage;
    target.setItem(TAXI_ADMIN_KEY, "1");
    other.removeItem(TAXI_ADMIN_KEY);
  }, []);

  const updateUsuario = useCallback((patch) => {
    setUsuario((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      const storage = window.localStorage.getItem(TAXI_SESSION_KEY)
        ? window.localStorage
        : window.sessionStorage;
      storage.setItem(TAXI_SESSION_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const logout = useCallback(() => {
    setUsuario(null);
    setIsAdminMaster(false);
    window.localStorage.removeItem(TAXI_SESSION_KEY);
    window.sessionStorage.removeItem(TAXI_SESSION_KEY);
    window.localStorage.removeItem(TAXI_ADMIN_KEY);
    window.sessionStorage.removeItem(TAXI_ADMIN_KEY);
  }, []);

  const value = {
    usuario,
    rol: usuario?.rol ?? null,
    isAdminMaster,
    loginUsuario,
    loginAdminMaster,
    updateUsuario,
    logout,
  };

  return <TaxiAuthContext.Provider value={value}>{children}</TaxiAuthContext.Provider>;
}

export function useTaxiAuth() {
  const ctx = useContext(TaxiAuthContext);
  if (!ctx) throw new Error("useTaxiAuth debe usarse dentro de <TaxiAuthProvider>");
  return ctx;
}
