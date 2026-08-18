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

function readStoredAdminMaster() {
  return window.sessionStorage.getItem(TAXI_ADMIN_KEY) === "1";
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

  // Login por código maestro (/login-admin). Deliberadamente solo en
  // sessionStorage: es una puerta administrativa, no debería quedar
  // abierta indefinidamente en un dispositivo compartido.
  const loginAdminMaster = useCallback(() => {
    setIsAdminMaster(true);
    window.sessionStorage.setItem(TAXI_ADMIN_KEY, "1");
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
