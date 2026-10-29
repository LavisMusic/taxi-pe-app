import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import PerfilModal from "./PerfilModal";

// "Editar perfil" del pasajero (cabecera de la pantalla principal): su foto
// y su nombre de usuario, guardados en su fila de `usuarios` (la política
// usuarios_cambiar le deja editar la suya). Se ven en el chat del conductor
// (usuarios_publicos).
export default function PerfilPasajeroModal({ onClose }) {
  const { usuario, updateUsuario } = useTaxiAuth();
  // Último cambio de usuario y de foto (una vez por semana) y lo que hay
  // en la base: la sesión guardada puede traer un nombre viejo (antes del
  // nombre de usuario automático).
  const [cambios, setCambios] = useState(null);
  const leerCambios = () =>
    supabase
      .from("usuarios")
      .select("nombre_usuario, foto_url, nombre_usuario_cambiado_at, foto_cambiada_at")
      .eq("id", usuario.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setCambios(data);
        if (data.nombre_usuario !== usuario.nombre_usuario || data.foto_url !== usuario.foto_url) {
          updateUsuario({ nombre_usuario: data.nombre_usuario, foto_url: data.foto_url });
        }
      });
  useEffect(() => {
    if (usuario?.id) leerCambios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id]);
  const mas7 = (iso) => (iso ? new Date(iso).getTime() + 7 * 24 * 60 * 60 * 1000 : null);

  const guardar = async (patch) => {
    const { error } = await supabase.from("usuarios").update(patch).eq("id", usuario.id);
    if (error) {
      if (error.code === "23505") return "Ya lo usa otra persona.";
      return error.code === "42501" ? error.message : "No se pudo guardar. Intenta de nuevo.";
    }
    updateUsuario(patch);
    leerCambios();
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
      usuarioHasta={mas7(cambios?.nombre_usuario_cambiado_at)}
      fotoHasta={mas7(cambios?.foto_cambiada_at)}
      limitesListos={!!cambios}
      onClose={onClose}
    />
  );
}
