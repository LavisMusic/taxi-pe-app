import { useMemo, useState } from "react";
import { BookOpen, LogOut, Trophy, Users, Receipt, TrendingDown, Settings, LayoutGrid, Inbox, Wallet, ChevronDown, X, Loader2 } from "lucide-react";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { useVentas } from "../hooks/useVentas";
import { useUsuarios } from "../hooks/useUsuarios";
import { useConductores } from "../hooks/useConductores";
import { useCategorias } from "../hooks/useCategorias";
import { useFiadosConductores } from "../hooks/useFiadosConductores";
import { useGastosOperativos } from "../hooks/useGastosOperativos";
import { useAnularVenta } from "../hooks/useAnularVenta";
import { usePaquetes } from "../hooks/usePaquetes";
import { useCrearConductorConUsuario } from "../hooks/useCrearConductorConUsuario";
import { useRecargas } from "../hooks/useRecargas";
import { usePeticionesPin } from "../hooks/usePeticionesPin";
import { usePaquetesRecolectores } from "../hooks/usePaquetesRecolectores";
import { useRecargasRecolector } from "../hooks/useRecargasRecolector";
import { useCierresCaja } from "../hooks/useCierresCaja";
import {
  ESTADO_CONDUCTOR_RECHAZADO,
  ESTADO_CUENTA_PENDIENTE,
  METODOS_PAGO,
  METODOS_CON_COMPROBANTE,
} from "../lib/taxiEnums";
import { buildTopRanking } from "../lib/ranking";
import Styles from "../components/Styles";
import StatsSection from "../components/admin/StatsSection";
import UsuarioEstrellaChip from "../components/admin/UsuarioEstrellaChip";
import TopUsuariosModal from "../components/admin/TopUsuariosModal";
import LibretaFiadosModal from "../components/admin/LibretaFiadosModal";
import ConductoresDirectorio from "../components/admin/ConductoresDirectorio";
import GastosOperativosModal from "../components/admin/GastosOperativosModal";
import HistorialVentasModal from "../components/admin/HistorialVentasModal";
import CierreCajaModal from "../components/admin/CierreCajaModal";
import ConfigurarMembresiasModal from "../components/admin/ConfigurarMembresiasModal";
import UsuariosModal from "../components/admin/UsuariosModal";
import CategoriasModal from "../components/admin/CategoriasModal";
import PeticionesModal from "../components/admin/PeticionesModal";
import PagosMetodoModal from "../components/admin/PagosMetodoModal";
import RecargaRapidaForm from "../components/recolector/RecargaRapidaForm";
import RecargaRapidaRecolectorForm from "../components/admin/RecargaRapidaRecolectorForm";
import logo from "../assets/logo.png";

// Opciones del dropdown "Pagos" del header: Yape/Plin/Otros abren
// PagosMetodoModal (gauges Hoy/Histórico), Fiados reusa la Libreta ya
// existente — Efectivo no tiene medidor propio en la versión vieja.
const METODOS_PAGO_MENU = METODOS_PAGO.filter((m) => METODOS_CON_COMPROBANTE.includes(m.key));

// Ruta /admin — entra por RequireAdminMaster (código maestro en
// /login-admin). Reemplaza al App.jsx viejo (caja registradora):
// mismo layout general (tz-header, tz-stats, tz-main, tz-page-footer)
// pero leyendo únicamente las tablas nuevas de TaxiP.
export default function AdminDashboardPage() {
  const { logout } = useTaxiAuth();
  const {
    ventas,
    ventasVigentes,
    ventasHoy,
    metrics,
    loading: ventasLoading,
    error: ventasError,
    refresh: refreshVentas,
  } = useVentas();
  const {
    usuarios,
    loading: usuariosLoading,
    crearUsuario,
    actualizarUsuario,
    eliminarUsuario,
    aprobarUsuario,
    rechazarUsuario,
    refresh: refreshUsuarios,
  } = useUsuarios();
  const {
    conductores,
    categorias,
    subgrupos,
    loading: conductoresLoading,
    error: conductoresError,
    updateConductor,
    setEstado,
    aprobar,
    rechazar,
    crearConductor,
    refresh: refreshConductores,
  } = useConductores();
  // Hook aparte con el CRUD completo de categorías/subgrupos (el de
  // arriba solo lee, para no duplicar esa lógica en cada consumidor).
  // Al cerrar el modal se refresca useConductores() una sola vez para
  // que Directorio/formularios no se queden con nombres viejos.
  const {
    categorias: categoriasCRUD,
    subgrupos: subgruposCRUD,
    crearCategoria,
    actualizarCategoria,
    eliminarCategoria,
    reordenarCategorias,
    crearSubgrupo,
    actualizarSubgrupo,
    eliminarSubgrupo,
    duplicarSubgrupo,
    reordenarSubgrupos,
  } = useCategorias();
  // Eliminar un usuario rol="conductor" también borra su fila de
  // `conductores` (ver useUsuarios.js/eliminarUsuario) — hay que
  // refrescar ESTE hook aparte (instancia distinta de useConductores)
  // para que el Directorio y Recarga Rápida dejen de mostrarlo también
  // en la misma sesión, sin esperar a un F5.
  const eliminarUsuarioYSync = async (id) => {
    const result = await eliminarUsuario(id);
    if (!result.error) await refreshConductores();
    return result;
  };
  const { crear: crearConductorConUsuario } = useCrearConductorConUsuario({
    onDone: () => {
      refreshUsuarios();
      refreshConductores();
    },
  });
  const { porConductor, agregarFiado, registrarPago: registrarPagoFiado, eliminarCuentaConductor } =
    useFiadosConductores();
  const {
    peticiones: peticionesPin,
    marcarVerificado: marcarPinVerificado,
    generarYEnviarPin,
    descartar: descartarPeticionPin,
  } = usePeticionesPin();
  const { gastos, gastosHoy, totalGastosHoy, agregarGasto, eliminarGasto } = useGastosOperativos();
  const { paquetes, crearPaquete, actualizarPaquete, eliminarPaquete } = usePaquetes();
  const { anular, busyId: anulandoId } = useAnularVenta({
    onDone: () => {
      refreshVentas();
      refreshConductores();
    },
  });
  const { paquetes: paquetesRecolectores } = usePaquetesRecolectores();
  const {
    pendientes: recargasRecolectorPendientes,
    crearPeticion: crearRecargaRecolector,
    aprobarPeticion: aprobarRecargaRecolector,
    rechazarPeticion: rechazarRecargaRecolector,
  } = useRecargasRecolector();
  const { cierres, crearCierre } = useCierresCaja();
  // recolectorId null: el Admin no tiene fila propia en `usuarios` (su
  // sesión es el código maestro, no un login) — una recarga registrada
  // desde acá queda sin recolector asociado, a diferencia de las que
  // se hacen desde /recolector.
  const {
    registrarRecarga: registrarRecargaAdmin,
    saving: savingRecargaAdmin,
    error: errorRecargaAdmin,
  } = useRecargas({
    onDone: () => {
      refreshVentas();
      refreshConductores();
    },
  });

  const [topOpen, setTopOpen] = useState(false);
  const [libretaOpen, setLibretaOpen] = useState(false);
  const [gastosOpen, setGastosOpen] = useState(false);
  const [historialOpen, setHistorialOpen] = useState(false);
  const [cierreOpen, setCierreOpen] = useState(false);
  const [membresiasOpen, setMembresiasOpen] = useState(false);
  const [usuariosOpen, setUsuariosOpen] = useState(false);
  const [categoriasOpen, setCategoriasOpen] = useState(false);
  const [peticionesOpen, setPeticionesOpen] = useState(false);
  const [pagosMenuOpen, setPagosMenuOpen] = useState(false);
  const [pagosMetodoAbierto, setPagosMetodoAbierto] = useState(null);
  const [recargaOpen, setRecargaOpen] = useState(false);
  // Único punto de entrada de Recarga Rápida en el Admin: el botón ⚡
  // de una tarjeta del Directorio, que siempre llega con un conductor
  // ya elegido (lockedConductor en RecargaRapidaForm).
  const [recargaConductor, setRecargaConductor] = useState(null);
  // Mismo patrón que arriba pero para el ⚡ de una tarjeta de Recolector
  // (categoría "Recolectores" del Directorio).
  const [recargaRecolectorOpen, setRecargaRecolectorOpen] = useState(false);
  const [recargaRecolector, setRecargaRecolector] = useState(null);

  // El ranking/Estrella usan ventas VIGENTES: una venta anulada nunca
  // se cobró de verdad, no debería empujar a nadie al primer puesto.
  const ranking = useMemo(
    () => buildTopRanking({ ventas: ventasVigentes, conductores, usuarios }),
    [ventasVigentes, conductores, usuarios]
  );

  const loading = ventasLoading || usuariosLoading || conductoresLoading;
  // Mismo criterio que PeticionesModal (aprobado:false y no rechazado)
  // — ver el comentario de esPendienteDeRevision ahí, es el fix del bug
  // "conductor fantasma" (contar por `estado` podía no coincidir con
  // ningún caso real y dejar el badge en 0 con peticiones de verdad).
  const totalPeticiones =
    conductores.filter((c) => !c.aprobado && c.estado !== ESTADO_CONDUCTOR_RECHAZADO).length +
    usuarios.filter((u) => u.rol === "recolector" && u.estado_cuenta === ESTADO_CUENTA_PENDIENTE).length +
    peticionesPin.length +
    recargasRecolectorPendientes.length;

  return (
    <div className="tz-root">
      <Styles />
      <header className="tz-header">
        <div className="tz-header-row">
          <div className="tz-header-side tz-header-side-left">
            <button className="tz-header-btn" onClick={() => setLibretaOpen(true)} aria-label="Fiados">
              <BookOpen size={19} />
              <span className="tz-header-btn-label">Fiados</span>
            </button>
            <button className="tz-header-btn" onClick={() => setTopOpen(true)} aria-label="Top Usuarios">
              <Trophy size={19} />
              <span className="tz-header-btn-label">Top Usuarios</span>
            </button>
            <button
              className="tz-header-btn"
              onClick={() => setPeticionesOpen(true)}
              aria-label="Centro de Peticiones"
              style={{ position: "relative" }}
            >
              <Inbox size={19} />
              <span className="tz-header-btn-label">Peticiones</span>
              {totalPeticiones > 0 && <span className="tz-header-btn-badge">{totalPeticiones}</span>}
            </button>
          </div>

          <div className="tz-header-center">
            <img src={logo} alt="TaxiP" className="tz-logo" />
            <p className="tz-subtitle">Panel de Administración</p>
          </div>

          <div className="tz-header-side tz-header-side-right">
            <div className="tz-global-search-wrap" style={{ width: "auto", flex: "0 0 auto" }}>
              <button
                className="tz-header-btn"
                onClick={() => setPagosMenuOpen((prev) => !prev)}
                aria-label="Pagos"
              >
                <Wallet size={19} />
                <span className="tz-header-btn-label">Pagos</span>
                <ChevronDown size={14} />
              </button>
              {pagosMenuOpen && (
                <>
                  <div className="tz-dropdown-backdrop" onClick={() => setPagosMenuOpen(false)} />
                  <div className="tz-global-search-dropdown" style={{ left: "auto", right: 0 }}>
                    {METODOS_PAGO_MENU.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        className="tz-global-search-item"
                        onClick={() => {
                          setPagosMetodoAbierto(m.key);
                          setPagosMenuOpen(false);
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="tz-global-search-item"
                      onClick={() => {
                        setLibretaOpen(true);
                        setPagosMenuOpen(false);
                      }}
                    >
                      Fiados
                    </button>
                  </div>
                </>
              )}
            </div>
            <button className="tz-header-btn" onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión">
              <LogOut size={19} />
              <span className="tz-header-btn-label">Salir</span>
            </button>
            <button className="tz-header-btn" onClick={() => setUsuariosOpen(true)} aria-label="Usuarios">
              <Users size={19} />
              <span className="tz-header-btn-label">Usuarios</span>
            </button>
          </div>
        </div>
      </header>

      <main className="tz-main">
        {loading ? (
          <div className="tz-loading" style={{ minHeight: "40vh" }}>
            <Loader2 className="tz-spin" size={28} />
            <p>Cargando panel…</p>
          </div>
        ) : (
          <>
            {(ventasError || conductoresError) && (
              <p className="tz-error">{ventasError || conductoresError}</p>
            )}

            <section className="tz-stats">
              <StatsSection metrics={metrics} />
              <UsuarioEstrellaChip ranking={ranking} />
            </section>

            <h2 style={{ margin: "22px 0 10px" }}>Directorio de Conductores</h2>
            <ConductoresDirectorio
              conductores={conductores}
              categorias={categorias}
              subgrupos={subgrupos}
              onUpdate={updateConductor}
              onSetEstado={setEstado}
              onRecargar={(conductor) => {
                setRecargaConductor(conductor);
                setRecargaOpen(true);
              }}
              recolectores={usuarios}
              onUpdateRecolector={actualizarUsuario}
              onRecargarRecolector={(recolector) => {
                setRecargaRecolector(recolector);
                setRecargaRecolectorOpen(true);
              }}
            />
          </>
        )}
      </main>

      {/* ---------------- BARRA INFERIOR (estilo original de la caja) ---------------- */}
      <footer className="tz-page-footer">
        <button className="tz-footer-btn tz-footer-btn-cierre" onClick={() => setCierreOpen(true)}>
          <Receipt size={18} />
          Cerrar Caja
        </button>
        <button className="tz-footer-btn tz-footer-btn-gastos" onClick={() => setGastosOpen(true)}>
          <TrendingDown size={18} />
          Gastos
        </button>
        <button className="tz-footer-btn tz-footer-btn-stock" onClick={() => setMembresiasOpen(true)}>
          <Settings size={18} />
          Configurar Membresías
        </button>
        <button className="tz-footer-btn tz-footer-btn-misventas" onClick={() => setHistorialOpen(true)}>
          <Receipt size={18} />
          Historial de Ventas
        </button>
        <button className="tz-footer-btn tz-footer-btn-catalogo" onClick={() => setCategoriasOpen(true)}>
          <LayoutGrid size={18} />
          Categorías
        </button>
      </footer>

      {recargaOpen && (
        <div className="tz-modal-backdrop">
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="tz-modal-close"
              onClick={() => {
                setRecargaOpen(false);
                setRecargaConductor(null);
              }}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
            <RecargaRapidaForm
              conductores={conductores}
              categorias={categorias}
              subgrupos={subgrupos}
              recolectorId={null}
              registrarRecarga={registrarRecargaAdmin}
              crearConductor={crearConductor}
              saving={savingRecargaAdmin}
              error={errorRecargaAdmin}
              paquetes={paquetes}
              lockedConductor={recargaConductor}
            />
          </div>
        </div>
      )}

      {recargaRecolectorOpen && (
        <div className="tz-modal-backdrop">
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="tz-modal-close"
              onClick={() => {
                setRecargaRecolectorOpen(false);
                setRecargaRecolector(null);
              }}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
            <RecargaRapidaRecolectorForm
              recolector={recargaRecolector}
              paquetes={paquetesRecolectores}
              crearPeticion={crearRecargaRecolector}
              onDone={refreshUsuarios}
            />
          </div>
        </div>
      )}

      {topOpen && <TopUsuariosModal ranking={ranking} onClose={() => setTopOpen(false)} />}
      {libretaOpen && (
        <LibretaFiadosModal
          conductores={conductores}
          porConductor={porConductor}
          agregarFiado={agregarFiado}
          registrarPago={registrarPagoFiado}
          eliminarCuentaConductor={eliminarCuentaConductor}
          onClose={() => setLibretaOpen(false)}
        />
      )}
      {pagosMetodoAbierto && (
        <PagosMetodoModal
          metodo={pagosMetodoAbierto}
          ventasVigentes={ventasVigentes}
          conductores={conductores}
          onClose={() => setPagosMetodoAbierto(null)}
        />
      )}
      {usuariosOpen && (
        <UsuariosModal
          usuarios={usuarios}
          categorias={categorias}
          subgrupos={subgrupos}
          crearUsuario={crearUsuario}
          actualizarUsuario={actualizarUsuario}
          eliminarUsuario={eliminarUsuarioYSync}
          crearConductorConUsuario={crearConductorConUsuario}
          onClose={() => setUsuariosOpen(false)}
        />
      )}
      {gastosOpen && (
        <GastosOperativosModal
          gastos={gastos}
          totalGastosHoy={totalGastosHoy}
          agregarGasto={agregarGasto}
          eliminarGasto={eliminarGasto}
          ventas={ventas}
          conductores={conductores}
          usuarios={usuarios}
          onClose={() => setGastosOpen(false)}
        />
      )}
      {historialOpen && (
        <HistorialVentasModal
          ventas={ventas}
          conductores={conductores}
          usuarios={usuarios}
          anular={anular}
          busyId={anulandoId}
          onClose={() => setHistorialOpen(false)}
        />
      )}
      {cierreOpen && (
        <CierreCajaModal
          ventasHoy={ventasHoy}
          gastosHoy={gastosHoy}
          totalGastosHoy={totalGastosHoy}
          cierres={cierres}
          crearCierre={crearCierre}
          esAdmin
          cajeroNombre="Admin"
          onClose={() => setCierreOpen(false)}
        />
      )}
      {membresiasOpen && (
        <ConfigurarMembresiasModal
          paquetes={paquetes}
          crearPaquete={crearPaquete}
          actualizarPaquete={actualizarPaquete}
          eliminarPaquete={eliminarPaquete}
          onClose={() => setMembresiasOpen(false)}
        />
      )}
      {categoriasOpen && (
        <CategoriasModal
          categorias={categoriasCRUD}
          subgrupos={subgruposCRUD}
          crearCategoria={crearCategoria}
          actualizarCategoria={actualizarCategoria}
          eliminarCategoria={eliminarCategoria}
          reordenarCategorias={reordenarCategorias}
          crearSubgrupo={crearSubgrupo}
          actualizarSubgrupo={actualizarSubgrupo}
          eliminarSubgrupo={eliminarSubgrupo}
          duplicarSubgrupo={duplicarSubgrupo}
          reordenarSubgrupos={reordenarSubgrupos}
          onClose={() => {
            setCategoriasOpen(false);
            refreshConductores();
          }}
        />
      )}
      {peticionesOpen && (
        <PeticionesModal
          conductores={conductores}
          categorias={categorias}
          onAprobar={aprobar}
          onRechazar={rechazar}
          usuarios={usuarios}
          onAprobarRecolector={aprobarUsuario}
          onRechazarRecolector={rechazarUsuario}
          peticionesPin={peticionesPin}
          onVerificarPin={marcarPinVerificado}
          onGenerarYEnviarPin={generarYEnviarPin}
          onDescartarPin={descartarPeticionPin}
          recargasRecolector={recargasRecolectorPendientes}
          onAprobarRecargaRecolector={(peticion) => {
            const recolector = usuarios.find((u) => u.id === peticion.recolector_id);
            return aprobarRecargaRecolector(peticion, recolector).then((res) => {
              if (!res.error) refreshUsuarios();
              return res;
            });
          }}
          onRechazarRecargaRecolector={rechazarRecargaRecolector}
          onClose={() => setPeticionesOpen(false)}
        />
      )}
    </div>
  );
}
