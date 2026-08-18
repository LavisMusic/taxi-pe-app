import { TrendingUp, CreditCard, IdCard } from "lucide-react";
import { formatSoles } from "../../utils/format";
import { COSTO_OPERATIVO_DIARIO } from "../../lib/taxiEnums";

// Métricas superiores del dashboard — mismos chips (.tz-stat-chip) que
// usaba la caja registradora vieja, con las 4 métricas nuevas del
// roadmap de TaxiP. Sin <section> propia: el padre (AdminDashboardPage)
// pone un único .tz-stats (CSS grid) que envuelve esto + UsuarioEstrellaChip,
// para no anidar dos grids una dentro de otra.
export default function StatsSection({ metrics }) {
  const { recaudadoHoy, gananciaNetaHoy, membresiasActivas, creditosVendidosHoy } = metrics;

  return (
    <>
      <div className="tz-stat-chip">
        <span className="tz-stat-label">Recaudado hoy</span>
        <span className="tz-stat-value tz-pink">{formatSoles(recaudadoHoy)}</span>
      </div>

      <div className="tz-stat-chip tz-stat-chip-green">
        <span className="tz-stat-label">
          <TrendingUp size={13} /> Ganancia Neta (hoy)
        </span>
        <span className="tz-stat-value tz-green">{formatSoles(gananciaNetaHoy)}</span>
        <span className="tz-stat-sub">− {formatSoles(COSTO_OPERATIVO_DIARIO)} costo operativo</span>
      </div>

      <div className="tz-stat-chip">
        <span className="tz-stat-label">
          <IdCard size={13} /> Membresías Activas
        </span>
        <span className="tz-stat-value tz-cyan">{membresiasActivas}</span>
      </div>

      <div className="tz-stat-chip">
        <span className="tz-stat-label">
          <CreditCard size={13} /> Créditos Vendidos (hoy)
        </span>
        <span className="tz-stat-value tz-yellow">{formatSoles(creditosVendidosHoy)}</span>
      </div>
    </>
  );
}
