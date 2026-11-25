import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, X } from "lucide-react";
import { supabase } from "../../supabaseClient";

// Umbral de reportes (migración 20261212100000): quiénes llegaron al límite
// → Map "tipo:id" → total. Se relee al cambiar el umbral, cuando cambian
// los reportes y cada minuto.
export function useReportadosUmbral(umbral) {
  const [mapa, setMapa] = useState(() => new Map());
  useEffect(() => {
    if (!umbral) {
      setMapa(new Map());
      return undefined;
    }
    let vivo = true;
    const leer = () =>
      supabase.rpc("taxi_reportados_sobre_umbral").then(({ data, error }) => {
        if (!vivo || error) return;
        setMapa(new Map((data || []).map((r) => [`${r.reportado_tipo}:${r.reportado_id}`, r.total])));
      });
    leer();
    const t = setInterval(() => document.visibilityState === "visible" && leer(), 60000);
    window.addEventListener("tz-reportes-cambio", leer);
    return () => {
      vivo = false;
      clearInterval(t);
      window.removeEventListener("tz-reportes-cambio", leer);
    };
  }, [umbral]);
  return mapa;
}

// Avisos del panel del admin (según sus Ajustes): un "ding" y/o una
// notificación del navegador cuando llega una petición o un reporte nuevo,
// y el recordatorio de cierre de caja a la hora elegida.

let audio = null;
export function tocarAviso() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const t = audio.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.18, t + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.35);
      o.connect(g).connect(audio.destination);
      o.start(t + i * 0.14);
      o.stop(t + i * 0.14 + 0.4);
    });
  } catch {
    /* sin audio */
  }
}

function notificar(titulo, cuerpo) {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(titulo, { body: cuerpo, icon: "/favicon.svg", tag: titulo });
    }
  } catch {
    /* en algunos móviles solo el service worker puede notificar */
  }
}

// `peticiones` / `reportes`: números actuales (null mientras cargan). Solo
// avisa cuando SUBEN, no al abrir el panel.
export function useAvisosPanel({ ajustes, peticiones, reportes }) {
  const antes = useRef({ peticiones: null, reportes: null });
  useEffect(() => {
    const a = antes.current;
    const subioP = peticiones != null && a.peticiones != null && peticiones > a.peticiones;
    const subioR = reportes != null && a.reportes != null && reportes > a.reportes;
    if (peticiones != null) a.peticiones = peticiones;
    if (reportes != null) a.reportes = reportes;
    if (!subioP && !subioR) return;
    // La notificación la manda el servidor (push, aunque el panel esté
    // cerrado); acá, con el panel abierto, solo el sonido.
    if (ajustes.avisoSonido) tocarAviso();
  }, [peticiones, reportes, ajustes.avisoSonido]);
}

const hoyClave = () => new Date().toLocaleDateString("en-CA");
const CLAVE_RECORDADO = "tz-cierre-recordado";

// Aviso flotante "Es hora de cerrar la caja": una vez al día, a la hora
// elegida, si hoy todavía no hay un cierre.
export function RecordatorioCierre({ hora, sonido, cierres = [], onCerrarCaja }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!hora) {
      setVisible(false);
      return undefined;
    }
    const revisar = () => {
      const [h, m] = hora.split(":").map(Number);
      const ahora = new Date();
      if (ahora.getHours() * 60 + ahora.getMinutes() < h * 60 + m) return;
      let yaHoy = false;
      try {
        yaHoy = localStorage.getItem(CLAVE_RECORDADO) === hoyClave();
      } catch {
        /* sin almacenamiento */
      }
      const cerroHoy = cierres.some((c) => new Date(c.created_at).toLocaleDateString("en-CA") === hoyClave());
      if (yaHoy || cerroHoy) return;
      try {
        localStorage.setItem(CLAVE_RECORDADO, hoyClave());
      } catch {
        /* sin almacenamiento */
      }
      setVisible(true);
      if (sonido) tocarAviso();
      notificar("Hora de cerrar la caja", "Haz el cierre de caja de hoy en Taxi PE.");
    };
    revisar();
    const t = setInterval(revisar, 30000);
    return () => clearInterval(t);
  }, [hora, sonido, cierres]);

  if (!visible) return null;
  return createPortal(
    <div className="tz-recordatorio-cierre tz-portal" role="alert">
      <Clock size={20} color="var(--yellow)" />
      <p>Ya es hora de cerrar la caja de hoy.</p>
      <button
        type="button"
        className="tz-footer-btn tz-footer-btn-cierre"
        onClick={() => {
          setVisible(false);
          onCerrarCaja();
        }}
      >
        Cerrar caja
      </button>
      <button type="button" className="tz-modal-close" style={{ position: "static" }} onClick={() => setVisible(false)} aria-label="Más tarde">
        <X size={16} />
      </button>
    </div>,
    document.body
  );
}
