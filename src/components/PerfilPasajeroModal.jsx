import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Camera, Loader2, Check } from "lucide-react";
import { supabase } from "../supabaseClient";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import GestionImagenModal from "./admin/GestionImagenModal";

// "Editar perfil" del pasajero (cabecera de la pantalla principal): su foto
// (mismo recortador/IA que la del conductor) y su nombre. Se guardan en
// su fila de `usuarios` (la política usuarios_cambiar le deja editar la
// suya) y se ven en el chat del conductor (usuarios_publicos).
export default function PerfilPasajeroModal({ onClose }) {
  const { usuario, updateUsuario } = useTaxiAuth();
  const [nombre, setNombre] = useState(usuario?.nombre || "");
  const [editandoFoto, setEditandoFoto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");

  const guardar = async (patch) => {
    setError("");
    const { error: e } = await supabase.from("usuarios").update(patch).eq("id", usuario.id);
    if (e) {
      setError("No se pudo guardar. Intenta de nuevo.");
      return false;
    }
    updateUsuario(patch);
    // Las demás pantallas abiertas (chat del conductor, etc.) se enteran.
    window.dispatchEvent(new CustomEvent("tz-perfil-actualizado", { detail: { id: usuario.id, ...patch } }));
    return true;
  };

  const guardarNombre = async (e) => {
    e.preventDefault();
    const limpio = nombre.trim();
    if (!limpio || limpio === usuario?.nombre) return;
    setGuardando(true);
    const ok = await guardar({ nombre: limpio });
    setGuardando(false);
    if (ok) setAviso("Nombre guardado.");
  };

  if (!usuario) return null;
  return createPortal(
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-perfil-pasajero" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <h2>Mi perfil</h2>
        <button type="button" className="tz-perfil-pasajero-foto" onClick={() => setEditandoFoto(true)} aria-label="Cambiar foto">
          {usuario.foto_url ? <img src={usuario.foto_url} alt="" /> : <span>{(usuario.nombre || "P").charAt(0).toUpperCase()}</span>}
          <span className="tz-perfil-pasajero-camara">
            <Camera size={14} />
          </span>
        </button>
        <form onSubmit={guardarNombre} className="tz-perfil-pasajero-form">
          <label className="tz-field-label" htmlFor="perfil-nombre">Nombre</label>
          <div className="tz-perfil-pasajero-fila">
            <input
              id="perfil-nombre"
              className="tz-text-input"
              value={nombre}
              maxLength={60}
              onChange={(e) => {
                setNombre(e.target.value);
                setAviso("");
              }}
            />
            <button type="submit" className="tz-scan-btn tz-payment-save" disabled={guardando || !nombre.trim() || nombre.trim() === usuario.nombre}>
              {guardando ? <Loader2 size={16} className="tz-spin" /> : <Check size={16} />}
            </button>
          </div>
        </form>
        {aviso && <p className="tz-camera-note">{aviso}</p>}
        {error && <p className="tz-error">{error}</p>}
      </div>
      {editandoFoto && (
        <GestionImagenModal
          nombre={usuario.nombre}
          fotoUrl={usuario.foto_url}
          storageKey={`pasajero-${usuario.id}`}
          isProfilePic
          onFotoUrlChange={(url) => guardar({ foto_url: url })}
          onClose={() => setEditandoFoto(false)}
        />
      )}
    </div>,
    document.body
  );
}
