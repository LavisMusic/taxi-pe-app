import { Bike, Ban, Loader2, Package, Wallet } from "lucide-react";
import EntregasRepartidorPanel from "../repartidor/EntregasRepartidorPanel";
import { formatSoles } from "../../utils/format";

// Panel de repartidor del conductor: arriba los dos medidores principales
// del día (los demás, en "Estadísticas" del pie de página), al centro el
// switch del modo delivery (solo con membresía vigente: con créditos solo
// se hacen viajes) y debajo las solicitudes de reparto. El modo delivery
// sigue encendido aunque vuelva al panel de Viajes, y mientras lo esté
// comparte su ubicación con los negocios de Caja Tonazo.
export default function PanelDelivery({
  conductor,
  estadisticas,
  tieneMembresia,
  cambiando,
  error,
  onToggle,
  onEntregado,
}) {
  const encendido = !!conductor.modo_delivery;
  const bloqueadoPor = !conductor.aprobado
    ? "Tu cuenta debe estar aprobada para hacer repartos"
    : !tieneMembresia
      ? "El modo delivery requiere una membresía vigente (con créditos solo puedes hacer viajes)"
      : "";
  const hoy = estadisticas?.hoy;

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
        className={`tz-estado-toggle tz-delivery-toggle ${encendido ? "is-on" : ""} ${bloqueadoPor && !encendido ? "tz-estado-toggle-bloqueado" : ""}`}
        onClick={onToggle}
        disabled={cambiando || (!!bloqueadoPor && !encendido)}
        aria-pressed={encendido}
        aria-label={encendido ? "Apagar modo delivery" : "Encender modo delivery"}
        title={bloqueadoPor || undefined}
      >
        {cambiando ? (
          <Loader2 size={40} className="tz-spin" />
        ) : bloqueadoPor && !encendido ? (
          <Ban size={44} color="var(--danger)" />
        ) : (
          <Bike size={44} color={encendido ? "var(--green)" : "var(--text-dim)"} />
        )}
        <span className="tz-estado-toggle-label">{encendido ? "DELIVERY ACTIVO" : "DELIVERY APAGADO"}</span>
        <span className="tz-estado-toggle-hint">
          {bloqueadoPor && !encendido
            ? bloqueadoPor
            : encendido
              ? "Los negocios te ven para repartos · toca para apagar"
              : "Toca para recibir pedidos de reparto"}
        </span>
      </button>
      {error && <p className="tz-error" style={{ textAlign: "center" }}>{error}</p>}

      {conductor.aprobado && encendido ? (
        <EntregasRepartidorPanel conductorId={conductor.id} onEntregado={onEntregado} />
      ) : (
        <p className="tz-method-history-empty" style={{ marginTop: 14 }}>
          {encendido ? "" : "Enciende el modo delivery para ver las solicitudes de reparto."}
        </p>
      )}
    </>
  );
}
