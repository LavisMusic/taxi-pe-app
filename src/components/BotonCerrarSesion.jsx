import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";

/* Botón "Cerrar sesión" al final de "Editar Perfil" — MISMO archivo en
   Taxi-PE y Caja (src/components/BotonCerrarSesion.jsx): mantener iguales.
   Ya no hay botón de salir en la cabecera (salvo el recolector); el admin
   de Taxi PE, el superadmin y el cajero lo tienen en el pie de página. */
export default function BotonCerrarSesion({ onCerrarSesion }) {
  const [saliendo, setSaliendo] = useState(false);
  const salir = async () => {
    if (saliendo) return;
    setSaliendo(true);
    try {
      await onCerrarSesion?.();
    } finally {
      setSaliendo(false);
    }
  };
  return (
    <>
      <style>{ESTILO}</style>
      <button type="button" className="tz-cerrar-sesion" onClick={salir} disabled={saliendo}>
        {saliendo ? <Loader2 size={16} className="tz-spin" /> : <LogOut size={16} />}
        Cerrar sesión
      </button>
    </>
  );
}

const ESTILO = `
.tz-cerrar-sesion {
  display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; margin: 16px 0 2px;
  padding: 12px 14px; border-radius: 14px; cursor: pointer; font-weight: 800; font-size: 14px; letter-spacing: .02em;
  color: #ff5470; background: rgba(255,84,112,0.08); border: 1px solid rgba(255,84,112,0.45);
  box-shadow: 0 0 14px rgba(255,84,112,0.15);
  animation: tz-cerrar-sesion-in .55s .12s cubic-bezier(.34,1.56,.64,1) both;
  transition: transform .35s cubic-bezier(.34,1.56,.64,1), background .25s ease, box-shadow .3s ease, color .25s ease;
}
.tz-cerrar-sesion:hover:not(:disabled) {
  transform: translateY(-2px) scale(1.01); color: #fff;
  background: linear-gradient(110deg, #ff5470, #ff2f9e); box-shadow: 0 0 24px rgba(255,84,112,0.5);
}
.tz-cerrar-sesion:active:not(:disabled) { transform: scale(.97); }
.tz-cerrar-sesion:disabled { opacity: .7; cursor: default; }
@keyframes tz-cerrar-sesion-in { from { opacity: 0; transform: translateY(10px) scale(.96); } to { opacity: 1; transform: none; } }
`;
