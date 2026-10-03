import { useState } from "react";
import { TrendingDown, Plus, Save, Trash2, X, Loader2, Download, ChevronDown, ChevronUp } from "lucide-react";
import { formatSoles, formatDate, formatTime } from "../../utils/format";
import { downloadXLSX } from "../../lib/xlsxExport";
import { TIPO_ITEM_MEMBRESIA } from "../../lib/taxiEnums";

// Libreta de Gastos Operativos: reemplaza al modal de "Gastos" viejo,
// sin nada de abastecer stock — solo concepto + monto, una salida de
// dinero del negocio (servidores, etc.). Los 2 botones de exportar
// (Gastos/Ventas) son el equivalente reducido del set de 3 que tenía
// este modal en la caja registradora vieja (Historial de Gastos /
// Reporte de Precios / Historial de Ventas) — "Reporte de Precios" no
// tiene sentido acá (TaxiP no vende productos con stock), así que
// quedan solo los otros 2. Mismo diseño que el gestor de Gastos de las
// cajas de Caja Tonazo: medidores, "Registrar gasto" e historial en filas
// desplegables (con Eliminar adentro).
export default function GastosOperativosModal({
  gastos,
  totalGastosHoy,
  agregarGasto,
  eliminarGasto,
  ventas = [],
  conductores = [],
  usuarios = [],
  onClose,
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [saving, setSaving] = useState(false);
  const [borrandoId, setBorrandoId] = useState(null);
  const [abiertoId, setAbiertoId] = useState(null);
  const [error, setError] = useState("");

  const resetForm = () => {
    setAddOpen(false);
    setConcepto("");
    setMonto("");
    setError("");
  };

  const handleGuardar = async () => {
    const montoNum = Number(monto);
    if (!concepto.trim()) {
      setError("Ingresa el concepto del gasto.");
      return;
    }
    if (!montoNum || montoNum <= 0) {
      setError("Ingresa un monto válido.");
      return;
    }
    setSaving(true);
    setError("");
    const { error: saveError } = await agregarGasto({ concepto: concepto.trim(), monto: montoNum });
    setSaving(false);
    if (saveError) {
      setError("No se pudo registrar el gasto.");
      return;
    }
    resetForm();
  };

  const handleEliminar = async (id) => {
    setBorrandoId(id);
    await eliminarGasto(id);
    setBorrandoId(null);
  };

  const descargarHistorialGastosXLSX = () => {
    const headers = ["Fecha", "Hora", "Concepto", "Monto (S/)"];
    const filas = [
      headers,
      ...gastos.map((g) => [formatDate(g.created_at), formatTime(g.created_at), g.concepto, Number(g.monto).toFixed(2)]),
    ];
    downloadXLSX(`historial-gastos-${Date.now()}.xlsx`, [{ nombre: "Gastos", filas }]);
  };

  const descargarHistorialVentasXLSX = () => {
    const conductoresById = new Map(conductores.map((c) => [c.id, c]));
    const usuariosById = new Map(usuarios.map((u) => [u.id, u]));
    const headers = ["ID Compra", "Producto/Membresía", "Detalle", "Precio (S/)", "Método Pago", "Vendedor", "Hora", "Fecha"];
    const filas = [
      headers,
      ...ventas.map((v) => [
        v.codigo_venta,
        v.tipo_item === TIPO_ITEM_MEMBRESIA ? "Membresía" : "Créditos",
        v.detalle || "",
        Number(v.monto).toFixed(2),
        v.metodo_pago,
        usuariosById.get(v.recolector_id)?.nombre ?? conductoresById.get(v.conductor_id)?.nombre ?? "—",
        formatTime(v.created_at),
        formatDate(v.created_at),
      ]),
    ];
    downloadXLSX(`historial-ventas-${Date.now()}.xlsx`, [{ nombre: "Ventas", filas }]);
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <TrendingDown size={17} /> Gastos
          </h2>
          <p className="tz-stock-editor-sub">
            Salidas de dinero del negocio (servidores, etc.) — no es inventario ni stock.
          </p>

          <div className="tz-method-totals">
            <div className="tz-method-total">
              <span>Gastado hoy</span>
              <strong className="tz-pink">{formatSoles(totalGastosHoy)}</strong>
            </div>
            <div className="tz-method-total">
              <span>Registros</span>
              <strong>{gastos.length}</strong>
            </div>
          </div>

          {!addOpen ? (
            <button className="tz-scan-btn tz-add-entry-toggle" onClick={() => setAddOpen(true)}>
              <Plus size={16} /> Registrar gasto
            </button>
          ) : (
            <div className="tz-add-entry tz-gasto-form">
              <label className="tz-field-label">Concepto</label>
              <input
                type="text"
                className="tz-text-input"
                placeholder="Ej. Servidor / hosting"
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
              />
              <label className="tz-field-label">Monto (S/)</label>
              <input
                type="number"
                inputMode="decimal"
                className="tz-text-input"
                placeholder="0.00"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
              />
              {error && <p className="tz-error">{error}</p>}
              <div className="tz-add-entry-actions">
                <button className="tz-camera-cancel" onClick={resetForm}>
                  Cancelar
                </button>
                <button className="tz-pw-submit tz-payment-save" onClick={handleGuardar} disabled={saving}>
                  {saving ? <Loader2 size={16} className="tz-spin" /> : <Save size={16} />}
                  Guardar
                </button>
              </div>
            </div>
          )}

          {gastos.length === 0 ? (
            <p className="tz-method-history-empty">No hay gastos registrados todavía.</p>
          ) : (
            <div className="tz-method-history">
              <span className="tz-method-history-label">Historial de gastos</span>
              <div className="tz-export-buttons">
                <button type="button" className="tz-csv-btn" onClick={descargarHistorialGastosXLSX}>
                  <Download size={13} /> Historial de Gastos
                </button>
                <button type="button" className="tz-csv-btn" onClick={descargarHistorialVentasXLSX}>
                  <Download size={13} /> Historial de Ventas
                </button>
              </div>
              <ul className="tz-history-rows">
                {gastos.map((g) => {
                  const abierto = abiertoId === g.id;
                  return (
                    <li key={g.id} className="tz-history-row">
                      <button className="tz-history-row-head" onClick={() => setAbiertoId(abierto ? null : g.id)}>
                        <span className="tz-history-row-method">{g.concepto}</span>
                        <span className="tz-history-row-amount tz-cliente-debe">{formatSoles(g.monto)}</span>
                        {abierto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                      {abierto && (
                        <div className="tz-history-row-detail">
                          <span>
                            <strong>Fecha:</strong> {formatDate(g.created_at)} · {formatTime(g.created_at)}
                          </span>
                          <span>
                            <strong>Concepto:</strong> {g.concepto}
                          </span>
                          <button
                            type="button"
                            className="tz-cliente-action-btn tz-cliente-action-deuda"
                            style={{ alignSelf: "flex-start", marginTop: 4 }}
                            disabled={borrandoId === g.id}
                            onClick={() => handleEliminar(g.id)}
                          >
                            {borrandoId === g.id ? <Loader2 size={13} className="tz-spin" /> : <Trash2 size={13} />} Eliminar gasto
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
