import { useEffect, useState } from "react";
import { LogOut, Pencil, Zap, Car, Ban, CreditCard, CalendarClock, MessageCircle, Save, Loader2 } from "lucide-react";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { useConductorSesion } from "../hooks/useConductorSesion";
import { useHilosChatConductor } from "../hooks/useChatMensajes";
import { useCategoriasPublicas } from "../hooks/useCategoriasPublicas";
import { useGpsBroadcaster } from "../hooks/useGpsBroadcaster";
import { usePaquetes } from "../hooks/usePaquetes";
import { useBienvenidaNeon } from "../hooks/useBienvenidaNeon";
import { useMembresiaActivadaNeon } from "../hooks/useMembresiaActivadaNeon";
import { useCompraCreditosNeon } from "../hooks/useCompraCreditosNeon";
import {
  ESTADO_CONDUCTOR_ACTIVO,
  ESTADO_CONDUCTOR_OCUPADO,
  ESTADO_CONDUCTOR_DESCONECTADO,
  ESTADO_CONDUCTOR_INHABILITADO,
  ESTADO_VERIFICACION_TEMPORAL,
  ESTADO_VERIFICACION_EN_REVISION,
} from "../lib/taxiEnums";
import { formatDate } from "../utils/format";
import Styles from "../components/Styles";
import GestionImagenModal from "../components/admin/GestionImagenModal";
import ConductorPublicCard from "../components/ConductorPublicCard";
import ConductorChatInboxModal from "../components/ConductorChatInboxModal";
import AnimacionNeonBienvenida from "../components/AnimacionNeonBienvenida";
import VerificarConductorForm from "../components/VerificarConductorForm";
import logo from "../assets/logo.png";

// Ruta /conductor — entra por RequireUsuarioRol rol="conductor".
// Mobile-first a propósito: una sola columna angosta (max 420px,
// centrada), textos y botón grandes — es la pantalla que el chofer
// tiene abierta mientras maneja, no un dashboard para leer con calma.
export default function ConductorPage() {
  const { usuario, logout, updateUsuario } = useTaxiAuth();
  const { conductor, loading, error, setEstado, actualizar, refresh: refrescarConductor } = useConductorSesion(usuario);
  const [mostrandoVerificacion, setMostrandoVerificacion] = useState(false);
  const { unreadCount, alertaSenas, descartarAlertaSenas, pasajerosEnCarrera } = useHilosChatConductor(conductor?.id);
  // Panel de Categorías e Íconos: la propia categoría del conductor —
  // el mismo ícono que ya se ve en RadarGlobal.jsx ahora también en el
  // mapa interno de SU bandeja de chats (ConductorChatInboxModal.jsx).
  const { categorias: categoriasPublicas } = useCategoriasPublicas();
  const iconoCategoriaUrl = categoriasPublicas.find((cat) => cat.id === conductor?.categoria_id)?.icono_url || null;

  // Animación Épica de Bienvenida — Fase Neón, en 3 partes (bug/pedido:
  // antes era una sola cosa, "muestra el paquete destacado al primer
  // login", y se pidió separarlo):
  //
  //   A) Bienvenida de cuenta nueva — una sola vez por usuario, al
  //      entrar por primera vez. Ya NO depende de que haya un paquete
  //      de membresía configurado; el mensaje es genérico ("Consigue
  //      clientes fácil y rápido"), no habla de ninguna membresía en
  //      particular.
  //   B) Membresía Activada — cada vez que `conductor.membresia_paquete_id`
  //      CAMBIA de verdad (primera activación o upgrade/downgrade a
  //      otro paquete) — ver useMembresiaActivadaNeon.js. Comparación
  //      por ESTADO (¿es un paquete distinto al de la última vez?),
  //      porque la membresía es "una a la vez".
  //   C) Compra Confirmada (créditos) — cada vez que se compra un
  //      paquete de créditos, incluso repitiendo el mismo de siempre —
  //      ver useCompraCreditosNeon.js. Comparación por EVENTO (¿hay una
  //      compra más nueva que la última que vimos?), porque los
  //      créditos se acumulan, no hay un "paquete activo" único que
  //      comparar como en B.
  //
  // Si dos quieren mostrarse a la vez, A > B > C en prioridad — la que
  // pierde el turno no se pierde, sigue "pendiente" en su propio hook
  // hasta que le toque.
  const { mostrar: mostrarBienvenida, marcarVista: marcarBienvenidaVista } = useBienvenidaNeon(
    usuario?.id,
    !!conductor
  );
  const { paquetes: paquetesMembresia } = usePaquetes();
  const { paqueteIdActivado, marcarVista: marcarMembresiaVista } = useMembresiaActivadaNeon(
    conductor?.id,
    conductor?.membresia_paquete_id ?? null
  );
  // String(p.id) porque useMembresiaActivadaNeon.js normaliza el id a
  // string a propósito (ver el comentario largo ahí — comparar number
  // contra string, sin esto, nunca matchea nada).
  const paqueteActivado = paquetesMembresia.find((p) => String(p.id) === paqueteIdActivado) ?? null;
  const mostrarMembresiaActivada = !mostrarBienvenida && !!paqueteActivado;

  const { compra: compraCreditos, marcarVista: marcarCompraCreditosVista } = useCompraCreditosNeon(
    conductor?.id,
    conductor?.ultima_compra_creditos_at ?? null,
    conductor?.ultimo_paquete_creditos_nombre,
    conductor?.ultimo_paquete_creditos_descripcion
  );
  const mostrarCompraCreditos = !mostrarBienvenida && !mostrarMembresiaActivada && !!compraCreditos;

  // Paywall del Conductor: acceso si tiene membresía vigente O créditos
  // (OR, no AND) — un conductor puede operar bajo cualquiera de los dos
  // modelos de cobro de esta app (ver TIPO_ITEM_MEMBRESIA/CREDITOS en
  // taxiEnums.js). Sin acceso solo cuando NINGUNO de los dos alcanza.
  // Se calcula ACÁ ARRIBA (no más abajo, donde vivía antes) porque
  // useGpsBroadcaster.js también lo necesita.
  // Bug real encontrado acá (no era el fetch — `creditos` y
  // `vencimiento_suscripcion` ya venían pedidos en useConductorSesion.js
  // desde la ronda pasada): `vencida` solo daba `true` si HABÍA una
  // fecha de vencimiento Y ya pasó. Un conductor que JAMÁS tuvo una
  // membresía (vencimiento_suscripcion = null, típico de uno nuevo que
  // solo opera a créditos) caía en `vencida = false` — "no vencida"
  // interpretado como "vigente" — y `tieneAcceso` daba `true` sin
  // importar los créditos, salteándose el Paywall entero. Ahora
  // `tieneMembresiaVigente` exige una fecha REAL y no vencida; null ya
  // no cuenta como "tiene membresía".
  const diasRestantes = conductor?.vencimiento_suscripcion
    ? Math.ceil((new Date(conductor.vencimiento_suscripcion) - new Date()) / 86400000)
    : null;
  const vencida = diasRestantes != null && diasRestantes < 0;
  const tieneMembresiaVigente = diasRestantes != null && diasRestantes >= 0;
  // Bug reportado — Inhabilitado por Admin: un baneo manual (ver
  // ESTADO_CONDUCTOR_INHABILITADO en taxiEnums.js) corta el acceso de
  // raíz, sin importar cuánta membresía/créditos tenga — a diferencia
  // del "sin saldo" de abajo, esto NO se levanta solo al recargar, hace
  // falta que el Admin lo vuelva a cambiar de estado a mano.
  const inhabilitadoPorAdmin = conductor?.estado === ESTADO_CONDUCTOR_INHABILITADO;
  const tieneAcceso = !inhabilitadoPorAdmin && (tieneMembresiaVigente || (conductor?.creditos ?? 0) > 0);

  // Fase 3 — transmite el GPS del conductor mientras tenga sesión, sin
  // depender de que tenga algún chat abierto (ver useGpsBroadcaster.js:
  // decide solo si va al radar público o al canal privado de la
  // carrera, según conductor.estado). Fix Seguridad (Paywall Estricto):
  // `tieneAcceso` corta el canal PÚBLICO de raíz — aunque `estado` en la
  // base todavía diga "activo" (stale, ver el auto-apagado más abajo),
  // este conductor deja de transmitirse al Radar en el instante en que
  // se queda sin créditos ni membresía, sin esperar ningún UPDATE.
  useGpsBroadcaster({
    conductorId: conductor?.id,
    estado: conductor?.estado,
    pasajerosEnCarrera,
    asientosOcupados: conductor?.asientos_ocupados,
    asientosTotales: conductor?.asientos_totales,
    tieneAcceso,
  });

  // Fix Seguridad (Auto-Apagado): si se detecta que ya no tiene acceso
  // pero su `estado` en la base TODAVÍA dice Activo/Ocupado (quedó así
  // desde antes de quedarse sin saldo — nadie lo tocó a mano todavía),
  // se fuerza un UPDATE a Desconectado. Esto es lo que saca al
  // conductor del Radar a nivel de DATOS, no solo de la UI/el Broadcast
  // de arriba — cualquier otra consulta que mire `conductores.estado`
  // directamente (ej. el fetch inicial de useRadarPublico.js) también
  // deja de encontrarlo.
  useEffect(() => {
    if (!conductor || tieneAcceso) return;
    if (conductor.estado === ESTADO_CONDUCTOR_ACTIVO || conductor.estado === ESTADO_CONDUCTOR_OCUPADO) {
      setEstado(ESTADO_CONDUCTOR_DESCONECTADO);
    }
  }, [conductor, tieneAcceso, setEstado]);

  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState("");
  const [editandoPerfil, setEditandoPerfil] = useState(false);
  const [mensajesOpen, setMensajesOpen] = useState(false);
  // Con qué pasajero abrir la bandeja — normalmente null (arranca en la
  // lista de hilos); si el conductor tocó "Ver Chat" desde la alerta de
  // "Hacer Señas", entra directo a esa conversación.
  const [pasajeroDesdeAlerta, setPasajeroDesdeAlerta] = useState(null);
  const [descripcion, setDescripcion] = useState("");
  const [editandoDescripcion, setEditandoDescripcion] = useState(false);
  const [savingDescripcion, setSavingDescripcion] = useState(false);

  const estadoActivo = conductor?.estado === ESTADO_CONDUCTOR_ACTIVO;

  const handleToggle = async () => {
    if (!conductor || toggling) return;
    const nuevoEstado = estadoActivo ? ESTADO_CONDUCTOR_OCUPADO : ESTADO_CONDUCTOR_ACTIVO;
    setToggling(true);
    setToggleError("");
    // Volver a Activo a mano también vacía el colectivo — "ya no tengo
    // pasajeros, estoy libre otra vez" es justo lo que significa este
    // botón, así el badge de asientos no se queda pegado en un número
    // viejo de un turno anterior.
    const { error: setError } =
      nuevoEstado === ESTADO_CONDUCTOR_ACTIVO
        ? await actualizar(conductor.id, { estado: nuevoEstado, asientos_ocupados: 0 })
        : await setEstado(nuevoEstado);
    setToggling(false);
    if (setError) setToggleError("No se pudo actualizar tu estado. Intenta de nuevo.");
  };

  return (
    <div className="tz-root">
      <Styles />
      {mostrarBienvenida ? (
        <AnimacionNeonBienvenida
          eyebrow="✦ Bienvenido a TaxiPE ✦"
          titulo={conductor?.nombre}
          descripcion="Consigue clientes fácil y rápido — ¡Qué disfrutes! 😉"
          onTerminar={marcarBienvenidaVista}
        />
      ) : mostrarMembresiaActivada ? (
        <AnimacionNeonBienvenida
          eyebrow="✦ Membresía Activada ✦"
          titulo={paqueteActivado.nombre}
          descripcion={paqueteActivado.descripcion}
          onTerminar={marcarMembresiaVista}
        />
      ) : mostrarCompraCreditos ? (
        <AnimacionNeonBienvenida
          eyebrow="✦ Compra Confirmada ✦"
          titulo={compraCreditos.nombre}
          descripcion={compraCreditos.descripcion}
          onTerminar={marcarCompraCreditosVista}
        />
      ) : null}
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
        ) : !conductor && usuario?.estado_verificacion === ESTADO_VERIFICACION_TEMPORAL ? (
          <div className="tz-empty">
            <p>
              Tu cuenta es temporal — completa tus datos (DNI, placa, fotos y PIN) para que quede en
              revisión del Admin. Tienes 7 días desde tu registro antes de que se elimine sola.
            </p>
            <button
              type="button"
              className="tz-scan-btn tz-payment-save"
              style={{ marginTop: 12 }}
              onClick={() => setMostrandoVerificacion(true)}
            >
              Completar mi registro
            </button>
          </div>
        ) : !conductor && usuario?.estado_verificacion === ESTADO_VERIFICACION_EN_REVISION ? (
          <div className="tz-empty">
            <p>
              Ya mandaste tu verificación — el Admin la va a revisar en el Centro de Peticiones. Puedes
              seguir usando la app mientras tanto.
            </p>
          </div>
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
              // Paywall del Conductor: rojo + "Inhabilitado" pisa
              // cualquier otro estado visual — sin membresía ni
              // créditos, ni siquiera importa si estaba Activo/Ocupado
              // antes, el switch entero se ve y se comporta como
              // bloqueado.
              className={`tz-estado-toggle ${!tieneAcceso ? "tz-estado-toggle-bloqueado" : ""}`}
              data-estado={conductor.estado}
              onClick={handleToggle}
              disabled={toggling || !tieneAcceso}
              aria-label={
                inhabilitadoPorAdmin
                  ? "Inhabilitado por el administrador"
                  : !tieneAcceso
                    ? "Inhabilitado — sin membresía activa ni créditos"
                    : estadoActivo
                      ? "Pasar a Ocupado"
                      : "Pasar a Activo"
              }
              // Mensajes distintos a propósito: a un conductor baneado
              // por el Admin decirle "recarga tu membresía" es
              // directamente falso — recargar NO lo reactiva, solo el
              // Admin puede hacerlo desde el Directorio.
              title={
                inhabilitadoPorAdmin
                  ? "Tu cuenta fue inhabilitada por el administrador. Contáctalo para más información."
                  : !tieneAcceso
                    ? "Recarga tu membresía o tus créditos para poder ponerte Activo"
                    : undefined
              }
            >
              {toggling ? (
                <Loader2 size={40} className="tz-spin" />
              ) : !tieneAcceso ? (
                <Ban size={44} color="var(--danger)" />
              ) : estadoActivo ? (
                <Zap size={44} color="var(--green)" />
              ) : (
                <Car size={44} color="var(--orange)" />
              )}
              <span className="tz-estado-toggle-label">
                {!tieneAcceso ? "🚫 Inhabilitado" : estadoActivo ? "ACTIVO" : "OCUPADO"}
              </span>
              <span className="tz-estado-toggle-hint">
                {inhabilitadoPorAdmin
                  ? "Tu cuenta fue inhabilitada por el administrador"
                  : !tieneAcceso
                    ? "Recarga tu membresía o tus créditos"
                    : `Toca para pasar a ${estadoActivo ? "Ocupado" : "Activo"}`}
              </span>
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
        <ConductorChatInboxModal
          // Bug de "Viaje Fantasma": sin este `key`, tocar "Ver chat" en
          // una alerta NUEVA mientras la bandeja ya estaba abierta con
          // OTRO pasajero no remontaba nada — `pasajeroInicial` es el
          // valor inicial de un useState adentro (BandejaContenido), así
          // que un cambio de PROP sin remount no hacía nada: seguía
          // mostrando el hilo/mapa del pasajero anterior. El `key`
          // fuerza a React a tirar la instancia vieja entera y montar
          // una limpia cada vez que cambia a quién se le abre el chat.
          key={pasajeroDesdeAlerta ?? "lista"}
          conductorId={conductor.id}
          pasajeroInicial={pasajeroDesdeAlerta}
          nivelServicio={conductor.nivel_servicio}
          iconoCategoriaUrl={iconoCategoriaUrl}
          onClose={() => {
            setMensajesOpen(false);
            setPasajeroDesdeAlerta(null);
          }}
        />
      )}

      {/* Alerta intrusiva de contacto — vive a nivel de página (no
         adentro del chat) a propósito: tiene que aparecer aunque el
         conductor no tenga la bandeja de Mensajes abierta en ese
         momento, ver alertaSenas en useHilosChatConductor.js (Realtime).
         Texto contextual: "Libre" es un primer contacto de verdad (pide
         precio); "En Carrera" es alguien pidiendo sumarse al colectivo
         que ya está en curso — son situaciones distintas, el aviso lo
         dice claro de entrada. "Ver Chat" cierra el modal Y redirige la
         pestaña activa de la bandeja al pasajero nuevo. */}
      {alertaSenas && (
        <div className="tz-modal-backdrop">
          <div className="tz-senas-alert" onClick={(e) => e.stopPropagation()}>
            <span className="tz-senas-alert-icon" aria-hidden="true">
              🙋‍♂️
            </span>
            <h2>{estadoActivo ? "¡Alguien necesita tu servicio!" : "¡Alguien quiere unirse a la carrera!"}</h2>
            <button
              type="button"
              className="tz-scan-btn tz-senas-alert-btn"
              onClick={() => {
                setPasajeroDesdeAlerta(alertaSenas.pasajeroId);
                setMensajesOpen(true);
                descartarAlertaSenas();
              }}
            >
              Ver Chat
            </button>
          </div>
        </div>
      )}

      {mostrandoVerificacion && (
        <div className="tz-modal-backdrop">
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <VerificarConductorForm
              usuario={usuario}
              submitLabel="Enviar verificación"
              onVerificado={(usuarioActualizado) => {
                updateUsuario(usuarioActualizado);
                setMostrandoVerificacion(false);
                refrescarConductor();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
