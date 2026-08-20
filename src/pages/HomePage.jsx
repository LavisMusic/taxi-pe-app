import { useEffect, useMemo, useState } from "react";
import { LogIn, LogOut, Car, Users, MessageCircle, X, Loader2 } from "lucide-react";
import { useConductoresPublicos } from "../hooks/useConductoresPublicos";
import { useCategoriasPublicas } from "../hooks/useCategoriasPublicas";
import { useCrearConductorConUsuario } from "../hooks/useCrearConductorConUsuario";
import { useCrearRecolectorPendiente } from "../hooks/useCrearRecolectorPendiente";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { TIPO_USUARIO_PASAJERO } from "../lib/taxiEnums";
import { agruparPorNivel } from "../lib/nivelServicio";
import Styles from "../components/Styles";
import ConductorPublicCard from "../components/ConductorPublicCard";
import LogoEasterEgg from "../components/LogoEasterEgg";
import PasajeroAuthForm from "../components/PasajeroAuthForm";
import NivelAccordionGroup from "../components/NivelAccordionGroup";
import AccesoConductorModal from "../components/AccesoConductorModal";
import AccesoRecolectorModal from "../components/AccesoRecolectorModal";
import ChatModal from "../components/ChatModal";
import logo from "../assets/logo.png";

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
  const [activeTab, setActiveTab] = useState("");
  const [localidad, setLocalidad] = useState("");

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

  const categoriasConConductores = useMemo(
    () => categorias.filter((cat) => conductores.some((c) => c.categoria_id === cat.id)),
    [categorias, conductores]
  );

  // Solo las localidades que de verdad tienen algún conductor cargado
  // — mostrar todo LOCALIDADES (el catálogo fijo) llenaría el
  // desplegable de opciones vacías.
  const localidadesConConductores = useMemo(
    () => [...new Set(conductores.map((c) => c.localidad).filter(Boolean))].sort(),
    [conductores]
  );

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

            {localidadesConConductores.length > 0 && (
              <select
                className="tz-text-input"
                style={{ maxWidth: 260, margin: "0 0 14px" }}
                value={localidad}
                onChange={(e) => setLocalidad(e.target.value)}
                aria-label="Filtrar por localidad"
              >
                <option value="">Todas las localidades</option>
                {localidadesConConductores.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
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
                {grupos.map((g, i) => (
                  <NivelAccordionGroup
                    key={g.nivel}
                    nivel={g.nivel}
                    label={g.label}
                    count={g.conductores.length}
                    defaultOpen={i === 0}
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
                          <button
                            type="button"
                            className="tz-scan-btn tz-payment-save"
                            style={{ justifyContent: "center", marginTop: 10 }}
                            onClick={() => setChatConductorId(c.id)}
                          >
                            <MessageCircle size={16} /> Contactar
                          </button>
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
        <div className="tz-modal-backdrop" onClick={() => setLoginOpen(false)}>
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
        <ChatModal conductor={chatConductor} pasajeroId={usuario.id} onClose={() => setChatConductorId(null)} />
      )}

      {avisoPeticion && (
        <div className="tz-modal-backdrop" onClick={() => setAvisoPeticion("")}>
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
