import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Store, X } from "lucide-react";
import { supabase } from "../../supabaseClient";

// Contrato negocio–repartidor (migración 20261107100000): invitaciones de
// negocios de Caja Tonazo para ser su repartidor y la lista de negocios
// con los que ya trabaja. Va en el panel de Delivery del conductor,
// esté prendido o no el modo delivery.
const SIETE_DIAS = 7 * 86400000;

export default function ContratosReparto({ conductorId }) {
  const [contratos, setContratos] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [confirmarFin, setConfirmarFin] = useState(null);

  const cargar = useCallback(async () => {
    if (!conductorId) return;
    const { data } = await supabase
      .from("taxi_contratos_reparto")
      .select("id, negocio_nombre, negocio_logo, estado, created_at")
      .eq("conductor_id", conductorId)
      .in("estado", ["pendiente", "activo"])
      .order("created_at", { ascending: false });
    setContratos(
      (data || []).filter((c) => c.estado === "activo" || Date.now() - new Date(c.created_at).getTime() < SIETE_DIAS)
    );
  }, [conductorId]);

  useEffect(() => {
    cargar();
    if (!conductorId) return undefined;
    const ch = supabase
      .channel(`contratos-${conductorId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "taxi_contratos_reparto", filter: `conductor_id=eq.${conductorId}` },
        cargar
      )
      .subscribe();
    const sondeo = setInterval(() => document.visibilityState === "visible" && cargar(), 30000);
    const alVolver = () => document.visibilityState === "visible" && cargar();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(sondeo);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [conductorId, cargar]);

  const responder = async (id, aceptar) => {
    setBusyId(id);
    setError("");
    const { error: e } = await supabase.rpc("taxi_responder_contrato", { p_id: id, p_aceptar: aceptar });
    setBusyId(null);
    if (e) setError(e.message || "No se pudo responder la invitación.");
    cargar();
  };

  const terminar = async (id) => {
    setBusyId(id);
    setError("");
    const { error: e } = await supabase.rpc("taxi_terminar_contrato", { p_id: id });
    setBusyId(null);
    setConfirmarFin(null);
    if (e) setError(e.message || "No se pudo terminar.");
    cargar();
  };

  const pendientes = contratos.filter((c) => c.estado === "pendiente");
  const activos = contratos.filter((c) => c.estado === "activo");
  if (contratos.length === 0 && !error) return null;

  return (
    <div className="tz-contratos">
      {pendientes.map((c) => (
        <div key={c.id} className="tz-contrato-invitacion">
          <div className="tz-contrato-cab">
            <span className="tz-contrato-logo">
              {c.negocio_logo ? <img src={c.negocio_logo} alt="" /> : <Store size={18} />}
            </span>
            <div>
              <p className="tz-contrato-nombre">{c.negocio_nombre || "Un negocio"}</p>
              <p className="tz-contrato-sub">Te invita a ser su repartidor</p>
            </div>
          </div>
          <p className="tz-contrato-texto">Verás sus pedidos primero. Te paga el envío al recoger cada pedido.</p>
          <div className="tz-contrato-acciones">
            <button type="button" className="tz-contrato-btn" disabled={busyId === c.id} onClick={() => responder(c.id, false)}>
              <X size={14} /> Rechazar
            </button>
            <button
              type="button"
              className="tz-contrato-btn tz-contrato-btn-si"
              disabled={busyId === c.id}
              onClick={() => responder(c.id, true)}
            >
              {busyId === c.id ? <Loader2 size={14} className="tz-spin" /> : <Check size={14} />} Aceptar
            </button>
          </div>
        </div>
      ))}

      {activos.length > 0 && (
        <div className="tz-contratos-mios">
          <p className="tz-contratos-titulo">Repartes para</p>
          <div className="tz-contratos-chips">
            {activos.map((c) =>
              confirmarFin === c.id ? (
                <span key={c.id} className="tz-contrato-chip tz-contrato-chip-confirmar">
                  ¿Dejar de repartir para {c.negocio_nombre}?
                  <button type="button" onClick={() => terminar(c.id)} disabled={busyId === c.id}>
                    Sí
                  </button>
                  <button type="button" onClick={() => setConfirmarFin(null)}>
                    No
                  </button>
                </span>
              ) : (
                <span key={c.id} className="tz-contrato-chip">
                  {c.negocio_logo ? <img src={c.negocio_logo} alt="" /> : <Store size={13} />}
                  {c.negocio_nombre}
                  <button type="button" aria-label={`Terminar con ${c.negocio_nombre}`} onClick={() => setConfirmarFin(c.id)}>
                    <X size={12} />
                  </button>
                </span>
              )
            )}
          </div>
        </div>
      )}
      {error && <p className="tz-error">{error}</p>}
    </div>
  );
}
