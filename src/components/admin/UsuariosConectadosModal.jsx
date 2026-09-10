import { X, Radio } from "lucide-react";
import { usePasajerosConectados } from "../../hooks/usePasajerosConectados";
import { useConductoresConectados } from "../../hooks/useConductoresConectados";

// Una columna de la lista (Pasajeros o Conductores) — mismo punto de
// color que ya usaba el dropdown viejo (limón neón conectado / gris
// apagado), ahora repartido en dos listas dentro de UN modal en vez de
// un desplegable chico (pedido: "este botón debe abrir un nuevo modal
// que muestre dos listas"). `usuarios` es el roster COMPLETO de ese rol
// (verificados o no, pedido explícito de la ronda anterior — se sigue
// respetando acá) y `estaConectado(u)` decide el punto de color — una
// función en vez de un Set fijo porque Pasajeros cruza por id de
// usuario y Conductores por teléfono (ver useConductorPresenciaTrack.js),
// dos campos distintos según el rol.
function ListaConectados({ titulo, usuarios, estaConectado }) {
  const totalConectados = usuarios.filter(estaConectado).length;
  return (
    <div style={{ flex: "1 1 220px", minWidth: 200 }}>
      <p className="tz-field-label">
        {titulo} <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>({totalConectados} conectados)</span>
      </p>
      {usuarios.length === 0 ? (
        <p className="tz-method-history-empty" style={{ margin: 0 }}>Sin cuentas todavía.</p>
      ) : (
        <ul className="tz-history-rows" style={{ maxHeight: 360, overflowY: "auto" }}>
          {usuarios.map((u) => {
            const activo = estaConectado(u);
            return (
              <li key={u.id} className="tz-history-row">
                <div
                  className="tz-history-row-detail"
                  style={{ padding: "8px 12px", flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <span
                    aria-hidden="true"
                    className={activo ? "tz-pasajero-conectado-dot tz-pasajero-conectado-dot-activo" : "tz-pasajero-conectado-dot"}
                  />
                  <span style={{ color: "var(--text)" }}>{u.nombre_usuario ?? u.nombre ?? "Sin nombre"}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Visor de conectados del Admin — botón nuevo del header (ver
// AdminDashboardPage.jsx), reemplaza al desplegable chico de la ronda
// anterior (solo pasajeros) por este modal con DOS listas lado a lado.
export default function UsuariosConectadosModal({ usuarios, onClose }) {
  const pasajerosConectados = usePasajerosConectados();
  const { conectados: conductoresConectados } = useConductoresConectados();
  const pasajerosIds = new Set(pasajerosConectados.map((c) => c.usuarioId));
  const conductoresTelefonos = new Set(conductoresConectados.map((c) => c.telefono));
  const pasajeros = usuarios.filter((u) => u.rol === "pasajero");
  const conductores = usuarios.filter((u) => u.rol === "conductor");

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal tz-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Radio size={17} /> Usuarios Conectados
          </h2>
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
            <ListaConectados
              titulo="Pasajeros"
              usuarios={pasajeros}
              estaConectado={(u) => pasajerosIds.has(String(u.id))}
            />
            <ListaConectados
              titulo="Conductores"
              usuarios={conductores}
              estaConectado={(u) => conductoresTelefonos.has(String(u.telefono))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
