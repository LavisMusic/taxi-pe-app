import { useMemo, useState } from "react";
import { History, Ban, AlertTriangle, X, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { formatSoles, formatDate, formatTime } from "../../utils/format";
import { METODOS_PAGO, TIPO_ITEM_MEMBRESIA } from "../../lib/taxiEnums";

// Historial de ventas — mismo diseño que el Historial de ventas del
// super admin de Caja Tonazo: navegación mes por mes, total cobrado del
// mes (sin anuladas), y cada venta con su código de operación
// (TX-000001…, automático), cliente/conductor, membresía o créditos,
// método, comprobante y recolector.
// Anular (con confirmación de 2 pasos) revierte el saldo — ver
// useAnularVenta; si era Fiado anula la deuda vinculada y, si no la
// encuentra (datos viejos), avisa para ajustarla a mano.
// `puedeAnular` (default true): RecolectorPage.jsx lo pasa en false —
// el recolector no puede borrar sus propias ventas.
// Filtro Todas / Registradas / Anuladas y buscador (código, nombre,
// detalle, método). Lo anulado desde el gestor ⚡ de un conductor se ve
// acá al instante (misma lista de ventas en tiempo real).
const FILTROS = [
  { id: "todas", label: "Todas" },
  { id: "registradas", label: "Registradas" },
  { id: "anuladas", label: "Anuladas" },
];
const normalizar = (t) =>
  String(t || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

export default function HistorialVentasModal({ ventas, conductores, usuarios, anular, busyId, onClose, puedeAnular = true }) {
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth());
  const [confirmandoId, setConfirmandoId] = useState(null);
  const [aviso, setAviso] = useState("");
  const [ver, setVer] = useState(null);
  const [filtro, setFiltro] = useState("todas");
  const [busqueda, setBusqueda] = useState("");

  const conductoresById = new Map(conductores.map((c) => [c.id, c]));
  const usuariosById = new Map(usuarios.map((u) => [u.id, u]));

  const delMes = useMemo(() => {
    const desde = new Date(anio, mes, 1).getTime();
    const hasta = new Date(anio, mes + 1, 1).getTime();
    return ventas
      .filter((v) => {
        const t = v.created_at ? new Date(v.created_at).getTime() : 0;
        return t >= desde && t < hasta;
      })
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [ventas, anio, mes]);
  const vigentes = delMes.filter((v) => !v.anulado);
  const anuladas = delMes.length - vigentes.length;
  const total = vigentes.reduce((s, v) => s + Number(v.monto || 0), 0);
  const visibles = delMes.filter((v) => {
    if (filtro === "registradas" && v.anulado) return false;
    if (filtro === "anuladas" && !v.anulado) return false;
    const q = normalizar(busqueda.trim());
    if (!q) return true;
    const nombre = v.cliente_id ? usuariosById.get(v.cliente_id)?.nombre : conductoresById.get(v.conductor_id)?.nombre;
    return normalizar([v.codigo_venta, nombre, v.detalle, v.metodo_pago].join(" ")).includes(q);
  });

  const mover = (delta) => {
    const d = new Date(anio, mes + delta, 1);
    setAnio(d.getFullYear());
    setMes(d.getMonth());
  };
  const esMesActual = anio === hoy.getFullYear() && mes === hoy.getMonth();
  const labelMetodo = (key) => METODOS_PAGO.find((m) => m.key === key)?.label ?? key;

  const handleAnular = async (venta) => {
    const conductor = conductoresById.get(venta.conductor_id);
    const cliente = usuariosById.get(venta.cliente_id);
    const { error, eraFiado, fiadoEncontrado } = await anular(venta, conductor, cliente);
    setConfirmandoId(null);
    if (!error && eraFiado && !fiadoEncontrado) {
      setAviso(
        `Esta venta era Fiado pero no encontramos la deuda vinculada — revisa la Libreta de Fiados de ${
          conductor?.nombre ?? "este conductor"
        } y ajústala a mano.`
      );
    }
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
        <h2>
          <History size={17} /> Historial de Ventas
        </h2>
        <div className="tz-sa-mes-nav">
          <button type="button" className="tz-vis-edit-btn" onClick={() => mover(-1)} aria-label="Mes anterior">
            <ChevronLeft size={16} />
          </button>
          <strong>
            {MESES[mes]} {anio}
          </strong>
          <button type="button" className="tz-vis-edit-btn" onClick={() => mover(1)} disabled={esMesActual} aria-label="Mes siguiente">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="tz-stat-chip tz-stat-chip-green" style={{ margin: "10px 0 14px" }}>
          <span className="tz-stat-label">Total cobrado</span>
          <span className="tz-stat-value">{formatSoles(total)}</span>
          <span className="tz-stat-sub">
            {vigentes.length} venta{vigentes.length === 1 ? "" : "s"}
            {anuladas > 0 ? ` · ${anuladas} anulada(s)` : ""}
          </span>
        </div>

        <div className="tz-historial-filtros">
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`tz-gasto-tipo-btn ${filtro === f.id ? "tz-gasto-tipo-active" : ""}`}
              onClick={() => setFiltro(f.id)}
            >
              {f.label}
              {f.id === "registradas" ? ` (${vigentes.length})` : f.id === "anuladas" ? ` (${anuladas})` : ""}
            </button>
          ))}
          <div className="tz-sa-buscador" style={{ flex: "1 1 220px", minWidth: 0 }}>
            <Search size={15} />
            <input
              className="tz-text-input"
              type="search"
              placeholder="Buscar código, nombre, detalle…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
        </div>

        {aviso && (
          <p className="tz-error" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={14} /> {aviso}
          </p>
        )}

        {visibles.length === 0 ? (
          <p className="tz-method-history-empty">
            {delMes.length === 0 ? "No hay ventas en este mes." : "Ninguna venta coincide con el filtro."}
          </p>
        ) : (
          <div className="tz-cierre-list">
            {visibles.map((v) => {
              const conductor = conductoresById.get(v.conductor_id);
              const cliente = usuariosById.get(v.cliente_id);
              const esVentaCliente = !!v.cliente_id;
              const recolector = usuariosById.get(v.recolector_id);
              const confirmando = confirmandoId === v.id;
              const esMembresia = v.tipo_item === TIPO_ITEM_MEMBRESIA;
              return (
                <div key={v.id} className={`tz-receipt tz-receipt-compact ${v.anulado ? "tz-plan-pago-anulado" : ""}`}>
                  <div className="tz-receipt-header">
                    <span className="tz-receipt-title">{v.codigo_venta || "—"}</span>
                    <span className="tz-receipt-date">
                      {v.created_at ? `${formatDate(v.created_at)} · ${formatTime(v.created_at)}` : ""} · {labelMetodo(v.metodo_pago)}
                    </span>
                  </div>
                  <div className="tz-receipt-divider" />
                  <div className="tz-receipt-row">
                    <span>
                      <strong>
                        {esVentaCliente ? (cliente?.nombre ?? "Cliente eliminado") : (conductor?.nombre ?? "Conductor eliminado")}
                      </strong>{" "}
                      · {esVentaCliente ? "Cliente" : "Conductor"}
                    </span>
                  </div>
                  <div className="tz-receipt-row">
                    <span>{v.detalle || (esMembresia ? "Membresía" : "Créditos")}</span>
                    <strong>{formatSoles(v.monto)}</strong>
                  </div>
                  <div className="tz-receipt-row tz-plan-pagos-nota">
                    <span>Recolector</span>
                    <span>{recolector?.nombre ?? "Admin"}</span>
                  </div>
                  <div className="tz-receipt-divider" />
                  <div className="tz-receipt-row tz-receipt-total">
                    <span>Total</span>
                    <strong>{formatSoles(v.monto)}</strong>
                  </div>
                  {v.voucher_url && (
                    <button type="button" className="tz-comprobante-mini" onClick={() => setVer(v)} title="Ver comprobante">
                      <img src={v.voucher_url} alt="Comprobante" loading="lazy" />
                      <span>Comprobante adjunto · tocar para ampliar</span>
                    </button>
                  )}
                  {v.anulado ? (
                    <p className="tz-tag tz-tag-danger" style={{ marginTop: 10, textAlign: "center" }}>
                      Anulada
                    </p>
                  ) : !puedeAnular ? null : confirmando ? (
                    <div className="tz-plan-pago-confirmar" style={{ marginTop: 10 }}>
                      ¿Anular? Se revierte el saldo.
                      <button
                        type="button"
                        className="tz-cliente-action-btn tz-cliente-action-deuda"
                        disabled={busyId === v.id}
                        onClick={() => handleAnular(v)}
                      >
                        <Ban size={13} /> Anular
                      </button>
                      <button type="button" className="tz-cliente-action-btn" onClick={() => setConfirmandoId(null)}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="tz-cliente-actions" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="tz-cliente-action-btn tz-cliente-action-deuda"
                        style={{ flex: 1, justifyContent: "center" }}
                        onClick={() => setConfirmandoId(v.id)}
                      >
                        <Ban size={13} /> Anular Venta
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {ver && (
        <div className="tz-modal-backdrop" style={{ zIndex: 120 }}>
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="tz-modal-close" onClick={() => setVer(null)} aria-label="Cerrar">
              <X size={18} />
            </button>
            <h2>Comprobante · {ver.codigo_venta}</h2>
            <img src={ver.voucher_url} alt="Comprobante" style={{ width: "100%", borderRadius: 12 }} />
          </div>
        </div>
      )}
    </div>
  );
}
