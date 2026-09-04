import { useEffect, useMemo, useState } from "react";
import { LogIn, LogOut, Car, Users, MessageCircle, X, Loader2, MapPin } from "lucide-react";
import { supabase } from "../supabaseClient";
import { useConductoresPublicos } from "../hooks/useConductoresPublicos";
import { useCategoriasPublicas } from "../hooks/useCategoriasPublicas";
import { useCrearConductorConUsuario } from "../hooks/useCrearConductorConUsuario";
import { useCrearRecolectorPendiente } from "../hooks/useCrearRecolectorPendiente";
import { useAnuncioActivo } from "../hooks/useAnuncioActivo";
import { useLocalidades } from "../hooks/useLocalidades";
import { useBienvenidaNeon } from "../hooks/useBienvenidaNeon";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import {
  TIPO_MENSAJE_OFERTA,
  ESTADO_OFERTA_PENDIENTE,
  ESTADO_OFERTA_ACEPTADA,
  ESTADO_OFERTA_EN_TRANSITO,
} from "../hooks/useChatMensajes";
import { TIPO_USUARIO_PASAJERO } from "../lib/taxiEnums";
import { agruparPorNivel } from "../lib/nivelServicio";
import { reverseGeocode } from "../lib/reverseGeocode";
import Styles from "../components/Styles";
import Dropdown from "../components/Dropdown";
import ConductorPublicCard from "../components/ConductorPublicCard";
import LogoEasterEgg from "../components/LogoEasterEgg";
import PasajeroAuthForm from "../components/PasajeroAuthForm";
import NivelAccordionGroup from "../components/NivelAccordionGroup";
import AccesoConductorModal from "../components/AccesoConductorModal";
import AccesoRecolectorModal from "../components/AccesoRecolectorModal";
import ChatModal from "../components/ChatModal";
import AnuncioPopupModal from "../components/AnuncioPopupModal";
import RadarGlobal from "../components/RadarGlobal";
import AnimacionNeonBienvenida from "../components/AnimacionNeonBienvenida";
import logo from "../assets/logo.png";

// Persistencia del filtro de localidad — sobrevive a un F5 (ver el
// useState/useEffect de `localidad` más abajo). Es la única pieza de
// estado de esta pantalla que se guarda en localStorage: `destino` NO
// (ese ya tiene su propia persistencia real, contra la base, ver el
// efecto de recuperación de sesión).
const LOCALIDAD_STORAGE_KEY = "tz_localidad_filtro";

// Ruta "/" — directorio público de solo lectura. Misma organización
// que el Directorio del Admin (ConductoresDirectorio.jsx): pestañas por
// categoría, y dentro de cada una, acordeones por nivel_servicio
// (VIP/Premium/Ejecutivo/Económico) con el mismo puntito de color y el
// mismo glow de borde (`data-nivel` en .tz-card, ver Styles.jsx) — acá
// comparten la lógica de agrupado (lib/nivelServicio.js) y el shell del
// acordeón (NivelAccordionGroup.jsx), la única diferencia real es que
// la tarjeta de acá no tiene lápiz/estado/Zap, es puramente informativa.
//
// Header: izquierda apilada (Conductores/Recolectores — cada botón abre
// un modal DUAL con toggle Ingresar/Registrarse; "Ingresar" es
// Teléfono+PIN y rutea sola según el rol real de la cuenta, ver
// StaffLoginForm.jsx), derecha un solo botón "Login" para Pasajeros.
export default function HomePage() {
  const { usuario, logout } = useTaxiAuth();
  // Bug reportado: "Contactar" se veía para cualquier sesión activa,
  // no solo Pasajero — un Conductor/Recolector logueado en el mismo
  // navegador también tiene `usuario` truthy. El gate real es el ROL,
  // no la mera existencia de sesión.
  const esPasajero = usuario?.rol === TIPO_USUARIO_PASAJERO;
  const { conductores, categorias, loading, error } = useConductoresPublicos();
  const { categorias: categoriasRegistro, subgrupos: subgruposRegistro } = useCategoriasPublicas();
  const { crear: crearConductorConUsuario } = useCrearConductorConUsuario();
  const { crear: crearRecolectorPendiente } = useCrearRecolectorPendiente();
  // Pop-up de marketing — ver useAnuncioActivo.js para la lógica de
  // vigencia (fecha_inicio/fecha_fin) + frecuencia (localStorage). Se
  // muestra a CUALQUIER visitante de la Home, con o sin sesión de
  // Pasajero — es publicidad, no contenido privado.
  const { anuncio, cerrar: cerrarAnuncio } = useAnuncioActivo();
  const { localidades } = useLocalidades();
  // Bienvenida de cuenta nueva (Fase Neón) — misma idea que
  // ConductorPage.jsx: una sola vez por usuario, al entrar por primera
  // vez a SU cuenta (no a cualquier visita anónima de la Home, por eso
  // `esPasajero` — exige sesión real, no solo estar mirando el
  // Directorio sin loguearse).
  const { mostrar: mostrarBienvenida, marcarVista: marcarBienvenidaVista } = useBienvenidaNeon(
    usuario?.id,
    esPasajero
  );
  const [activeTab, setActiveTab] = useState("");
  // Persistencia (Punto 1): se lee de localStorage al montar y se
  // reescribe cada vez que cambia — así un F5 no pierde el filtro.
  const [localidad, setLocalidad] = useState(() => {
    try {
      return localStorage.getItem(LOCALIDAD_STORAGE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      if (localidad) localStorage.setItem(LOCALIDAD_STORAGE_KEY, localidad);
      else localStorage.removeItem(LOCALIDAD_STORAGE_KEY);
    } catch {
      // localStorage puede fallar (modo privado, cuota llena) — no es
      // crítico, el filtro simplemente no sobrevive un F5 esta vez.
    }
  }, [localidad]);
  // El Buscador Inteligente (Nominatim) ya NO vive acá — se mudó
  // enteramente dentro de <RadarGlobal/> (Filtro Geográfico y Buscador
  // en el Radar). Acá solo queda el destino YA elegido, sea cual sea su
  // origen (buscador, pin manual, o restaurado por la persistencia de
  // sesión) — siempre con la forma { lat, lon, nombre }.
  const [destinoSeleccionado, setDestinoSeleccionado] = useState(null);
  const [radarOpen, setRadarOpen] = useState(false);
  // Toast temporal para el bloqueo de "sin destino" — desaparece solo.
  const [avisoDestino, setAvisoDestino] = useState("");

  // Candado de Negociación Única: el pasajero solo puede tener UN
  // conductor "activo" a la vez, y ESE se elige exclusivamente al tocar
  // su ícono de taxi dentro del Radar (mapa) — no desde la lista general
  // de abajo. Mientras no haya ninguno elegido, TODOS los "Contactar" de
  // la lista quedan deshabilitados; en cuanto se elige uno, solo el de
  // ESE conductor queda usable (para reabrir el mismo hilo), el resto se
  // apaga. Se limpia solo al finalizar o cancelar el viaje (mismo gancho
  // que ya limpia `destinoSeleccionado`, ver `onLimpiarDestino` más
  // abajo — ChatWindow.jsx ya lo dispara en los dos casos).
  const [conductorActivoId, setConductorActivoId] = useState(null);

  // Flujo de Contacto (Fase 0): "Contactar" desde la tarjeta del
  // directorio general NO manda ningún mensaje solo — abre el chat
  // limpio, el pasajero escribe o usa el botón "Tonazo" (ver
  // ChatWindow.jsx). Elegir un conductor DESDE el Radar sigue siendo
  // autocontacto contextual (ChatModal.jsx le pregunta el precio al
  // conductor apenas se abre) porque ahí el pasajero YA pasó por el
  // buscador/pin de destino un segundo antes. `chatAuto` viaja junto
  // con `chatConductorId` para que ChatModal sepa cuál de los dos modos
  // le toca a ESTE chat en particular.
  const [chatAuto, setChatAuto] = useState(true);

  // Bloqueo estricto de destino: solo aplica al flujo AUTOMÁTICO (Radar)
  // — ese sí necesita el destino para armar el mensaje contextual. El
  // "Contactar" manual no lo exige, porque no manda nada solo.
  const abrirChat = (conductorId, { auto = true } = {}) => {
    if (auto && !destinoSeleccionado) {
      setAvisoDestino("⚠️ Por favor, busca tu destino en el Radar antes de pedir un taxi");
      setTimeout(() => setAvisoDestino(""), 3500);
      return;
    }
    // Candado de Negociación Única: revalidado acá también (no solo con
    // el `disabled` del botón de la lista/el click del ícono en el mapa)
    // — mismo criterio que `puedeRecogerPasajero` en ChatWindow.jsx, una
    // llamada que le gane de mano al re-render no debería poder saltarse
    // la regla. El flujo AUTOMÁTICO (elegir el taxi en el mapa) es el
    // único que puede FIJAR un conductor activo nuevo — pero no si ya
    // hay OTRO en curso; el manual (lista general) nunca fija uno nuevo,
    // solo puede reabrir el que ya está activo.
    if (auto) {
      if (conductorActivoId && conductorId !== conductorActivoId) {
        setAvisoDestino("⚠️ Ya tienes una negociación activa con otro conductor");
        setTimeout(() => setAvisoDestino(""), 3500);
        return;
      }
      setConductorActivoId(conductorId);
    } else if (conductorId !== conductorActivoId) {
      // Ningún conductor activo todavía, o es uno DISTINTO al ya activo
      // — la lista general solo puede reabrir el hilo del que ya está
      // en curso, nunca arrancar uno nuevo.
      return;
    }
    setChatAuto(auto);
    setChatConductorId(conductorId);
  };

  // Bloqueo de Radar: sin localidad elegida en el filtro principal, el
  // buscador de RadarGlobal.jsx no tendría con qué acotar el viewbox de
  // Nominatim (ver Filtro Geográfico, ronda anterior) — mismo toast que
  // ya usa el bloqueo de destino, reutilizado para esta otra alerta.
  const handleAbrirRadar = () => {
    if (!localidad) {
      setAvisoDestino("⚠️ Selecciona una localidad antes de abrir el Radar");
      setTimeout(() => setAvisoDestino(""), 3500);
      return;
    }
    setRadarOpen(true);
  };

  const [loginOpen, setLoginOpen] = useState(false);
  const [accesoConductorOpen, setAccesoConductorOpen] = useState(false);
  const [accesoRecolectorOpen, setAccesoRecolectorOpen] = useState(false);
  const [avisoPeticion, setAvisoPeticion] = useState("");
  // Se guarda solo el ID, no una copia del objeto — `conductores` ya
  // está suscrito a Realtime (useConductoresPublicos.js), así que
  // derivar el conductor actual de ahí en cada render (en vez de
  // clonarlo al abrir el chat) hace que, si cambia de Libre a En
  // Carrera mientras el chat sigue abierto, la etiqueta de estado en
  // ChatConductorHeader se actualice sola — sin esto quedaba una foto
  // fija del momento en que se abrió el chat, ver ChatModal.jsx.
  const [chatConductorId, setChatConductorId] = useState(null);
  const chatConductor = chatConductorId ? conductores.find((c) => c.id === chatConductorId) ?? null : null;

  // Persistencia de sesión (recuperación ante recargas o apagados): sin
  // esto, recargar la página perdía el viaje activo del lado del
  // Pasajero por completo — el conductor lo seguía viendo en su
  // bandeja (`chat_mensajes` nunca se borra), pero acá no quedaba nada
  // que reconstruyera `destinoSeleccionado`/`chatConductorId`. Se
  // ejecuta una sola vez por sesión de Pasajero (dispara de nuevo solo
  // si cambia el usuario logueado, ej. cerrar sesión y entrar con otra
  // cuenta). El `setX(actual => actual ?? …)` de abajo evita pisar algo
  // que el pasajero ya haya elegido a mano en la breve ventana antes de
  // que la consulta responda.
  useEffect(() => {
    if (!esPasajero || !usuario?.id) return undefined;
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase
        .from("chat_mensajes")
        .select("conductor_id, created_at")
        .eq("pasajero_id", usuario.id)
        .eq("tipo", TIPO_MENSAJE_OFERTA)
        .in("estado_oferta", [ESTADO_OFERTA_PENDIENTE, ESTADO_OFERTA_ACEPTADA, ESTADO_OFERTA_EN_TRANSITO])
        .order("created_at", { ascending: false })
        .limit(1);
      if (cancelado || error || !data || data.length === 0) return;

      const conductorIdActivo = data[0].conductor_id;
      // La fila de la oferta no repite el destino — el que lo trae es
      // el primer mensaje del hilo (el auto-mensaje de contacto, ver
      // ChatModal.jsx), así que se busca aparte.
      const { data: mensajeConDestino } = await supabase
        .from("chat_mensajes")
        .select("destino_lat, destino_lng")
        .eq("conductor_id", conductorIdActivo)
        .eq("pasajero_id", usuario.id)
        .not("destino_lat", "is", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (cancelado) return;

      if (mensajeConDestino?.destino_lat != null && mensajeConDestino?.destino_lng != null) {
        const lat = mensajeConDestino.destino_lat;
        const lon = mensajeConDestino.destino_lng;
        let nombre = "Destino en curso";
        try {
          nombre = await reverseGeocode(lat, lon);
        } catch {
          // Sin nombre legible se restaura igual con el genérico de
          // arriba — las coordenadas son lo único que de verdad hace
          // falta para que el mapa y la ruta funcionen.
        }
        if (!cancelado) setDestinoSeleccionado((actual) => actual ?? { lat, lon, nombre });
      }
      // Una sesión restaurada siempre fue autocontacto (vino del Radar,
      // el único flujo que persiste destino) — nunca "Contactar" manual.
      if (!cancelado) {
        setChatAuto(true);
        setChatConductorId((actual) => actual ?? conductorIdActivo);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [esPasajero, usuario?.id]);

  const categoriasConConductores = useMemo(
    () => categorias.filter((cat) => conductores.some((c) => c.categoria_id === cat.id)),
    [categorias, conductores]
  );

  // Panel Admin: Localidades ya no es un array estático — el filtro
  // lee en vivo de la tabla `localidades` (useLocalidades.js), la misma
  // que administra AdminLocalidadesModal.jsx. `localidadFiltroCoords` es
  // lo que RadarGlobal.jsx necesita para acotar el buscador de
  // direcciones a esta zona (viewbox+bounded=1).
  const localidadFiltroFila = localidades.find((l) => l.nombre === localidad);
  const localidadFiltroCoords = localidadFiltroFila ? { lat: localidadFiltroFila.lat, lon: localidadFiltroFila.lon } : null;

  useEffect(() => {
    setActiveTab((prev) => prev || categoriasConConductores[0]?.id || "");
  }, [categoriasConConductores]);

  const conductoresDeLaTab = conductores.filter(
    (c) => c.categoria_id === activeTab && (!localidad || c.localidad === localidad)
  );
  const grupos = agruparPorNivel(conductoresDeLaTab);

  const avisarPeticionEnviada = (mensaje) => {
    setAvisoPeticion(mensaje);
    setTimeout(() => setAvisoPeticion(""), 6000);
  };

  return (
    <div className="tz-root">
      <Styles />
      {mostrarBienvenida && (
        <AnimacionNeonBienvenida
          eyebrow="✦ Bienvenido a TaxiPE ✦"
          titulo={usuario?.nombre}
          descripcion="Sabemos que estás harto de esperar transporte — ¡Qué disfrutes! 😉"
          onTerminar={marcarBienvenidaVista}
        />
      )}
      <header className="tz-header">
        <div className="tz-header-row">
          <div className="tz-header-side tz-header-side-left">
            <button
              className="tz-header-btn"
              onClick={() => setAccesoConductorOpen(true)}
              aria-label="Acceso de conductor"
            >
              <Car size={19} />
              <span className="tz-header-btn-label">Conductores</span>
            </button>
            <button
              className="tz-header-btn"
              onClick={() => setAccesoRecolectorOpen(true)}
              aria-label="Acceso de recolector"
            >
              <Users size={19} />
              <span className="tz-header-btn-label">Recolectores</span>
            </button>
          </div>

          <div className="tz-header-center">
            <LogoEasterEgg src={logo} alt="TaxiP" className="tz-logo" />
            <p className="tz-subtitle">Tu taxi, al toque</p>
          </div>

          <div className="tz-header-side tz-header-side-right">
            {usuario ? (
              <button className="tz-header-btn" onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión">
                <LogOut size={19} />
                <span className="tz-header-btn-label">Salir</span>
              </button>
            ) : (
              <button className="tz-header-btn" onClick={() => setLoginOpen(true)} aria-label="Ingresar">
                <LogIn size={19} />
                <span className="tz-header-btn-label">Login</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="tz-main">
        {/* Restauración de layout: el filtro de localidad vuelve a la
           pantalla principal, encima del botón de Radar, los dos
           centrados (ver .tz-radar-bar en Styles.jsx) — antes vivía
           suelto más abajo, entre las pestañas y la lista. */}
        <div className="tz-radar-bar">
          {localidades.length > 0 && (
            <div className="tz-localidad-filtro-wrap">
              <Dropdown
                value={localidad}
                onChange={setLocalidad}
                options={[{ value: "", label: "Todas las localidades" }, ...localidades.map((l) => ({ value: l.nombre, label: l.nombre }))]}
                ariaLabel="Filtrar por localidad"
              />
            </div>
          )}
          {/* El Buscador Inteligente se mudó adentro de <RadarGlobal/> —
             acá solo queda mostrar el destino YA elegido (si hay) y el
             botón que abre el Radar, donde vive el buscador/pin. */}
          {destinoSeleccionado && (
            <div className="tz-destino-actual-pill">
              <MapPin size={14} />
              <span>{destinoSeleccionado.nombre}</span>
            </div>
          )}
          <button type="button" className="tz-radar-btn" onClick={handleAbrirRadar}>
            {destinoSeleccionado ? "Ver Radar 📍" : "Buscar destino / Radar 📍"}
          </button>
        </div>

        {loading ? (
          <div className="tz-loading" style={{ minHeight: "40vh" }}>
            <Loader2 className="tz-spin" size={28} />
            <p>Buscando conductores…</p>
          </div>
        ) : (
          <>
            {categoriasConConductores.length > 0 && (
              <nav className="tz-tabs">
                {categoriasConConductores.map((cat) => (
                  <button
                    key={cat.id}
                    className={`tz-tab ${activeTab === cat.id ? "tz-tab-active" : ""}`}
                    onClick={() => setActiveTab(cat.id)}
                  >
                    {cat.nombre}
                  </button>
                ))}
              </nav>
            )}

            {error ? (
              <div className="tz-empty">
                <p>{error}</p>
              </div>
            ) : grupos.length === 0 ? (
              <div className="tz-empty">
                <p>No hay conductores disponibles en este momento.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Acordeón Inteligente: `grupos` (agruparPorNivel) ya
                   filtra los niveles SIN conductores en esta
                   tab+localidad — todo lo que llega acá tiene al menos
                   uno, así que "tiene conductores disponibles en esta
                   zona" = "está en este array". `defaultOpen` los abre a
                   todos apenas hay una localidad elegida; sin localidad,
                   arrancan colapsados (salvo el primero, para no dejar
                   la pantalla vacía a simple vista). El `key` con
                   `localidad`+`activeTab` fuerza un remount cada vez que
                   cambia el filtro, para que ese `defaultOpen` se
                   reevalúe de cero en vez de quedar pegado al estado
                   manual que el usuario haya tocado antes. */}
                {grupos.map((g, i) => (
                  <NivelAccordionGroup
                    key={`${g.nivel}-${activeTab}-${localidad}`}
                    nivel={g.nivel}
                    label={g.label}
                    count={g.conductores.length}
                    defaultOpen={localidad ? true : i === 0}
                  >
                    <div className="tz-grid">
                      {g.conductores.map((c) => (
                        <ConductorPublicCard
                          key={c.id}
                          conductor={c}
                          isLoggedIn={esPasajero}
                          layout
                          transition={{ type: "spring", stiffness: 380, damping: 32 }}
                        >
                          {/* Candado de Negociación Única: "Contactar" ya
                             NO es una vía para arrancar un contacto nuevo
                             — directamente no existe en el DOM salvo en
                             la tarjeta del conductor que ya está activo
                             (elegido con su ícono de taxi en el
                             Radar/mapa), donde sirve para REABRIR ese
                             mismo hilo. `null`, no un botón deshabilitado
                             — el pasajero no debe ni verlo en el resto de
                             las tarjetas. */}
                          {c.id === conductorActivoId && (
                            <button
                              type="button"
                              className="tz-scan-btn tz-payment-save"
                              style={{ justifyContent: "center", marginTop: 10 }}
                              onClick={() => abrirChat(c.id, { auto: false })}
                            >
                              <MessageCircle size={16} /> Contactar
                            </button>
                          )}
                        </ConductorPublicCard>
                      ))}
                    </div>
                  </NivelAccordionGroup>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {loginOpen && (
        <div className="tz-modal-backdrop">
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button className="tz-modal-close" onClick={() => setLoginOpen(false)} aria-label="Cerrar">
              <X size={18} />
            </button>
            <img src={logo} alt="TaxiP" className="tz-modal-logo" />
            <p className="tz-brand-sub">Ingresa o regístrate</p>
            <PasajeroAuthForm onSuccess={() => setLoginOpen(false)} />
          </div>
        </div>
      )}

      {accesoConductorOpen && (
        <AccesoConductorModal
          categorias={categoriasRegistro}
          subgrupos={subgruposRegistro}
          crearConductorConUsuario={crearConductorConUsuario}
          onClose={() => setAccesoConductorOpen(false)}
          onCreatedUsuario={() =>
            avisarPeticionEnviada(
              "Tu solicitud de conductor fue enviada. El Admin la va a revisar en el Centro de Peticiones."
            )
          }
        />
      )}

      {accesoRecolectorOpen && (
        <AccesoRecolectorModal
          crearRecolector={crearRecolectorPendiente}
          onClose={() => setAccesoRecolectorOpen(false)}
          onCreated={() =>
            avisarPeticionEnviada(
              "Tu solicitud de recolector fue enviada. El Admin la va a revisar en el Centro de Peticiones."
            )
          }
        />
      )}

      {chatConductor && esPasajero && (
        <ChatModal
          // Bug de "Viaje Fantasma" (blindaje defensivo, igual que
          // ConductorChatInboxModal en ConductorPage.jsx): si alguna vez
          // `chatConductorId` pasa de un conductor a otro SIN pasar por
          // null en el medio, este `key` fuerza un remount limpio en vez
          // de reusar la instancia vieja de ChatWindow (con su mapa/
          // estado del viaje anterior todavía cargado).
          key={chatConductorId}
          conductor={chatConductor}
          pasajeroId={usuario.id}
          categorias={categorias}
          // `destino` puede llegar null en el flujo manual ("Contactar" de
          // la tarjeta, chatAuto=false) — ChatModal.jsx no lo necesita ahí,
          // solo lo usa cuando `autoContactar` es true (auto-mensaje
          // contextual "...hasta {destino.nombre}?").
          destino={destinoSeleccionado}
          autoContactar={chatAuto}
          // Limpieza de memoria (anti-reciclaje): al cancelar o
          // finalizar un viaje, ChatWindow.jsx llama esto para que el
          // próximo viaje NO herede un destino de la carrera anterior.
          // También libera el Candado de Negociación Única — mismos DOS
          // casos exactos (cancelado Y finalizado, ver los dos efectos
          // que llaman a `onLimpiarDestino` en ChatWindow.jsx), así que
          // no hace falta un callback aparte para esto.
          onLimpiarDestino={() => {
            setDestinoSeleccionado(null);
            setConductorActivoId(null);
          }}
          onClose={() => setChatConductorId(null)}
        />
      )}

      {radarOpen && (
        <RadarGlobal
          conductores={conductores}
          categorias={categorias}
          localidadFiltro={localidad}
          localidades={localidades}
          destino={destinoSeleccionado}
          onClose={() => setRadarOpen(false)}
          onSeleccionarConductor={(c) => {
            if (!esPasajero) return;
            // Anti-Spam de Asientos: RadarGlobal.jsx ya saca del mapa a
            // cualquier auto sin lugar (no se lo puede ni clickear), pero
            // esto revalida en el punto exacto donde se manda la
            // petición — mismo criterio que `puedeRecogerPasajero` en
            // ChatWindow.jsx (el botón ya viene disabled, pero el click
            // también se re-chequea) — por si el auto se llenó justo en
            // el instante entre que se pintó el marcador y se tocó.
            const totales = c.asientos_totales ?? 4;
            const ocupados = c.asientos_ocupados ?? 0;
            if (ocupados >= totales) {
              setAvisoDestino("⚠️ Este vehículo ya no tiene asientos disponibles — elige otro en el Radar.");
              setTimeout(() => setAvisoDestino(""), 3500);
              return;
            }
            setRadarOpen(false);
            abrirChat(c.id, { auto: true });
          }}
          // Elegir Destino (RadarGlobal.jsx) — llega desde el buscador de
          // direcciones O el pin manual, las dos formas conviven ahí
          // adentro; acá da igual cuál fue, siempre {lat, lon, nombre}.
          onDestinoElegido={setDestinoSeleccionado}
          // Botón "❌ Cambiar Ubicación" dentro del propio Radar — hace
          // falta aparte porque el buscador quedó adentro del modal, no
          // hay ninguna otra "X" visible mientras el Radar está abierto.
          onLimpiarDestino={() => setDestinoSeleccionado(null)}
        />
      )}

      {anuncio && <AnuncioPopupModal anuncio={anuncio} onClose={cerrarAnuncio} />}

      {avisoDestino && <div className="tz-toast-flotante">{avisoDestino}</div>}

      {avisoPeticion && (
        <div className="tz-modal-backdrop">
          <div className="tz-modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
            <button className="tz-modal-close" onClick={() => setAvisoPeticion("")} aria-label="Cerrar">
              <X size={18} />
            </button>
            <p className="tz-success" style={{ margin: "20px 0 0" }}>
              {avisoPeticion}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
