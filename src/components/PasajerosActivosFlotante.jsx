import { useState } from "react";
import { Radio } from "lucide-react";
import { usePasajerosConectados } from "../hooks/usePasajerosConectados";

// Visor de "Pasajeros activos" del Conductor — pedido explícito: FUERA
// del header, flotante, pegado al lado derecho de la pantalla y
// centrado verticalmente (a diferencia del visor del Admin, que es un
// modal — acá es una pestaña angosta para no taparle la pantalla al
// conductor mientras maneja). Mismo canal de Presencia que ya usa
// HomePage.jsx/AdminDashboardPage.jsx (ver usePasajerosConectados.js) —
// solo lista a quien tiene la app REALMENTE abierta ahora mismo, no el
// roster completo de pasajeros registrados (ese es el criterio del
// visor del Admin, acá lo útil es "quién hay para conseguir carrera
// ahora").
export default function PasajerosActivosFlotante() {
  const [open, setOpen] = useState(false);
  const pasajerosConectados = usePasajerosConectados();

  return (
    <>
      <div className="tz-pasajeros-flotante-wrap">
        <button
          type="button"
          className="tz-header-btn tz-pasajeros-flotante-btn"
          onClick={() => setOpen((prev) => !prev)}
          aria-label="Pasajeros activos"
          title="Pasajeros activos"
          style={{ position: "relative" }}
        >
          <Radio size={19} />
          <span className="tz-header-btn-label">Pasajeros</span>
          {pasajerosConectados.length > 0 && (
            <span className="tz-header-btn-badge">{pasajerosConectados.length}</span>
          )}
        </button>

        {open && (
          <>
            <div className="tz-dropdown-backdrop" onClick={() => setOpen(false)} />
            <div className="tz-global-search-dropdown tz-pasajeros-flotante-panel">
              {pasajerosConectados.length === 0 ? (
                <p className="tz-method-history-empty" style={{ margin: 0, padding: "12px 14px" }}>
                  Ningún pasajero conectado ahora mismo.
                </p>
              ) : (
                pasajerosConectados.map((p) => (
                  <div
                    key={p.usuarioId}
                    className="tz-global-search-item"
                    style={{ cursor: "default", flexDirection: "row", alignItems: "center", gap: 8 }}
                  >
                    <span aria-hidden="true" className="tz-pasajero-conectado-dot tz-pasajero-conectado-dot-activo" />
                    <span className="tz-global-search-item-name" style={{ fontSize: 13 }}>
                      {p.nombreUsuario ?? "Pasajero"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
