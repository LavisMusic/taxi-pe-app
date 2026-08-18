import { useState } from "react";
import { Wallet, Plus, Save, Trash2, X, Loader2, Download } from "lucide-react";
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
// quedan solo los otros 2.
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
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Wallet size={17} /> Gastos Operativos
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
            <div className="tz-add-entry">
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

          <div className="tz-export-buttons" style={{ marginTop: 10 }}>
            <button type="button" className="tz-csv-btn" onClick={descargarHistorialGastosXLSX}>
              <Download size={13} /> Descargar Historial Gastos
            </button>
            <button type="button" className="tz-csv-btn" onClick={descargarHistorialVentasXLSX}>
              <Download size={13} /> Descargar Historial Ventas
            </button>
          </div>

          {gastos.length === 0 ? (
            <p className="tz-method-history-empty">No hay gastos registrados todavía.</p>
          ) : (
            <div className="tz-method-history">
              <span className="tz-method-history-label">Historial</span>
              <ul className="tz-mov-list">
                {gastos.map((g) => (
                  <li key={g.id} className="tz-mov-row tz-mov-deuda">
                    <span className="tz-mov-row-desc">
                      {g.concepto}
                      <span className="tz-mov-row-date">{formatDate(g.created_at)}</span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <strong>{formatSoles(g.monto)}</strong>
                      <button
                        type="button"
                        className="tz-vis-reject-btn"
                        style={{ width: 26, height: 26 }}
                        disabled={borrandoId === g.id}
                        onClick={() => handleEliminar(g.id)}
                        aria-label="Eliminar gasto"
                        title="Eliminar"
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
