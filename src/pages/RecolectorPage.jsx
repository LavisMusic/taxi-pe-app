import { useState } from "react";
import { LogOut, UserPlus, Wallet, Receipt, CreditCard, CalendarClock, Loader2 } from "lucide-react";
import { useTaxiAuth } from "../contexts/TaxiAuthContext";
import { useVentas } from "../hooks/useVentas";
import { useConductores } from "../hooks/useConductores";
import { useUsuarios } from "../hooks/useUsuarios";
import { useRecargas } from "../hooks/useRecargas";
import { usePaquetes } from "../hooks/usePaquetes";
import { usePaquetesRecolectores } from "../hooks/usePaquetesRecolectores";
import { useRecargasRecolector } from "../hooks/useRecargasRecolector";
import { useGastosOperativos } from "../hooks/useGastosOperativos";
import { useAnularVenta } from "../hooks/useAnularVenta";
import { useCierresCaja } from "../hooks/useCierresCaja";
import { formatSoles, formatDate } from "../utils/format";
import Styles from "../components/Styles";
import RecargaRapidaForm from "../components/recolector/RecargaRapidaForm";
import RegistroConductorModal from "../components/recolector/RegistroConductorModal";
import AutorecargaRecolectorModal from "../components/recolector/AutorecargaRecolectorModal";
import CierreCajaModal from "../components/admin/CierreCajaModal";
import HistorialVentasModal from "../components/admin/HistorialVentasModal";
import logo from "../assets/logo.png";

// Ruta /recolector — entra por RequireUsuarioRol rol="recolector".
// Pantalla operativa de calle: widget de turno bien visible arriba,
// Recarga Rápida como módulo principal (sin modales de por medio) y
// Registro Rápido de conductor nuevo detrás de un botón/modal aparte.
// Footer con Cerrar Caja + Historial de Ventas — mismos modales que ya
// usa el Admin, con los mismos permisos (incluye Anular en el
// Historial): el recolector es quien de verdad cierra su turno en la
// calle, tiene sentido que vea lo mismo que el Admin ve de sus ventas.
export default function RecolectorPage() {
  const { usuario, logout } = useTaxiAuth();
  const { ventas, ventasHoy, loading: ventasLoading, refresh: refreshVentas } = useVentas();
  const {
    conductores,
    categorias,
    subgrupos,
    loading: conductoresLoading,
    crearConductor,
    refresh: refreshConductores,
  } = useConductores();
  const { usuarios, refresh: refreshUsuarios } = useUsuarios();

  const { paquetes } = usePaquetes();
  const { paquetes: paquetesRecolectores } = usePaquetesRecolectores();
  const { crearPeticion: crearAutorecarga } = useRecargasRecolector();
  const { gastosHoy, totalGastosHoy } = useGastosOperativos();
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
  const [autorecargaOpen, setAutorecargaOpen] = useState(false);

  const ventasDelTurno = ventasHoy.filter((v) => v.recolector_id === usuario?.id);
  const totalTurno = ventasDelTurno.reduce((sum, v) => sum + Number(v.monto || 0), 0);
  // Copia FRESCA de la sesión (usuario del contexto puede haber
  // quedado desactualizado desde el login) — mismo criterio que
  // ConductorPage con useConductorSesion.
  const miPerfil = usuarios.find((u) => u.id === usuario?.id) ?? usuario;
  const diasMembresiaRestantes = miPerfil?.membresia_vencimiento
    ? Math.ceil((new Date(miPerfil.membresia_vencimiento) - new Date()) / 86400000)
    : null;

  const loading = ventasLoading || conductoresLoading;

  return (
    <div className="tz-root">
      <Styles />
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
            <p className="tz-subtitle">Recolector{usuario?.nombre ? ` · ${usuario.nombre}` : ""}</p>
          </div>

          <div className="tz-header-side tz-header-side-right">
            <button className="tz-header-btn" onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión">
              <LogOut size={19} />
              <span className="tz-header-btn-label">Salir</span>
            </button>
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
              recolectorId={usuario?.id}
              registrarRecarga={registrarRecarga}
              crearConductor={crearConductor}
              saving={saving}
              error={error}
              paquetes={paquetes}
            />
          </>
        )}
      </main>

      <footer className="tz-page-footer">
        <button className="tz-footer-btn tz-footer-btn-cierre" onClick={() => setCierreOpen(true)}>
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
          crearConductor={crearConductor}
          onClose={() => setRegistroOpen(false)}
          onCreated={(nombre) => {
            setRegistroMsg(`${nombre} fue registrado y ya aparece en el buscador.`);
            setTimeout(() => setRegistroMsg(""), 4000);
          }}
        />
      )}

      {cierreOpen && (
        <CierreCajaModal
          ventasHoy={ventasHoy}
          gastosHoy={gastosHoy}
          totalGastosHoy={totalGastosHoy}
          cierres={cierres}
          crearCierre={crearCierre}
          esAdmin={false}
          cajeroNombre={usuario?.nombre || "Recolector"}
          onClose={() => setCierreOpen(false)}
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
    </div>
  );
}
