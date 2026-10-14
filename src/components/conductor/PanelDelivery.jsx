import { Bike, Ban, Car, Loader2, Package, Wallet } from "lucide-react";
import EntregasRepartidorPanel from "../repartidor/EntregasRepartidorPanel";
import { MAX_REPARTOS } from "../../hooks/useEntregasRepartidor";
import { formatSoles } from "../../utils/format";

// Panel de repartidor del conductor: arriba los dos medidores principales
// del día (los demás, en "Estadísticas" del pie de página), al centro el
// switch del modo delivery (solo con membresía vigente: con créditos solo
// se hacen viajes) y debajo las solicitudes de reparto. El modo delivery
// sigue encendido aunque vuelva al panel de Viajes, y mientras lo esté
// comparte su ubicación con los negocios de Caja Tonazo.
//
// Estados del switch: apagado · activo · repartiendo n/5 (bloqueado: no
// se apaga con pedidos pendientes) · en carrera (sigue visible para los
// negocios, pero no recibe repartos hasta terminar el viaje).
const MENSAJE_VACIO = "Aquí saldrán tus solicitudes de reparto";

export default function PanelDelivery({
  conductor,
  estadisticas,
  tieneMembresia,
  repartos,
  enCarrera,
  cambiando,
  error,
  onToggle,
  onEntregado,
  onVerPedido,
}) {
  const encendido = !!conductor.modo_delivery;
  const activos = repartos?.entregasActivas?.length ?? 0;
  const repartiendo = activos > 0;
  const bloqueadoPor = !conductor.aprobado
    ? "Tu cuenta debe estar aprobada para hacer repartos"
    : !tieneMembresia
      ? "El modo delivery requiere una membresía vigente (con créditos solo puedes hacer viajes)"
      : "";
  const sinPermiso = !!bloqueadoPor && !encendido && !repartiendo;
  const hoy = estadisticas?.hoy;

  const estado = sinPermiso
    ? "bloqueado"
    : repartiendo
      ? "repartiendo"
      : encendido && enCarrera
        ? "carrera"
        : encendido
          ? "activo"
          : "apagado";
  const etiqueta = {
    bloqueado: "DELIVERY APAGADO",
    apagado: "DELIVERY APAGADO",
    activo: "DELIVERY ACTIVO",
    repartiendo: `REPARTIENDO ${activos}/${MAX_REPARTOS}`,
    carrera: "EN CARRERA",
  }[estado];
  const pista = {
    bloqueado: bloqueadoPor,
    apagado: "Toca para que los negocios te vean",
    activo: "Los negocios pueden verte",
    repartiendo:
      activos >= MAX_REPARTOS ? "Entrega alguno para recibir más pedidos" : "Puedes aceptar más pedidos · entrégalos para apagar",
    carrera: "No recibes repartos hasta terminar el viaje",
  }[estado];

  return (
    <>
      <section className="tz-stats tz-stats-centrados" style={{ gridTemplateColumns: "repeat(2, 1fr)", marginBottom: 4 }}>
        <div className="tz-stat-chip">
          <span className="tz-stat-label">
            <Package size={13} /> Repartos hoy
          </span>
          <span className="tz-stat-value tz-cyan">{hoy ? hoy.entregas : "—"}</span>
        </div>
        <div className="tz-stat-chip tz-stat-chip-green">
          <span className="tz-stat-label">
            <Wallet size={13} /> Ganado hoy
          </span>
          <span className="tz-stat-value tz-green">{hoy ? formatSoles(hoy.ganado_envios) : "—"}</span>
        </div>
      </section>

      <button
        type="button"
        className={`tz-estado-toggle tz-delivery-toggle tz-delivery-${estado} ${estado === "activo" ? "is-on" : ""} ${
          sinPermiso ? "tz-estado-toggle-bloqueado" : ""
        }`}
        onClick={onToggle}
        disabled={cambiando || sinPermiso || repartiendo}
        aria-pressed={encendido}
        aria-label={etiqueta}
        title={sinPermiso ? bloqueadoPor : undefined}
      >
        {cambiando ? (
          <Loader2 size={40} className="tz-spin" />
        ) : sinPermiso ? (
          <Ban size={44} color="var(--danger)" />
        ) : estado === "carrera" ? (
          <Car size={44} color="var(--orange)" />
        ) : (
          <Bike size={44} color={repartiendo ? "var(--cyan)" : encendido ? "var(--green)" : "var(--text-dim)"} />
        )}
        <span className="tz-estado-toggle-label">{etiqueta}</span>
        <span className="tz-estado-toggle-hint">{pista}</span>
      </button>
      {error && <p className="tz-error" style={{ textAlign: "center" }}>{error}</p>}

      {conductor.aprobado && (encendido || repartiendo) ? (
        <EntregasRepartidorPanel
          conductorId={conductor.id}
          datos={repartos}
          enCarrera={enCarrera}
          onEntregado={onEntregado}
          onVerPedido={onVerPedido}
          mensajeVacio={enCarrera ? "Estás en carrera: las solicitudes de reparto vuelven al terminar el viaje" : MENSAJE_VACIO}
        />
      ) : (
        <p className="tz-reparto-vacio">{MENSAJE_VACIO}</p>
      )}
    </>
  );
}
