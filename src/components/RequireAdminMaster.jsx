import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { supabase } from "../supabaseClient";
import { leerTokenAdmin } from "../lib/taxiAuth";
import { abrirSesion, rolDeSesion } from "../lib/sesionTaxi";

// Guarda de /admin: exige haber entrado por /login-admin con el código
// maestro. No usa `usuarios.rol` porque el admin no tiene fila en esa
// tabla — es una puerta aparte, ver AdminLoginGate viejo vs.
// LoginAdminPage nuevo.
//
// Las tablas del Admin solo se pueden cambiar con la sesión real de Admin
// (fase 2B). El navegador guarda UNA sola sesión: si en este mismo
// navegador también hay una cuenta de pasajero/conductor abierta, al
// entrar al panel se toma la sesión de Admin para que pueda guardar.
export default function RequireAdminMaster({ children }) {
  const { isAdminMaster } = useTaxiAuth();

  useEffect(() => {
    if (!isAdminMaster) return undefined;
    let active = true;
    (async () => {
      if ((await rolDeSesion()) === "admin" || !active) return;
      const { data: ticket } = await supabase.rpc("taxi_ticket_admin", { p_token: leerTokenAdmin() });
      if (active && ticket) abrirSesion(ticket);
    })();
    return () => {
      active = false;
    };
  }, [isAdminMaster]);

  if (!isAdminMaster) return <Navigate to="/login-admin" replace />;

  return children;
}
