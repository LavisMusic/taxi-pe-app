import { useLocation } from "react-router-dom";
import { useAjustesPlataforma } from "../lib/ajustesPlataforma";
import PantallaMantenimiento from "./PantallaMantenimiento";

// Modo mantenimiento (Ajustes del superadmin): mientras está prendido, toda
// la app muestra "Estamos haciendo mejoras", menos el panel del admin y su
// ingreso (esas rutas ya piden ser admin).
const RUTAS_LIBRES = ["/admin", "/login-admin"];

export default function CompuertaMantenimiento({ children }) {
  const { pathname } = useLocation();
  const { mantenimiento, mantenimiento_mensaje } = useAjustesPlataforma();
  const libre = RUTAS_LIBRES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  if (mantenimiento && !libre) return <PantallaMantenimiento mensaje={mantenimiento_mensaje} />;
  return children;
}
