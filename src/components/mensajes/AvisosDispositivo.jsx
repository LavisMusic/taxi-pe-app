import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BellRing, Download, Share, SquarePlus, X, Smartphone } from "lucide-react";
import {
  estadoPush,
  activarPush,
  esIOS,
  esAppInstalada,
  puedeInstalarNativo,
  instalarNativo,
  alCambiarInstalacion,
} from "../../lib/push";

// Bloque de Mensajes para los avisos emergentes de ESTE dispositivo:
// botón para darle permiso al navegador, aviso si los bloqueó y "Instalar
// la app" (en iPhone es obligatorio para recibir avisos: se explica cómo,
// porque Safari no tiene botón de instalar; en Android/Chrome abre el
// aviso nativo).
export default function AvisosDispositivo() {
  const [estado, setEstado] = useState(estadoPush);
  const [instalable, setInstalable] = useState(puedeInstalarNativo);
  const [guiaIOS, setGuiaIOS] = useState(false);

  useEffect(() => alCambiarInstalacion(() => setInstalable(puedeInstalarNativo())), []);

  const mostrarInstalar = !esAppInstalada() && (instalable || esIOS());

  if (estado === "activo" && !mostrarInstalar) return null;

  return (
    <div className="tz-avisos-dispositivo">
      {estado === "pedir" && (
        <button type="button" className="tz-avisos-dispositivo-btn" onClick={async () => setEstado(await activarPush())}>
          <BellRing size={14} /> Activar avisos en este dispositivo
        </button>
      )}
      {estado === "bloqueado" && (
        <p>Bloqueaste los avisos en este navegador. Para recibirlos, permítelos en los ajustes del sitio.</p>
      )}
      {estado === "instalar" && <p>En iPhone, los avisos solo llegan con la app instalada en tu pantalla de inicio.</p>}
      {mostrarInstalar && (
        <button
          type="button"
          className="tz-avisos-dispositivo-btn is-instalar"
          onClick={() => (instalable ? instalarNativo() : setGuiaIOS(true))}
        >
          <Download size={14} /> Instalar la app
        </button>
      )}
      {guiaIOS &&
        createPortal(
          <div className="tz-portal">
            <div className="tz-modal-backdrop" style={{ zIndex: 999990 }}>
              <div className="tz-modal tz-guia-instalar" onClick={(e) => e.stopPropagation()}>
                <button className="tz-modal-close" onClick={() => setGuiaIOS(false)} aria-label="Cerrar">
                  <X size={18} />
                </button>
                <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Smartphone size={18} /> Instalar la app
                </h2>
                <ol>
                  <li>
                    Abre esta página en <strong>Safari</strong>.
                  </li>
                  <li>
                    Toca <Share size={14} style={{ verticalAlign: "-2px" }} /> <strong>Compartir</strong> (abajo, en el
                    centro).
                  </li>
                  <li>
                    Elige <SquarePlus size={14} style={{ verticalAlign: "-2px" }} /> <strong>Añadir a pantalla de inicio</strong> y
                    toca <strong>Añadir</strong>.
                  </li>
                  <li>Abre la app desde el ícono nuevo, entra a Mensajes y activa los avisos.</li>
                </ol>
                <button type="button" className="tz-scan-btn tz-payment-save" onClick={() => setGuiaIOS(false)}>
                  Entendido
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
