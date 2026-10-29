import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import PerfilModal from "./PerfilModal";

// "Editar perfil" del conductor: el mismo "Mi perfil" que el pasajero. La
// foto va a su fila de conductor (`actualizar` de useConductorSesion) y el
// nombre de usuario a su cuenta (usuarios). Los dos se cambian una vez por
// semana (migración 20261029100000).
const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;
const mas7 = (iso) => (iso ? new Date(iso).getTime() + SEMANA_MS : null);
const mensaje = (e) =>
  e.code === "23505" ? "Ya lo usa otra persona." : e.code === "42501" ? e.message : "No se pudo guardar. Intenta de nuevo.";

export default function PerfilConductorModal({ conductor, actualizar, onClose }) {
  const { usuario, updateUsuario } = useTaxiAuth();
  const [cambios, setCambios] = useState({});

  const leerCambios = async () => {
    const [u, c] = await Promise.all([
      supabase.from("usuarios").select("nombre_usuario, nombre_usuario_cambiado_at").eq("id", usuario.id).maybeSingle(),
      supabase.from("conductores").select("foto_cambiada_at").eq("id", conductor.id).maybeSingle(),
    ]);
    setCambios({ ...(u.data || {}), foto_cambiada_at: c.data?.foto_cambiada_at ?? null });
    if (u.data && u.data.nombre_usuario !== usuario.nombre_usuario) updateUsuario({ nombre_usuario: u.data.nombre_usuario });
  };
  useEffect(() => {
    if (usuario?.id && conductor?.id) leerCambios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario?.id, conductor?.id]);

  return (
    <PerfilModal
      fotoUrl={conductor.foto_url}
      nombre={conductor.nombre}
      nombreUsuario={usuario?.nombre_usuario}
      telefono={usuario?.telefono}
      usuarioId={usuario?.id}
      storageKey={conductor.id}
      usuarioHasta={mas7(cambios.nombre_usuario_cambiado_at)}
      fotoHasta={mas7(cambios.foto_cambiada_at)}
      onGuardarFoto={async (url) => {
        const { error: e } = await actualizar(conductor.id, { foto_url: url });
        if (e) return false;
        window.dispatchEvent(new CustomEvent("tz-perfil-actualizado", { detail: { conductorId: conductor.id, foto_url: url } }));
        leerCambios();
        return true;
      }}
      onGuardarUsuario={async (nombreUsuario) => {
        const { error: e } = await supabase.from("usuarios").update({ nombre_usuario: nombreUsuario }).eq("id", usuario.id);
        if (e) return mensaje(e);
        updateUsuario({ nombre_usuario: nombreUsuario });
        leerCambios();
        return null;
      }}
      onClose={onClose}
    />
  );
}
