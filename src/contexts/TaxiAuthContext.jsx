import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { supabase } from "../supabaseClient";
import { TAXI_ADMIN_KEY, TAXI_SESSION_KEY } from "../lib/taxiAuth";

// Aviso a pantalla completa cuando el Admin elimina la cuenta MIENTRAS
// la persona la sigue teniendo abierta en su dispositivo — sin esto,
// la sesión local seguía "viva" (usuario en localStorage) mostrando
// datos de una cuenta que ya no existe en la base, hasta que alguien
// recargara a mano. Mismas clases tz-modal-backdrop/tz-modal que
// cualquier otro modal de la app.
function CuentaEliminadaOverlay({ onCerrar }) {
  return (
    <div className="tz-modal-backdrop" style={{ zIndex: 999999 }}>
      <div
        className="tz-modal tz-cuenta-eliminada-modal"
        style={{ textAlign: "center" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tz-cuenta-eliminada-icono">
          <ShieldAlert size={36} />
        </div>
        <h2 style={{ marginTop: 14, color: "var(--danger, #ff5470)" }}>Tu cuenta ha sido eliminada</h2>
        <p className="tz-brand-sub" style={{ marginTop: 8 }}>
          Un administrador eliminó esta cuenta. Si crees que es un error, comunícate con soporte.
        </p>
        <button
          type="button"
          className="tz-scan-btn tz-cuenta-eliminada-salir-btn"
          style={{ marginTop: 16, width: "100%" }}
          onClick={() => {
            onCerrar();
            window.location.href = "/";
          }}
        >
          Salir
        </button>
      </div>
    </div>
  );
}

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
  const [cuentaEliminada, setCuentaEliminada] = useState(false);

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

  // Único punto de entrada para "esta cuenta ya no existe" — lo usan
  // TANTO el listener de Realtime (se borra MIENTRAS esta pestaña
  // sigue abierta) COMO la validación al montar (la cuenta YA estaba
  // borrada de antes: alguien reabre la app días después con el
  // usuario todavía guardado en localStorage — un DELETE que ya pasó
  // es invisible para un canal de Realtime que recién se suscribe
  // ahora, así que antes esto quedaba con la sesión local "viva" para
  // siempre, sin avisar nada).
  const marcarCuentaEliminada = useCallback(() => {
    setUsuario(null);
    setIsAdminMaster(false);
    window.localStorage.removeItem(TAXI_SESSION_KEY);
    window.sessionStorage.removeItem(TAXI_SESSION_KEY);
    setCuentaEliminada(true);
  }, []);

  // Cuenta eliminada por el Admin (cualquier rol: pasajero, conductor,
  // recolector) MIENTRAS esta sesión sigue abierta en este
  // dispositivo — eliminarUsuario() (useUsuarios.js) siempre borra la
  // fila de 'usuarios' primero (para conductor, también la de
  // 'conductores' después), así que basta con escuchar el DELETE de
  // 'usuarios' acá, una sola vez, para cubrir los 3 roles por igual.
  useEffect(() => {
    if (!usuario?.id) return undefined;
    const channel = supabase
      .channel(`usuario-eliminado-${usuario.id}`)
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "usuarios", filter: `id=eq.${usuario.id}` },
        marcarCuentaEliminada
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [usuario?.id, marcarCuentaEliminada]);

  // Validación al montar/reabrir: acá NO hay sesión de Supabase Auth
  // ni fetch de servidor de por medio (readStoredUsuario es 100%
  // local), así que sin este chequeo una cuenta borrada mientras la
  // pestaña estaba cerrada quedaba "logueada" indefinidamente en este
  // dispositivo, mostrando datos de una cuenta que ya no existe.
  useEffect(() => {
    if (!usuario?.id) return undefined;
    let active = true;
    supabase
      .from("usuarios")
      .select("id")
      .eq("id", usuario.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active || error) return;
        if (!data) marcarCuentaEliminada();
      });
    return () => {
      active = false;
    };
    // Solo al montar / cuando cambia el id de usuario (login nuevo) —
    // no en cada render, el listener de Realtime ya cubre lo que pasa
    // mientras la pestaña sigue abierta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id]);

  const value = {
    usuario,
    rol: usuario?.rol ?? null,
    isAdminMaster,
    loginUsuario,
    loginAdminMaster,
    updateUsuario,
    logout,
  };

  return (
    <TaxiAuthContext.Provider value={value}>
      {cuentaEliminada && <CuentaEliminadaOverlay onCerrar={() => setCuentaEliminada(false)} />}
      {children}
    </TaxiAuthContext.Provider>
  );
}

export function useTaxiAuth() {
  const ctx = useContext(TaxiAuthContext);
  if (!ctx) throw new Error("useTaxiAuth debe usarse dentro de <TaxiAuthProvider>");
  return ctx;
}
