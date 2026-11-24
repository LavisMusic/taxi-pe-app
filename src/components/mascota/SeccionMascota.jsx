import { useEffect, useState } from "react";
import { Bot, BotOff, Loader2 } from "lucide-react";
import { supabase } from "../../supabaseClient";
import { EVENTO_MASCOTA } from "./GuiaDonPeje";

// Sección de "Configuraciones y permisos": mostrar u ocultar a Don Peje.
// Se guarda en la cuenta (profiles.guia_don_peje.mascota, 0186) y avisa al
// instante a la mascota que está en pantalla.
export default function SeccionMascota() {
  const [visible, setVisible] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    let vivo = true;
    supabase.rpc("mi_guia_leer").then(({ data, error }) => {
      if (vivo) setVisible(error ? true : !data?.mascota?.oculta);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const cambiar = async (si) => {
    setVisible(si);
    window.dispatchEvent(new CustomEvent(EVENTO_MASCOTA, { detail: { visible: si } }));
    setGuardando(true);
    await supabase.rpc("mi_guia_guardar", { p_rol: "mascota", p_estado: { oculta: !si } });
    setGuardando(false);
  };

  return (
    <section className="tz-config-seccion">
      <h3>
        <Bot size={15} /> Don Peje
      </h3>
      <p className="tz-config-nota">Tu asistente robot: te guía en la app y duerme en la esquina cuando no lo necesitas.</p>
      {visible == null ? (
        <Loader2 size={16} className="tz-spin" />
      ) : (
        // Mismo botón que "Avisos activados" de este modal.
        <div className="tz-chatfijo-avisos-fila">
          <button
            type="button"
            className={`tz-chatfijo-avisos ${visible ? "is-activo" : ""}`}
            onClick={() => cambiar(!visible)}
            aria-pressed={visible}
            disabled={guardando}
          >
            {guardando ? <Loader2 size={13} className="tz-spin" /> : visible ? <Bot size={13} /> : <BotOff size={13} />}
            {visible ? "Don Peje visible" : "Don Peje oculto"}
          </button>
        </div>
      )}
    </section>
  );
}
