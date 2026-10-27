import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Camera, Loader2, Check } from "lucide-react";
import GestionImagenModal from "./admin/GestionImagenModal";
import CampoUsuario, { useCampoUsuario } from "./CampoUsuario";
import { esUsuarioProvisional } from "../lib/nombreUsuario";

// "Editar perfil" (pasajero y conductor): tocando el círculo se abre el
// gestor de imágenes (recorte + IA); abajo, el nombre de usuario — lo que
// se muestra de la persona en los chats (si no eligió uno, se le propone
// uno libre).
//   onGuardarFoto(url)        → Promise<boolean>
//   onGuardarUsuario(nombre)  → Promise<string | null> (mensaje de error)
export default function PerfilModal({
  titulo = "Mi perfil",
  fotoUrl,
  nombre,
  nombreUsuario,
  telefono,
  usuarioId,
  storageKey,
  onGuardarFoto,
  onGuardarUsuario,
  onClose,
}) {
  const campo = useCampoUsuario({ nombre, nombreUsuario, telefono, usuarioId });
  const [editandoFoto, setEditandoFoto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  const puedeGuardar = campo.listo && campo.cambio;

  const guardarUsuario = async (e) => {
    e.preventDefault();
    if (!puedeGuardar) return;
    setGuardando(true);
    setAviso("");
    setError("");
    const err = await onGuardarUsuario(campo.valor);
    setGuardando(false);
    if (err) return setError(err);
    campo.marcarGuardado();
    setAviso("Nombre de usuario guardado.");
  };

  return createPortal(
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-perfil-pasajero" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <h2>{titulo}</h2>
        <button type="button" className="tz-perfil-pasajero-foto" onClick={() => setEditandoFoto(true)} aria-label="Cambiar foto">
          {fotoUrl ? (
            <img src={fotoUrl} alt="" />
          ) : (
            <span>{((esUsuarioProvisional(nombreUsuario, telefono) ? nombre : nombreUsuario) || nombre || "?").charAt(0).toUpperCase()}</span>
          )}
          <span className="tz-perfil-pasajero-camara">
            <Camera size={14} />
          </span>
        </button>
        <form onSubmit={guardarUsuario} className="tz-perfil-pasajero-form">
          <CampoUsuario campo={campo} id="perfil-usuario">
            <button type="submit" className="tz-scan-btn tz-payment-save" disabled={guardando || !puedeGuardar} aria-label="Guardar nombre de usuario">
              {guardando ? <Loader2 size={16} className="tz-spin" /> : <Check size={16} />}
            </button>
          </CampoUsuario>
        </form>
        {aviso && <p className="tz-camera-note">{aviso}</p>}
        {error && <p className="tz-error">{error}</p>}
      </div>
      {editandoFoto && (
        <GestionImagenModal
          nombre={nombreUsuario || nombre}
          fotoUrl={fotoUrl}
          storageKey={storageKey}
          isProfilePic
          onFotoUrlChange={(url) => onGuardarFoto(url)}
          onClose={() => setEditandoFoto(false)}
        />
      )}
    </div>,
    document.body
  );
}
