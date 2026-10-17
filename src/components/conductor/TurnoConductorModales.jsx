import { useEffect, useState } from "react";
import { X, Receipt, Loader2, FileSpreadsheet, Trash2, BarChart3, Car, Package, Clock, ChevronDown } from "lucide-react";
import { formatSoles, formatDate, formatTime } from "../../utils/format";
import { downloadXLSX } from "../../lib/xlsxExport";
import { formatMinutos, useEstadisticasConductor } from "../../hooks/useTurnoConductor";

// Modales del pie de página del conductor: Cerrar turno, Historial de
// turnos y Estadísticas. Mismo estilo de recibo que los cierres del
// recolector (tz-receipt). Viajes y repartos van juntos en un solo turno.

function filasDetalle(detalle) {
  return [
    ["Tipo", "Fecha", "Hora", "Detalle", "Monto (S/)"],
    ...(detalle || []).map((d) => [
      d.tipo === "reparto" ? "Reparto" : "Viaje",
      formatDate(d.fecha),
      formatTime(d.fecha),
      d.detalle || "",
      Number(d.monto || 0).toFixed(2),
    ]),
  ];
}

// La meta que tenía el conductor al cerrar el turno, contra lo ganado.
function textoMeta(total, meta) {
  const m = Number(meta) || 0;
  if (!m) return "";
  return total >= m ? "Cumplida ✓" : `Faltó ${formatSoles(m - total)}`;
}

function ReciboTurno({ t, titulo, compacto = false }) {
  const total = Number(t.ganado_viajes || 0) + Number(t.ganado_envios || 0);
  return (
    <div className={`tz-receipt ${compacto ? "tz-receipt-compact" : ""}`}>
      <div className="tz-receipt-header">
        <span className="tz-receipt-title">{titulo}</span>
        <span className="tz-receipt-date">
          {formatDate(t.desde)} {formatTime(t.desde)} → {formatDate(t.hasta)} {formatTime(t.hasta)}
        </span>
      </div>
      <div className="tz-receipt-divider" />
      <div className="tz-receipt-row">
        <span>Viajes</span>
        <strong>{t.viajes ?? 0}</strong>
      </div>
      <div className="tz-receipt-row">
        <span>Ganado en viajes</span>
        <strong>{formatSoles(t.ganado_viajes)}</strong>
      </div>
      <div className="tz-receipt-row">
        <span>Repartos</span>
        <strong>{t.entregas ?? 0}</strong>
      </div>
      <div className="tz-receipt-row">
        <span>Ganado en envíos</span>
        <strong>{formatSoles(t.ganado_envios)}</strong>
      </div>
      <div className="tz-receipt-divider" />
      <div className="tz-receipt-row">
        <span>Tiempo como taxi</span>
        <strong>{formatMinutos(t.minutos_taxi)}</strong>
      </div>
      <div className="tz-receipt-row">
        <span>Tiempo en delivery</span>
        <strong>{formatMinutos(t.minutos_delivery)}</strong>
      </div>
      <div className="tz-receipt-divider" />
      <div className="tz-receipt-row tz-receipt-total">
        <span>GANADO DEL TURNO</span>
        <strong>{formatSoles(total)}</strong>
      </div>
      {Number(t.meta) > 0 && (
        <div className="tz-receipt-row">
          <span>Meta del día ({formatSoles(t.meta)})</span>
          <strong style={{ color: total >= Number(t.meta) ? "var(--green)" : "var(--orange)" }}>
            {textoMeta(total, t.meta)}
          </strong>
        </div>
      )}
    </div>
  );
}

function ListaDetalle({ detalle }) {
  if (!detalle?.length) return <p className="tz-method-history-empty">Sin viajes ni repartos en este turno.</p>;
  return (
    <ul className="tz-turno-detalle">
      {detalle.map((d, i) => (
        <li key={i}>
          {d.tipo === "reparto" ? <Package size={13} /> : <Car size={13} />}
          <span className="tz-turno-detalle-hora">{formatTime(d.fecha)}</span>
          <span className="tz-turno-detalle-texto">{d.detalle}</span>
          <strong>{formatSoles(d.monto)}</strong>
        </li>
      ))}
    </ul>
  );
}

function Marco({ titulo, icono, onClose, children }) {
  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            {icono} {titulo}
          </h2>
          {children}
        </div>
      </div>
    </div>
  );
}

export function CerrarTurnoModal({ turnoActual, cerrarTurno, onCerrado, onClose }) {
  const [turno, setTurno] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let vivo = true;
    turnoActual().then((t) => {
      if (!vivo) return;
      setTurno(t);
      setCargando(false);
    });
    return () => {
      vivo = false;
    };
  }, [turnoActual]);

  const cerrar = async () => {
    setCerrando(true);
    setError("");
    const { error: err } = await cerrarTurno();
    setCerrando(false);
    if (err) {
      setError("No se pudo cerrar el turno. Intenta de nuevo.");
      return;
    }
    setListo(true);
    onCerrado?.();
  };

  return (
    <Marco titulo="Cerrar turno" icono={<Receipt size={17} />} onClose={onClose}>
      {cargando ? (
        <p className="tz-method-history-empty">
          <Loader2 size={14} className="tz-spin" /> Calculando tu turno…
        </p>
      ) : !turno ? (
        <p className="tz-error">No se pudo cargar tu turno.</p>
      ) : listo ? (
        <p className="tz-success">✓ Turno cerrado. Quedó guardado en tu historial y el nuevo turno empieza en cero.</p>
      ) : (
        <>
          <ReciboTurno t={turno} titulo="Turno actual" />
          <div className="tz-export-buttons">
            <button
              type="button"
              className="tz-csv-btn"
              onClick={() => downloadXLSX(`turno-${Date.now()}.xlsx`, [{ nombre: "Turno", filas: filasDetalle(turno.detalle) }])}
            >
              <FileSpreadsheet size={13} /> Descargar Excel del turno
            </button>
          </div>
          <p className="tz-field-label">Detalle</p>
          <ListaDetalle detalle={turno.detalle} />
          {error && <p className="tz-error">{error}</p>}
          {confirmando ? (
            <div className="tz-add-entry-actions" style={{ marginTop: 12 }}>
              <button className="tz-camera-cancel" onClick={() => setConfirmando(false)} disabled={cerrando}>
                Cancelar
              </button>
              <button className="tz-pw-submit tz-payment-save" onClick={cerrar} disabled={cerrando}>
                {cerrando ? <Loader2 size={16} className="tz-spin" /> : <Receipt size={16} />} Sí, cerrar turno
              </button>
            </div>
          ) : (
            <button type="button" className="tz-scan-btn tz-payment-save" style={{ marginTop: 12 }} onClick={() => setConfirmando(true)}>
              <Receipt size={16} /> Cerrar turno
            </button>
          )}
        </>
      )}
    </Marco>
  );
}

export function HistorialTurnosModal({ historial, cargando, refrescar, limpiar, onClose }) {
  const [abierto, setAbierto] = useState(null);
  const [confirmarLimpiar, setConfirmarLimpiar] = useState(false);
  const [limpiando, setLimpiando] = useState(false);

  useEffect(() => {
    refrescar();
  }, [refrescar]);

  const exportarTodo = () => {
    const resumen = [
      ["Inicio", "Fin", "Viajes", "Ganado viajes (S/)", "Repartos", "Ganado envíos (S/)", "Tiempo taxi", "Tiempo delivery", "Total (S/)", "Meta del día (S/)", "Meta"],
      ...historial.map((t) => [
        `${formatDate(t.desde)} ${formatTime(t.desde)}`,
        `${formatDate(t.hasta)} ${formatTime(t.hasta)}`,
        t.viajes,
        Number(t.ganado_viajes).toFixed(2),
        t.entregas,
        Number(t.ganado_envios).toFixed(2),
        formatMinutos(t.minutos_taxi),
        formatMinutos(t.minutos_delivery),
        (Number(t.ganado_viajes) + Number(t.ganado_envios)).toFixed(2),
        Number(t.meta) > 0 ? Number(t.meta).toFixed(2) : "",
        textoMeta(Number(t.ganado_viajes) + Number(t.ganado_envios), t.meta),
      ]),
    ];
    const detalle = [["Turno", ...filasDetalle([])[0]]];
    historial.forEach((t) =>
      filasDetalle(t.detalle)
        .slice(1)
        .forEach((f) => detalle.push([`${formatDate(t.desde)} ${formatTime(t.desde)}`, ...f]))
    );
    downloadXLSX(`historial-turnos-${Date.now()}.xlsx`, [
      { nombre: "Turnos", filas: resumen },
      { nombre: "Detalle", filas: detalle },
    ]);
  };

  return (
    <Marco titulo="Historial de turnos" icono={<Receipt size={17} />} onClose={onClose}>
      <div className="tz-export-buttons">
        <button type="button" className="tz-csv-btn" onClick={exportarTodo} disabled={!historial.length}>
          <FileSpreadsheet size={13} /> Exportar historial
        </button>
        <button
          type="button"
          className="tz-csv-btn"
          onClick={() => setConfirmarLimpiar(true)}
          disabled={!historial.length || limpiando}
        >
          <Trash2 size={13} /> Limpiar historial
        </button>
      </div>
      {confirmarLimpiar && (
        <div className="tz-cuenta-temporal" style={{ marginTop: 8 }}>
          <p>Se ocultan los turnos guardados. Tus estadísticas no cambian (lo contado no se borra).</p>
          <div className="tz-add-entry-actions">
            <button className="tz-camera-cancel" onClick={() => setConfirmarLimpiar(false)} disabled={limpiando}>
              Cancelar
            </button>
            <button
              className="tz-pw-submit tz-payment-save"
              disabled={limpiando}
              onClick={async () => {
                setLimpiando(true);
                await limpiar();
                setLimpiando(false);
                setConfirmarLimpiar(false);
              }}
            >
              {limpiando ? <Loader2 size={16} className="tz-spin" /> : <Trash2 size={16} />} Limpiar
            </button>
          </div>
        </div>
      )}
      {cargando && !historial.length ? (
        <p className="tz-method-history-empty">
          <Loader2 size={14} className="tz-spin" /> Cargando…
        </p>
      ) : !historial.length ? (
        <p className="tz-method-history-empty">Todavía no cerraste ningún turno.</p>
      ) : (
        <div className="tz-cierre-list">
          {historial.map((t) => (
            <div key={t.id}>
              <ReciboTurno t={t} titulo="Turno" compacto />
              <button
                type="button"
                className="tz-turno-ver-detalle"
                onClick={() => setAbierto((a) => (a === t.id ? null : t.id))}
              >
                <ChevronDown size={13} style={{ transform: abierto === t.id ? "rotate(180deg)" : "none" }} />
                {abierto === t.id ? "Ocultar detalle" : `Ver detalle (${(t.detalle || []).length})`}
              </button>
              {abierto === t.id && <ListaDetalle detalle={t.detalle} />}
            </div>
          ))}
        </div>
      )}
    </Marco>
  );
}

const MEDIDORES = [
  { key: "viajes", label: "Viajes", icono: <Car size={13} />, formato: (v) => v ?? 0 },
  { key: "ganado_viajes", label: "Ganado en viajes", icono: <Car size={13} />, formato: (v) => formatSoles(v) },
  { key: "entregas", label: "Repartos", icono: <Package size={13} />, formato: (v) => v ?? 0 },
  { key: "ganado_envios", label: "Ganado en envíos", icono: <Package size={13} />, formato: (v) => formatSoles(v) },
  { key: "minutos_taxi", label: "Tiempo como taxi", icono: <Clock size={13} />, formato: (v) => formatMinutos(v) },
  { key: "minutos_delivery", label: "Tiempo en delivery", icono: <Clock size={13} />, formato: (v) => formatMinutos(v) },
];

export function EstadisticasModal({ conductorId, onClose }) {
  const { estadisticas } = useEstadisticasConductor(conductorId);
  return (
    <Marco titulo="Mis estadísticas" icono={<BarChart3 size={17} />} onClose={onClose}>
      {!estadisticas ? (
        <p className="tz-method-history-empty">
          <Loader2 size={14} className="tz-spin" /> Calculando…
        </p>
      ) : (
        <div className="tz-estad-grid">
          {MEDIDORES.map((m) => (
            <div key={m.key} className="tz-estad-card">
              <span className="tz-stat-label">
                {m.icono} {m.label}
              </span>
              <div className="tz-estad-periodos">
                {[
                  ["Hoy", "hoy"],
                  ["Semana", "semana"],
                  ["Mes", "mes"],
                ].map(([etq, p]) => (
                  <div key={p} className="tz-estad-periodo">
                    <span>{etq}</span>
                    <strong>{m.formato(estadisticas?.[p]?.[m.key])}</strong>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Marco>
  );
}
