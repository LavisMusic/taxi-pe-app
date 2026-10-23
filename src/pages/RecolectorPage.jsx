import { useEffect, useState } from "react";
import { LogOut, UserPlus, Wallet, Receipt, CreditCard, CalendarClock, Loader2, X } from "lucide-react";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { useVentas } from "../hooks/useVentas";
import TextoMaquina from "../components/TextoMaquina";
import { useDescripcionesPublico } from "../hooks/useDescripciones";
import { useConductores } from "../hooks/useConductores";
import { useCrearConductorConUsuario } from "../hooks/useCrearConductorConUsuario";
import { useUsuarios } from "../hooks/useUsuarios";
import { useRecargas } from "../hooks/useRecargas";
import { usePaquetes } from "../hooks/usePaquetes";
import { usePaquetesRecolectores } from "../hooks/usePaquetesRecolectores";
import { useRecargasRecolector } from "../hooks/useRecargasRecolector";
import { useAnularVenta } from "../hooks/useAnularVenta";
import { useCierresCaja } from "../hooks/useCierresCaja";
import { useTurnoCaja } from "../hooks/useTurnoCaja";
import { useBienvenidaNeon } from "../hooks/useBienvenidaNeon";
import {
  ESTADO_RECARGA_APROBADO,
  ESTADO_VERIFICACION_EN_REVISION,
  ESTADO_VERIFICACION_TEMPORAL,
  startOfTodayISO,
} from "../lib/taxiEnums";
import VerificarRecolectorForm from "../components/VerificarRecolectorForm";
import { formatSoles, formatDate } from "../utils/format";
import Styles from "../components/Styles";
import RecargaRapidaForm from "../components/recolector/RecargaRapidaForm";
import PanelVentaRegistrada from "../components/PanelVentaRegistrada";
import { ventaParaPanel } from "../lib/ventaBoleta";
import RegistroConductorModal from "../components/recolector/RegistroConductorModal";
import AutorecargaRecolectorModal from "../components/recolector/AutorecargaRecolectorModal";
import CierreCajaModal from "../components/admin/CierreCajaModal";
import HistorialVentasModal from "../components/admin/HistorialVentasModal";
import AnimacionNeonBienvenida from "../components/AnimacionNeonBienvenida";
import logo from "../assets/logo.webp";
import BotonSoporte from "../components/BotonSoporte";
import BotonMensajes from "../components/mensajes/BotonMensajes";
import AnuncioPopupModal from "../components/AnuncioPopupModal";
import { useAnuncioActivo } from "../hooks/useAnuncioActivo";

// Ruta /recolector — entra por RequireUsuarioRol rol="recolector".
// Pantalla operativa de calle: widget de turno bien visible arriba,
// Recarga Rápida como módulo principal (sin modales de por medio) y
// Registro Rápido de conductor nuevo detrás de un botón/modal aparte.
// Footer con Cerrar Caja + Historial de Ventas — mismos modales que ya
// usa el Admin, con los mismos permisos (incluye Anular en el
// Historial): el recolector es quien de verdad cierra su turno en la
// calle, tiene sentido que vea lo mismo que el Admin ve de sus ventas.
export default function RecolectorPage() {
  const { usuario, logout, updateUsuario } = useTaxiAuth();
  // Pop-up de anuncios para recolectores (los crea el superadmin).
  const { anuncio, cerrar: cerrarAnuncio } = useAnuncioActivo("recolectores");
  const [verificandoCuenta, setVerificandoCuenta] = useState(false);
  const { ventas, ventasVigentes, loading: ventasLoading, refresh: refreshVentas } = useVentas();
  // Texto bajo el logo: el nombre y después las descripciones del Admin
  // (primero las de "Todos", luego las de recolectores).
  const descripcionesRecolector = useDescripcionesPublico("recolectores");
  const {
    conductores,
    categorias,
    subgrupos,
    loading: conductoresLoading,
    refresh: refreshConductores,
  } = useConductores();
  // Bug de sincronía (registrar conductor -> no puede loguearse):
  // useConductores().crearConductor solo insertaba en `conductores`,
  // nunca en `usuarios` — así que un conductor dado de alta desde acá
  // no tenía NINGUNA fila para que StaffLoginForm lo encontrara por
  // teléfono, y siempre caía en "Teléfono o PIN incorrectos" aunque el
  // teléfono fuera el correcto. Este hook (el mismo que ya usaba el
  // auto-registro de /login y el alta desde Usuarios del Admin) crea
  // las DOS filas juntas, con `pin: null` — así el conductor puede
  // entrar de una con su teléfono y crear su PIN en el primer login,
  // igual que ya le funciona a un Recolector auto-registrado.
  const { crear: crearConductorConUsuario } = useCrearConductorConUsuario({ onDone: refreshConductores });
  const { usuarios, refresh: refreshUsuarios } = useUsuarios();

  const { paquetes, glow: glowPaquetes } = usePaquetes();
  const { paquetes: paquetesRecolectores, glow: glowPaquetesRecolectores } = usePaquetesRecolectores();

  // Animación de Bienvenida — una vez por acceso, como en todos los
  // roles (ver useBienvenidaNeon.js). Antes solo salía si había un
  // paquete destacado de recolector y mostraba ESE paquete en vez de
  // dar la bienvenida.
  const { mostrar: mostrarBienvenida, marcarVista: marcarBienvenidaVista } = useBienvenidaNeon(
    usuario?.id,
    !!usuario
  );
  const { peticiones: misCompras, crearPeticion: crearAutorecarga } = useRecargasRecolector();
  const { cierres, crearCierre } = useCierresCaja();

  const { registrarRecarga, saving, error } = useRecargas({
    onDone: () => {
      refreshVentas();
      refreshConductores();
    },
  });
  const { anular, busyId: anulandoId } = useAnularVenta({
    onDone: () => {
      refreshVentas();
      refreshConductores();
    },
  });

  const [registroOpen, setRegistroOpen] = useState(false);
  const [registroMsg, setRegistroMsg] = useState("");
  const [cierreOpen, setCierreOpen] = useState(false);
  const [historialOpen, setHistorialOpen] = useState(false);
  // Desplegable de venta registrada (imprimir / resumen / boleta / copiar).
  const [ventaPanel, setVentaPanel] = useState(null);
  const [autorecargaOpen, setAutorecargaOpen] = useState(false);

  // Turno de caja (en la base, ver useTurnoCaja): empieza al cerrar el
  // anterior y debe cerrarse a las 00:00 (hora de Perú). Si ya venció, el
  // cierre se abre solo (y vuelve a abrirse mientras siga vencido) para
  // contar el efectivo y cerrar, o extender el turno 30 minutos.
  const {
    desde: turnoDesde,
    vencido: turnoVencido,
    extensiones: turnoExtensiones,
    maxExtensiones: turnoMaxExtensiones,
    obligatorio: turnoObligatorio,
    extender: extenderTurno,
    refresh: refreshTurno,
  } = useTurnoCaja();
  const turnoInicio = turnoDesde ?? startOfTodayISO();
  useEffect(() => {
    if (turnoVencido) setCierreOpen(true);
  }, [turnoVencido]);
  // Sin extensiones: el cierre queda encima y no se puede cerrar.
  const cierreVisible = cierreOpen || turnoObligatorio;

  // Base `ventasVigentes` (todo lo no-anulado, sin importar el día) en
  // vez de `ventasHoy` — un turno puede haber arrancado ayer (turno
  // nocturno) y el corte real es `turnoInicio`, no la medianoche.
  const ventasDelTurno = ventasVigentes.filter(
    (v) => v.recolector_id === usuario?.id && v.created_at && new Date(v.created_at) > new Date(turnoInicio)
  );
  // Gastos operativos del turno = sus compras de créditos aprobadas en el
  // turno (si no compró, no hay gastos).
  const gastosDelTurno = misCompras
    .filter((p) => p.estado === ESTADO_RECARGA_APROBADO && new Date(p.resuelto_at || p.created_at) > new Date(turnoInicio))
    .map((p) => ({
      id: p.id,
      concepto: `Compra de créditos · ${p.paquete_nombre || "paquete"}`,
      monto: p.monto,
      metodo_pago: p.metodo_pago,
      created_at: p.resuelto_at || p.created_at,
    }));
  const totalGastosDelTurno = gastosDelTurno.reduce((sum, g) => sum + Number(g.monto || 0), 0);
  const totalTurno = ventasDelTurno.reduce((sum, v) => sum + Number(v.monto || 0), 0);
  // Copia FRESCA de la sesión (usuario del contexto puede haber
  // quedado desactualizado desde el login) — mismo criterio que
  // ConductorPage con useConductorSesion.
  const miPerfil = usuarios.find((u) => u.id === usuario?.id) ?? usuario;
  // Verificación: la fila de la base (se actualiza sola) antes que la sesión.
  const estadoVerificacion = miPerfil?.estado_verificacion ?? usuario?.estado_verificacion;
  const diasMembresiaRestantes = miPerfil?.membresia_vencimiento
    ? Math.ceil((new Date(miPerfil.membresia_vencimiento) - new Date()) / 86400000)
    : null;

  const loading = ventasLoading || conductoresLoading;

  return (
    <div className="tz-root">
      <Styles />
      {mostrarBienvenida && (
        <AnimacionNeonBienvenida
          eyebrow="✦ Bienvenido a TaxiPE ✦"
          titulo={usuario?.nombre || "Recolector"}
          descripcion="Que tengas una excelente jornada — ¡vamos con todo! 💪"
          onTerminar={marcarBienvenidaVista}
        />
      )}
      <header className="tz-header">
        <div className="tz-header-row">
          <div className="tz-header-side tz-header-side-left">
            <button className="tz-header-btn" onClick={() => setRegistroOpen(true)} aria-label="Registrar conductor">
              <UserPlus size={19} />
              <span className="tz-header-btn-label">Conductor nuevo</span>
            </button>
          </div>

          <div className="tz-header-center">
            <img src={logo} alt="TaxiP" className="tz-logo" />
            <div className="tz-subtitle-slot">
              <TextoMaquina
                mensajes={[usuario?.nombre ? `Recolector · ${usuario.nombre}` : "Recolector", ...descripcionesRecolector]}
                className="tz-subtitle-usuario"
              />
            </div>
          </div>

          <div className="tz-header-side tz-header-side-right">
            <BotonSoporte />
            <button className="tz-header-btn" onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión">
              <LogOut size={19} />
              <span className="tz-header-btn-label">Salir</span>
            </button>
            {usuario && <BotonMensajes usuarioId={usuario.id} />}
          </div>
        </div>
      </header>

      <main className="tz-main">
        {loading ? (
          <div className="tz-loading" style={{ minHeight: "40vh" }}>
            <Loader2 className="tz-spin" size={28} />
            <p>Cargando…</p>
          </div>
        ) : (
          <>
            {estadoVerificacion === ESTADO_VERIFICACION_TEMPORAL && (
              <div className="tz-cuenta-temporal">
                <p>
                  Tu cuenta es temporal: verifícala dentro de los 7 días desde tu registro o se eliminará. Podrás
                  registrar recargas cuando el Admin la apruebe.
                </p>
                <button type="button" className="tz-scan-btn tz-payment-save" onClick={() => setVerificandoCuenta(true)}>
                  Verificar mi cuenta
                </button>
              </div>
            )}
            {estadoVerificacion === ESTADO_VERIFICACION_EN_REVISION && (
              <div className="tz-cuenta-temporal">
                <p>Tu verificación está en revisión del Admin. Podrás registrar recargas cuando la apruebe.</p>
              </div>
            )}
            <section className="tz-stats" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginBottom: 20 }}>
              <div className="tz-stat-chip tz-stat-chip-green" style={{ textAlign: "center", padding: "22px" }}>
                <span className="tz-stat-label" style={{ justifyContent: "center" }}>
                  <Wallet size={14} /> Total Recaudado Hoy
                </span>
                <span className="tz-stat-value tz-green" style={{ fontSize: 34 }}>
                  {formatSoles(totalTurno)}
                </span>
                <span className="tz-stat-sub">
                  {ventasDelTurno.length} recarga{ventasDelTurno.length === 1 ? "" : "s"} en tu turno
                </span>
              </div>
              <div className="tz-stat-chip" style={{ textAlign: "center", padding: "22px" }}>
                <span className="tz-stat-label" style={{ justifyContent: "center" }}>
                  <CreditCard size={14} /> Mi Saldo
                </span>
                <span className="tz-stat-value tz-cyan" style={{ fontSize: 34 }}>
                  {miPerfil?.creditos_disponibles ?? 0}
                </span>
                <span className="tz-stat-sub">
                  {miPerfil?.membresia_vencimiento ? (
                    <>
                      <CalendarClock size={11} style={{ verticalAlign: "-1px" }} /> Membresía vence{" "}
                      {formatDate(miPerfil.membresia_vencimiento)}
                      {diasMembresiaRestantes != null && diasMembresiaRestantes < 0 ? " (vencida)" : ""}
                    </>
                  ) : (
                    "Sin membresía activa"
                  )}
                </span>
              </div>
            </section>

            {registroMsg && <p className="tz-success">{registroMsg}</p>}

            <RecargaRapidaForm
              conductores={conductores}
              categorias={categorias}
              subgrupos={subgrupos}
              saldoRecolector={miPerfil}
              registrarRecarga={registrarRecarga}
              crearConductorConUsuario={crearConductorConUsuario}
              saving={saving}
              error={error}
              paquetes={paquetes}
              glowPaquetes={glowPaquetes}
              onVentaRegistrada={({ venta, destinatario, montoRecibido }) =>
                setVentaPanel(
                  ventaParaPanel(venta, destinatario, { cajero: usuario?.nombre || "Recolector", montoRecibido })
                )
              }
            />
          </>
        )}
      </main>

      <footer className="tz-page-footer">
        <button className={`tz-footer-btn tz-footer-btn-cierre ${turnoVencido ? "tz-btn-aviso" : ""}`} onClick={() => setCierreOpen(true)}>
          <Receipt size={18} />
          Cerrar Caja
        </button>
        <button className="tz-footer-btn tz-footer-btn-misventas" onClick={() => setHistorialOpen(true)}>
          <Receipt size={18} />
          Historial de Ventas
        </button>
        <button className="tz-footer-btn tz-footer-btn-stock" onClick={() => setAutorecargaOpen(true)}>
          <Wallet size={18} />
          Recargar
        </button>
      </footer>

      {autorecargaOpen && miPerfil && (
        <AutorecargaRecolectorModal
          recolector={miPerfil}
          paquetes={paquetesRecolectores}
          glowPaquetes={glowPaquetesRecolectores}
          crearPeticion={crearAutorecarga}
          onClose={() => {
            setAutorecargaOpen(false);
            refreshUsuarios();
          }}
        />
      )}

      {registroOpen && (
        <RegistroConductorModal
          categorias={categorias}
          subgrupos={subgrupos}
          crearConductorConUsuario={crearConductorConUsuario}
          requiereLogin
          aprobado={false}
          onClose={() => setRegistroOpen(false)}
          onCreated={(nombre) => {
            setRegistroMsg(`${nombre} fue registrado y ya aparece en el buscador.`);
            setTimeout(() => setRegistroMsg(""), 4000);
          }}
        />
      )}

      {verificandoCuenta && (
        <div className="tz-modal-backdrop">
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button className="tz-modal-close" onClick={() => setVerificandoCuenta(false)} aria-label="Cerrar">
              <X size={18} />
            </button>
            <VerificarRecolectorForm
              usuario={usuario}
              onVerificado={(actualizado) => {
                updateUsuario(actualizado);
                setVerificandoCuenta(false);
              }}
            />
          </div>
        </div>
      )}

      {cierreVisible && (
        <CierreCajaModal
          ventasHoy={ventasDelTurno}
          gastosHoy={gastosDelTurno}
          totalGastosHoy={totalGastosDelTurno}
          cierres={cierres}
          crearCierre={crearCierre}
          esAdmin={false}
          cajeroNombre={usuario?.nombre || "Recolector"}
          onClose={() => setCierreOpen(false)}
          onCerrado={refreshTurno}
          vencido={turnoVencido}
          extensiones={turnoExtensiones}
          maxExtensiones={turnoMaxExtensiones}
          obligatorio={turnoObligatorio}
          onExtender={extenderTurno}
          telefonoDestino={usuario?.telefono}
          conductores={conductores}
          usuarios={usuarios}
        />
      )}
      <PanelVentaRegistrada venta={ventaPanel} onCerrar={() => setVentaPanel(null)} />

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
      {anuncio && <AnuncioPopupModal anuncio={anuncio} onClose={cerrarAnuncio} canalChat="taxipe" />}
    </div>
  );
}
