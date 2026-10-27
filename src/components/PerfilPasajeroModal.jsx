import { supabase } from "../supabaseClient";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import PerfilModal from "./PerfilModal";

// "Editar perfil" del pasajero (cabecera de la pantalla principal): su foto
// y su nombre de usuario, guardados en su fila de `usuarios` (la política
// usuarios_cambiar le deja editar la suya). Se ven en el chat del conductor
// (usuarios_publicos).
export default function PerfilPasajeroModal({ onClose }) {
  const { usuario, updateUsuario } = useTaxiAuth();

  const guardar = async (patch) => {
    const { error } = await supabase.from("usuarios").update(patch).eq("id", usuario.id);
    if (error) return error.code === "23505" ? "Ya lo usa otra persona." : "No se pudo guardar. Intenta de nuevo.";
    updateUsuario(patch);
    // Las demás pantallas abiertas (chat del conductor, etc.) se enteran.
    window.dispatchEvent(new CustomEvent("tz-perfil-actualizado", { detail: { id: usuario.id, ...patch } }));
    return null;
  };

  if (!usuario) return null;
  return (
    <PerfilModal
      fotoUrl={usuario.foto_url}
      nombre={usuario.nombre}
      nombreUsuario={usuario.nombre_usuario}
      telefono={usuario.telefono}
      usuarioId={usuario.id}
      storageKey={`pasajero-${usuario.id}`}
      onGuardarFoto={async (url) => !(await guardar({ foto_url: url }))}
      onGuardarUsuario={(nombreUsuario) => guardar({ nombre_usuario: nombreUsuario })}
      onClose={onClose}
    />
  );
}
