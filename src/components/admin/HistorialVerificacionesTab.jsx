import { useEffect, useState } from "react";
import { Search, Loader2, Image as ImageIcon } from "lucide-react";
import { supabase } from "../../supabaseClient";
import { urlVisible } from "../../lib/imagenesPrivadas";
import ImagenGuardada from "../ImagenGuardada";
import { formatTelefono, formatDate } from "../../utils/format";

// Historial de verificaciones (Centro de Peticiones, Admin): cada envío de
// verificación de conductores y recolectores con sus fotos, aunque la
// cuenta ya no exista o haya reenviado varias veces — para investigar a
// alguien por DNI, teléfono o nombre. Lo llena la base
// (taxi_verificaciones_historial, migración 20261014110000).
const ETIQUETAS_FOTO = {
  general: "Toma general",
  interior: "Interior",
  conductor_dni: "Conductor + DNI",
  dni: "Con su DNI",
  perfil: "Perfil",
};

function useHistorialVerificaciones(busqueda) {
  const [filas, setFilas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelado = false;
    const t = setTimeout(async () => {
      setLoading(true);
      setError("");
      let query = supabase
        .from("taxi_verificaciones_historial")
        .select("id, rol, nombre, telefono, dni, ruc, placa, fotos, enviado_at")
        .order("enviado_at", { ascending: false })
        .limit(50);
      // Sin comas ni paréntesis: rompen el filtro `or` de PostgREST.
      const q = busqueda.trim().replace(/[,()%*]/g, " ").trim();
      if (q) query = query.or(`dni.ilike.%${q}%,telefono.ilike.%${q}%,nombre.ilike.%${q}%,placa.ilike.%${q}%`);
      const { data, error: fetchError } = await query;
      if (cancelado) return;
      if (fetchError) {
        setError("No se pudo cargar el historial.");
        setFilas([]);
      } else {
        setFilas(data ?? []);
      }
      setLoading(false);
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [busqueda]);

  return { filas, loading, error };
}

// Abre la foto en tamaño completo (enlace firmado si es privada).
// La pestaña se abre al toque (dentro del clic, para que el navegador no la
// bloquee) y recibe el enlace cuando llega.
async function abrirFoto(valor) {
  const ventana = window.open("", "_blank");
  if (ventana) ventana.opener = null;
  const url = await urlVisible(valor);
  if (!url) {
    ventana?.close();
    return;
  }
  if (ventana) ventana.location.href = url;
  else window.open(url, "_blank", "noopener");
}

export default function HistorialVerificacionesTab() {
  const [busqueda, setBusqueda] = useState("");
  const { filas, loading, error } = useHistorialVerificaciones(busqueda);

  return (
    <>
      <div className="tz-historial-verif-buscar">
        <Search size={15} />
        <input
          type="text"
          className="tz-text-input"
          placeholder="Buscar por DNI, teléfono, nombre o placa"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>
      <p className="tz-camera-note" style={{ margin: "0 0 10px" }}>
        Cada verificación enviada queda guardada con sus fotos, aunque la cuenta se haya eliminado. Toca una foto
        para verla completa.
      </p>

      {loading ? (
        <p className="tz-method-history-empty">
          <Loader2 size={14} className="tz-spin" /> Buscando…
        </p>
      ) : error ? (
        <p className="tz-error">{error}</p>
      ) : filas.length === 0 ? (
        <p className="tz-method-history-empty">
          {busqueda.trim() ? "No hay verificaciones que coincidan." : "Todavía no hay verificaciones guardadas."}
        </p>
      ) : (
        <ul className="tz-history-rows">
          {filas.map((f) => (
            <li key={f.id} className="tz-history-row">
              <div className="tz-history-row-detail" style={{ padding: 12 }}>
                <div className="tz-historial-verif-cabecera">
                  <strong style={{ color: "var(--text)" }}>{f.nombre || "Sin nombre"}</strong>
                  <span className="tz-historial-verif-rol">{f.rol === "recolector" ? "Recolector" : "Conductor"}</span>
                </div>
                <p style={{ margin: "2px 0", color: "var(--text-dim)", fontSize: 13 }}>
                  {f.dni ? `DNI ${f.dni}` : "Sin DNI"}
                  {f.telefono ? ` · ${formatTelefono(f.telefono)}` : ""}
                  {f.placa ? ` · Placa ${f.placa}` : ""}
                  {f.ruc ? ` · RUC ${f.ruc}` : ""}
                </p>
                <p style={{ margin: "0 0 6px", color: "var(--text-dim)", fontSize: 12 }}>
                  Enviada el {formatDate(f.enviado_at)} ·{" "}
                  {new Date(f.enviado_at).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })}
                </p>
                <div className="tz-peticion-fotos">
                  {Object.entries(f.fotos ?? {}).map(([clave, valor]) => (
                    <button
                      key={clave}
                      type="button"
                      className="tz-peticion-foto tz-historial-verif-foto"
                      onClick={() => abrirFoto(valor)}
                      title="Ver completa"
                    >
                      {valor ? (
                        <ImagenGuardada src={valor} alt={ETIQUETAS_FOTO[clave] ?? clave} />
                      ) : (
                        <div className="tz-peticion-foto-placeholder">
                          <ImageIcon size={18} />
                        </div>
                      )}
                      <span>{ETIQUETAS_FOTO[clave] ?? clave}</span>
                    </button>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
