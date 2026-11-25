import { useEffect, useState } from "react";
import { Bot, BotOff, Loader2, Volume2, VolumeX, RotateCcw } from "lucide-react";
import { supabase } from "../../supabaseClient";
import { EVENTO_MASCOTA, EVENTO_GUIA_REPETIR, EVENTO_SONIDO, CLAVE_SONIDO_DONPEJE } from "./GuiaDonPeje";

const leerSonido = () => {
  try {
    return localStorage.getItem(CLAVE_SONIDO_DONPEJE) !== "0";
  } catch {
    return true;
  }
};

// Sección de "Configuraciones y permisos": mostrar u ocultar a Don Peje,
// sus sonidos y repetir su guía. Se muestra/oculta en la cuenta
// (guia_don_peje.mascota) y avisa al instante a la mascota en pantalla.
// `onRepetir`: al repetir la guía (p. ej. cerrar el modal para verla).
export default function SeccionMascota({ onRepetir }) {
  const [visible, setVisible] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [sonido, setSonido] = useState(leerSonido);

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

  const cambiarSonido = () => {
    const on = !sonido;
    setSonido(on);
    try {
      localStorage.setItem(CLAVE_SONIDO_DONPEJE, on ? "1" : "0");
    } catch {
      /* sin almacenamiento */
    }
    window.dispatchEvent(new CustomEvent(EVENTO_SONIDO, { detail: { on } }));
  };

  const repetir = async () => {
    if (!visible) await cambiar(true);
    onRepetir?.();
    // Un respiro para que el modal se cierre antes de que empiece.
    setTimeout(() => window.dispatchEvent(new CustomEvent(EVENTO_GUIA_REPETIR)), 250);
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
        <div className="tz-chatfijo-avisos-fila tz-mascota-opciones">
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
          <button
            type="button"
            className={`tz-chatfijo-avisos ${sonido ? "is-activo" : ""}`}
            onClick={cambiarSonido}
            aria-pressed={sonido}
          >
            {sonido ? <Volume2 size={13} /> : <VolumeX size={13} />}
            {sonido ? "Con sonidos" : "Sin sonidos"}
          </button>
          <button type="button" className="tz-chatfijo-avisos tz-mascota-accion" onClick={repetir}>
            <RotateCcw size={13} /> Repetir la guía
          </button>
        </div>
      )}
    </section>
  );
}
