import { useState } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal, X, Eye, EyeOff, LayoutGrid, Bell, BellOff, Volume2, VolumeX, Clock, ShieldCheck } from "lucide-react";
import SeccionMascota from "./mascota/SeccionMascota";
import Select from "./Select";

// "Ajustes del panel" (pie de página del admin de Taxi PE): ajustes propios
// del administrador, guardados en su cuenta (useAjustesPanel).
const ORDENES = [
  { v: "nivel", t: "Por nivel (como siempre)" },
  { v: "vence", t: "Vence primero" },
  { v: "nuevos", t: "Más nuevos primero" },
  { v: "nombre", t: "Por nombre (A-Z)" },
];
const HORAS = Array.from({ length: 24 }, (_, i) => {
  const h = 12 + Math.floor(i / 2);
  return `${String(h).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
});

function Interruptor({ activo, onClick, si, no, iconoSi: Si, iconoNo: No }) {
  return (
    <button type="button" className={`tz-chatfijo-avisos ${activo ? "is-activo" : ""}`} onClick={onClick} aria-pressed={activo}>
      {activo ? <Si size={13} /> : <No size={13} />}
      {activo ? si : no}
    </button>
  );
}

export default function AjustesPanelModal({ ajustes, cambiar, localidades = [], onClose }) {
  const [notaPermiso, setNotaPermiso] = useState("");

  const alternarNotificacion = async () => {
    setNotaPermiso("");
    if (ajustes.avisoNotificacion) {
      cambiar({ avisoNotificacion: false });
      return;
    }
    if (!("Notification" in window)) {
      setNotaPermiso("Este navegador no muestra notificaciones.");
      return;
    }
    let permiso = Notification.permission;
    if (permiso === "default") permiso = await Notification.requestPermission();
    if (permiso !== "granted") {
      setNotaPermiso("El navegador tiene bloqueadas las notificaciones de esta página: actívalas en sus permisos.");
      return;
    }
    cambiar({ avisoNotificacion: true });
  };

  return createPortal(
    <div className="tz-portal">
      <div className="tz-modal-backdrop" onClick={onClose}>
        <div className="tz-modal tz-config-modal tz-ajustes-panel" onClick={(e) => e.stopPropagation()}>
          <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SlidersHorizontal size={18} /> Ajustes del panel
          </h2>

          <section className="tz-config-seccion">
            <h3>
              <ShieldCheck size={15} /> Privacidad
            </h3>
            <p className="tz-config-nota">Oculta lo recaudado y la ganancia del día, por si alguien mira tu pantalla. Mantén presionado un monto para verlo.</p>
            <div className="tz-chatfijo-avisos-fila tz-ajustes-fila">
              <Interruptor
                activo={!ajustes.ocultarMontos}
                onClick={() => cambiar({ ocultarMontos: !ajustes.ocultarMontos })}
                si="Montos visibles"
                no="Montos ocultos"
                iconoSi={Eye}
                iconoNo={EyeOff}
              />
            </div>
          </section>

          <section className="tz-config-seccion">
            <h3>
              <LayoutGrid size={15} /> Directorio de conductores
            </h3>
            <label className="tz-ajustes-campo">
              <span>Localidad al abrir</span>
              <Select className="tz-text-input" value={ajustes.dirLocalidad} onChange={(e) => cambiar({ dirLocalidad: e.target.value })}>
                <option value="">Todas las localidades</option>
                {localidades.map((l) => (
                  <option key={l.id} value={l.nombre}>
                    {l.nombre}
                  </option>
                ))}
              </Select>
            </label>
            <label className="tz-ajustes-campo">
              <span>Orden</span>
              <Select className="tz-text-input" value={ajustes.dirOrden} onChange={(e) => cambiar({ dirOrden: e.target.value })}>
                {ORDENES.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.t}
                  </option>
                ))}
              </Select>
            </label>
            <div className="tz-chatfijo-avisos-fila tz-ajustes-fila">
              <Interruptor
                activo={!ajustes.dirOcultarSinSaldo}
                onClick={() => cambiar({ dirOcultarSinSaldo: !ajustes.dirOcultarSinSaldo })}
                si="Mostrar a los que no tienen plan vigente"
                no="Ocultar a los que no tienen plan vigente"
                iconoSi={Eye}
                iconoNo={EyeOff}
              />
            </div>
          </section>

          <section className="tz-config-seccion">
            <h3>
              <Bell size={15} /> Avisos
            </h3>
            <p className="tz-config-nota">Cuando llega una petición de pago o un reporte nuevo, mientras tienes el panel abierto.</p>
            <div className="tz-chatfijo-avisos-fila tz-ajustes-fila">
              <Interruptor
                activo={ajustes.avisoSonido}
                onClick={() => cambiar({ avisoSonido: !ajustes.avisoSonido })}
                si="Con sonido"
                no="Sin sonido"
                iconoSi={Volume2}
                iconoNo={VolumeX}
              />
              <Interruptor
                activo={ajustes.avisoNotificacion}
                onClick={alternarNotificacion}
                si="Con notificación"
                no="Sin notificación"
                iconoSi={Bell}
                iconoNo={BellOff}
              />
            </div>
            {notaPermiso && <p className="tz-error">{notaPermiso}</p>}
          </section>

          <section className="tz-config-seccion">
            <h3>
              <Clock size={15} /> Recordatorio de cierre
            </h3>
            <p className="tz-config-nota">A esa hora te aviso que cierres la caja (si todavía no la cerraste hoy).</p>
            <label className="tz-ajustes-campo">
              <span>Hora</span>
              <Select className="tz-text-input" value={ajustes.cierreHora} onChange={(e) => cambiar({ cierreHora: e.target.value })}>
                <option value="">Sin recordatorio</option>
                {HORAS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            </label>
          </section>

          <SeccionMascota onRepetir={onClose} />
        </div>
      </div>
    </div>,
    document.body
  );
}
