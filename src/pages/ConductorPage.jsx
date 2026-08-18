import { useState } from "react";
import { LogOut, Pencil, Zap, Car, CreditCard, CalendarClock, MessageCircle, Save, Loader2 } from "lucide-react";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { useConductorSesion } from "../hooks/useConductorSesion";
import { useHilosChatConductor } from "../hooks/useChatMensajes";
import { ESTADO_CONDUCTOR_ACTIVO, ESTADO_CONDUCTOR_OCUPADO } from "../lib/taxiEnums";
import { formatDate } from "../utils/format";
import Styles from "../components/Styles";
import GestionImagenModal from "../components/admin/GestionImagenModal";
import ConductorPublicCard from "../components/ConductorPublicCard";
import ConductorChatInboxModal from "../components/ConductorChatInboxModal";
import logo from "../assets/logo.png";

// Ruta /conductor — entra por RequireUsuarioRol rol="conductor".
// Mobile-first a propósito: una sola columna angosta (max 420px,
// centrada), textos y botón grandes — es la pantalla que el chofer
// tiene abierta mientras maneja, no un dashboard para leer con calma.
export default function ConductorPage() {
  const { usuario, logout } = useTaxiAuth();
  const { conductor, loading, error, setEstado, actualizar } = useConductorSesion(usuario);
  const { unreadCount } = useHilosChatConductor(conductor?.id);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState("");
  const [editandoPerfil, setEditandoPerfil] = useState(false);
  const [mensajesOpen, setMensajesOpen] = useState(false);
  const [descripcion, setDescripcion] = useState("");
  const [editandoDescripcion, setEditandoDescripcion] = useState(false);
  const [savingDescripcion, setSavingDescripcion] = useState(false);

  const estadoActivo = conductor?.estado === ESTADO_CONDUCTOR_ACTIVO;

  const diasRestantes = conductor?.vencimiento_suscripcion
    ? Math.ceil((new Date(conductor.vencimiento_suscripcion) - new Date()) / 86400000)
    : null;
  const vencida = diasRestantes != null && diasRestantes < 0;

  const handleToggle = async () => {
    if (!conductor || toggling) return;
    const nuevoEstado = estadoActivo ? ESTADO_CONDUCTOR_OCUPADO : ESTADO_CONDUCTOR_ACTIVO;
    setToggling(true);
    setToggleError("");
    const { error: setError } = await setEstado(nuevoEstado);
    setToggling(false);
    if (setError) setToggleError("No se pudo actualizar tu estado. Intenta de nuevo.");
  };

  return (
    <div className="tz-root">
      <Styles />
      <header className="tz-header">
        <div className="tz-header-row">
          {conductor ? (
            <div className="tz-header-side tz-header-side-left">
              <button
                className="tz-header-btn"
                onClick={() => setEditandoPerfil(true)}
                aria-label="Editar perfil"
                title="Editar perfil"
              >
                <Pencil size={19} />
                <span className="tz-header-btn-label">Editar Perfil</span>
              </button>
              <button
                className="tz-header-btn"
                onClick={() => setMensajesOpen(true)}
                aria-label="Mensajes"
                title="Mensajes"
                style={{ position: "relative" }}
              >
                <MessageCircle size={19} />
                <span className="tz-header-btn-label">Mensajes</span>
                {unreadCount > 0 && <span className="tz-chat-unread-dot" aria-hidden="true" />}
              </button>
            </div>
          ) : (
            <div className="tz-header-side tz-header-side-left" style={{ visibility: "hidden" }}>
              <button className="tz-header-btn" aria-hidden="true" tabIndex={-1} />
            </div>
          )}
          <div className="tz-header-center">
            <img src={logo} alt="TaxiP" className="tz-logo" />
            <p className="tz-subtitle">{conductor?.nombre ?? usuario?.nombre ?? "Conductor"}</p>
          </div>
          <div className="tz-header-side tz-header-side-right">
            <button className="tz-header-btn" onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión">
              <LogOut size={19} />
              <span className="tz-header-btn-label">Salir</span>
            </button>
          </div>
        </div>
      </header>

      <main className="tz-main" style={{ maxWidth: 420, margin: "0 auto" }}>
        {loading ? (
          <div className="tz-loading" style={{ minHeight: "50vh" }}>
            <Loader2 className="tz-spin" size={28} />
            <p>Cargando…</p>
          </div>
        ) : error ? (
          <p className="tz-error">{error}</p>
        ) : !conductor ? (
          <div className="tz-empty">
            <p>
              Tu cuenta todavía no está vinculada a un perfil de conductor. Pídele a un recolector
              que verifique tu número de teléfono, o contacta al administrador.
            </p>
          </div>
        ) : (
          <>
            {!conductor.aprobado && (
              <p className="tz-error" style={{ textAlign: "center" }}>
                Tu registro está pendiente de aprobación — el Admin lo va a revisar en el Centro de
                Peticiones. Mientras tanto no aparecés en la búsqueda pública de pasajeros.
              </p>
            )}
            <section className="tz-stats" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginBottom: 4 }}>
              <div className="tz-stat-chip">
                <span className="tz-stat-label">
                  <CreditCard size={13} /> Créditos
                </span>
                <span className="tz-stat-value tz-cyan">{conductor.creditos ?? 0}</span>
              </div>

              <div className={`tz-stat-chip ${vencida ? "" : "tz-stat-chip-green"}`}>
                <span className="tz-stat-label">
                  <CalendarClock size={13} /> Vigencia
                </span>
                <span className="tz-stat-value" style={{ color: vencida ? "var(--danger)" : "var(--green)" }}>
                  {diasRestantes == null ? "—" : vencida ? "Vencida" : `${diasRestantes} día${diasRestantes === 1 ? "" : "s"}`}
                </span>
                {conductor.vencimiento_suscripcion && (
                  <span className="tz-stat-sub">{formatDate(conductor.vencimiento_suscripcion)}</span>
                )}
              </div>
            </section>

            <button
              type="button"
              className="tz-estado-toggle"
              data-estado={conductor.estado}
              onClick={handleToggle}
              disabled={toggling}
              aria-label={estadoActivo ? "Pasar a Ocupado" : "Pasar a Activo"}
            >
              {toggling ? (
                <Loader2 size={40} className="tz-spin" />
              ) : estadoActivo ? (
                <Zap size={44} color="var(--green)" />
              ) : (
                <Car size={44} color="var(--orange)" />
              )}
              <span className="tz-estado-toggle-label">{estadoActivo ? "ACTIVO" : "OCUPADO"}</span>
              <span className="tz-estado-toggle-hint">Toca para pasar a {estadoActivo ? "Ocupado" : "Activo"}</span>
            </button>

            {toggleError && <p className="tz-error" style={{ textAlign: "center" }}>{toggleError}</p>}

            <div className="tz-method-history" style={{ marginTop: 18 }}>
              <span className="tz-method-history-label">Mi perfil de chat</span>
              <p className="tz-camera-note" style={{ margin: "0 0 8px" }}>
                Esto es lo que ve un pasajero al abrir el chat contigo.
              </p>

              {editandoDescripcion ? (
                <div className="tz-add-entry" style={{ marginTop: 8 }}>
                  <textarea
                    className="tz-text-input"
                    rows={3}
                    maxLength={100}
                    placeholder="Ej. Mototaxi disponible en San Ramón, atiendo de 6am a 9pm."
                    value={descripcion}
                    onChange={(e) => setDescripcion(e.target.value)}
                  />
                  <p className="tz-camera-note" style={{ margin: "2px 0 0", textAlign: "right" }}>
                    {descripcion.length}/100
                  </p>
                  <div className="tz-add-entry-actions">
                    <button className="tz-camera-cancel" onClick={() => setEditandoDescripcion(false)} disabled={savingDescripcion}>
                      Cancelar
                    </button>
                    <button
                      className="tz-pw-submit tz-payment-save"
                      disabled={savingDescripcion}
                      onClick={async () => {
                        setSavingDescripcion(true);
                        await actualizar(conductor.id, { descripcion: descripcion.trim() || null });
                        setSavingDescripcion(false);
                        setEditandoDescripcion(false);
                      }}
                    >
                      {savingDescripcion ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
                      Guardar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="tz-camera-cancel tz-image-manager-btn"
                  style={{ marginTop: 8 }}
                  onClick={() => {
                    setDescripcion(conductor.descripcion || "");
                    setEditandoDescripcion(true);
                  }}
                >
                  <Pencil size={14} /> {conductor.descripcion ? "Editar descripción" : "Agregar descripción"}
                </button>
              )}

              {/* Vista previa en vivo — EXACTAMENTE la misma tarjeta
                 (glow por nivel_servicio incluido) que ve un pasajero
                 en la Home o al abrir el chat, para que el conductor
                 sepa qué está mostrando sin tener que pedirle a nadie
                 que le mande captura. */}
              <p className="tz-field-label" style={{ marginTop: 14 }}>
                Vista previa
              </p>
              <ConductorPublicCard conductor={conductor} isLoggedIn />
            </div>
          </>
        )}
      </main>

      {editandoPerfil && conductor && (
        <GestionImagenModal
          nombre={conductor.nombre}
          fotoUrl={conductor.foto_url}
          storageKey={conductor.id}
          isProfilePic
          onFotoUrlChange={(url) => actualizar(conductor.id, { foto_url: url })}
          onClose={() => setEditandoPerfil(false)}
        />
      )}

      {mensajesOpen && conductor && (
        <ConductorChatInboxModal conductorId={conductor.id} onClose={() => setMensajesOpen(false)} />
      )}
    </div>
  );
}
