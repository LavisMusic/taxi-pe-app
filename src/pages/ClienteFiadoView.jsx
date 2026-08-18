import { useEffect, useRef, useState } from "react";
import { X, Loader2, Minus, Check } from "lucide-react";
import { supabase } from "../supabaseClient";
import { useAuth } from "../contexts/AuthContext";
import FiadoDetalle from "../components/FiadoDetalle";
import EnviarComprobanteModal from "../components/EnviarComprobanteModal";
import Styles from "../components/Styles";
import { formatSoles } from "../utils/format";

// Vista del propio fiado del cliente logueado. RLS garantiza que
// clientes_fiado/fiado_items/movimientos_fiado solo devuelvan las filas
// de este usuario (auth_user_id = auth.uid()), así que no hace falta
// filtrar nada extra a mano acá.
//
// Usa deliberadamente las MISMAS clases tz- (y <Styles/>) que el panel
// de Admin para que las tarjetas de deuda se vean idénticas — por eso
// el contenedor raíz lleva la clase "tz-root" (de ahí salen las
// variables CSS --text/--green/--danger/etc. que usan esas clases).
// Se neutraliza min-height/width/background inline porque acá es un
// modal, no la página completa como en /admin.
//
// El botón "Recordar" (link de WhatsApp) es exclusivo del admin: no
// existe en este árbol de componentes, así que un cliente nunca puede
// verlo, sin necesidad de ningún chequeo de rol adicional.
export default function ClienteFiadoView({ onClose }) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cliente, setCliente] = useState(null);
  const [info, setInfo] = useState({ saldo: 0, items: [], pagos: [] });
  const [envioTipo, setEnvioTipo] = useState(null); // 'restar' | 'cancelar' | null
  const [sentMsg, setSentMsg] = useState("");
  // Evita que el cliente mande un segundo comprobante mientras el
  // primero sigue sin resolver (doble clic, spam, o simplemente
  // olvidó que ya había mandado uno).
  const [tienePagoPendiente, setTienePagoPendiente] = useState(false);
  // Banner temporal cuando el admin aprueba/rechaza en tiempo real.
  const [toast, setToast] = useState(null); // { tipo: 'aprobado' | 'rechazado', mensaje } | null
  const toastTimerRef = useRef(null);

  /* ---- (re)carga fiado_items + movimientos_fiado + chequeo de pago
     pendiente/rechazado para un cliente ya conocido. Se usa tanto en la
     carga inicial como cuando llega un evento de Realtime. ---- */
  async function refreshFiado(clienteId) {
    const [
      { data: itemRows, error: itemErr },
      { data: movRows, error: movErr },
      { data: pagoRows, error: pagoErr },
    ] = await Promise.all([
      supabase.from("fiado_items").select("*").eq("cliente_id", clienteId),
      supabase.from("movimientos_fiado").select("*").eq("cliente_id", clienteId),
      // pendiente: para bloquear el envío de un nuevo comprobante.
      // rechazado: para mostrarlo en el historial (no debe desaparecer
      // sin explicación). 'aprobado' no se pide acá — esos pagos ya
      // están reflejados en movimientos_fiado, listarlos también desde
      // pagos_pendientes duplicaría la misma entrada.
      supabase
        .from("pagos_pendientes")
        .select("id, monto, tipo, estado, created_at")
        .eq("cliente_id", clienteId)
        .in("estado", ["pendiente", "rechazado"]),
    ]);

    if (itemErr || movErr) {
      setError("No se pudo cargar tu fiado. Intenta de nuevo más tarde.");
      return;
    }
    if (pagoErr) {
      console.error("Error al cargar pagos_pendientes:", pagoErr);
    }

    const items = (itemRows || [])
      .map((row) => ({
        id: row.id,
        productoNombre: row.producto_nombre,
        detalle: row.detalle || "",
        cantidad: Number(row.cantidad),
        monto: Number(row.monto),
        saldoRestante: Number(row.saldo_restante),
        timestamp: Number(row.fecha),
      }))
      .sort((a, b) => b.timestamp - a.timestamp);

    const pagos = [];
    let saldo = items.reduce((acc, it) => acc + it.saldoRestante, 0);
    (movRows || []).forEach((row) => {
      const monto = Number(row.monto);
      if (row.tipo === "DEUDA") {
        saldo += monto;
      } else {
        pagos.push({
          id: row.id,
          descripcion: row.descripcion || "",
          monto,
          fotoUrl: row.foto_url || null,
          timestamp: Number(row.fecha),
        });
      }
    });

    const pendientes = pagoRows || [];
    pendientes
      .filter((row) => row.estado === "rechazado")
      .forEach((row) => {
        pagos.push({
          id: `rechazado-${row.id}`,
          descripcion: row.tipo === "cancelar" ? "Cancelar cuenta" : "Restar crédito",
          monto: Number(row.monto),
          fotoUrl: null,
          timestamp: new Date(row.created_at).getTime(),
          rechazado: true,
        });
      });

    pagos.sort((a, b) => b.timestamp - a.timestamp);

    setInfo({ saldo, items, pagos });
    setTienePagoPendiente(pendientes.some((row) => row.estado === "pendiente"));
  }

  useEffect(() => {
    let active = true;
    if (!session?.user?.id) return undefined;

    async function load() {
      const { data: clienteRow, error: clienteErr } = await supabase
        .from("clientes_fiado")
        .select("*")
        .eq("auth_user_id", session.user.id)
        .single();

      if (!active) return;

      if (clienteErr || !clienteRow) {
        setError("No encontramos una cuenta de fiado asociada a tu usuario.");
        setLoading(false);
        return;
      }
      setCliente(clienteRow);
      await refreshFiado(clienteRow.id);
      if (active) setLoading(false);
    }

    load();
    return () => {
      active = false;
    };
  }, [session?.user?.id]);

  /* ---- Realtime: escucha UPDATE en pagos_pendientes de ESTE cliente.
     Requiere que la tabla esté agregada a la publicación
     supabase_realtime (ver supabase/migrations/0007) y que RLS deje
     leer la fila (policy de 0006) — Realtime respeta RLS. ---- */
  useEffect(() => {
    if (!cliente?.id) return undefined;

    const channel = supabase
      .channel(`pagos-pendientes-cliente-${cliente.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "pagos_pendientes",
          filter: `cliente_id=eq.${cliente.id}`,
        },
        (payload) => {
          const nuevoEstado = payload.new?.estado;
          if (nuevoEstado !== "aprobado" && nuevoEstado !== "rechazado") return;

          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setToast(
            nuevoEstado === "aprobado"
              ? {
                  tipo: "aprobado",
                  mensaje: "✅ Tu pago ha sido aprobado. Tu deuda se ha actualizado.",
                }
              : {
                  tipo: "rechazado",
                  mensaje: "❌ Tu pago fue rechazado. Por favor, acércate a caja.",
                }
          );
          toastTimerRef.current = setTimeout(() => setToast(null), 5000);

          // Limpia el bloqueo y refresca saldo/items/pagos (el saldo
          // solo cambia de verdad si fue aprobado, pero re-consultar
          // en ambos casos es barato y mantiene todo consistente).
          refreshFiado(cliente.id);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [cliente?.id]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  return (
    <div className="tz-root" style={{ minHeight: 0, width: "auto", background: "transparent" }}>
      <Styles />

      <div className="tz-modal-backdrop" onClick={onClose}>
        <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
          <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>

          {toast && (
            <div className={`tz-toast tz-toast-${toast.tipo}`}>{toast.mensaje}</div>
          )}

          {loading ? (
            <p className="tz-stock-editor-sub">
              <Loader2 className="tz-spin" size={16} /> Cargando...
            </p>
          ) : error ? (
            <p className="tz-error">{error}</p>
          ) : (
            <>
              <h2>Mi Fiado</h2>
              <p className="tz-stock-editor-sub">
                {cliente?.nombre} —{" "}
                {info.saldo > 0.009 ? (
                  <strong className="tz-cliente-debe">{formatSoles(info.saldo)} pendiente</strong>
                ) : (
                  <span className="tz-green">Estás al día</span>
                )}
              </p>

              <div className="tz-cliente-detail">
                <FiadoDetalle info={info} />

                {info.saldo > 0.009 && (
                  <>
                    {tienePagoPendiente && (
                      <p className="tz-pago-pendiente-note">
                        ⏳ Tienes un comprobante en revisión
                      </p>
                    )}
                    <div className="tz-cliente-actions">
                      <button
                        className="tz-cliente-action-btn tz-cliente-action-pago"
                        onClick={() => setEnvioTipo("restar")}
                        disabled={tienePagoPendiente}
                      >
                        <Minus size={13} /> Restar Crédito
                      </button>
                      <button
                        className="tz-cliente-action-btn tz-cliente-action-deuda"
                        onClick={() => setEnvioTipo("cancelar")}
                        disabled={tienePagoPendiente}
                      >
                        <Check size={13} /> Cancelar Cuenta
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {envioTipo && cliente && (
        <EnviarComprobanteModal
          tipo={envioTipo}
          clienteId={cliente.id}
          saldoTotal={info.saldo}
          onClose={() => setEnvioTipo(null)}
          onSubmitted={() => {
            setEnvioTipo(null);
            setTienePagoPendiente(true);
            setSentMsg("Tu comprobante fue enviado. Un administrador lo revisará pronto.");
          }}
        />
      )}

      {sentMsg && (
        <div className="tz-modal-backdrop" onClick={() => setSentMsg("")}>
          <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="tz-modal-close"
              onClick={() => setSentMsg("")}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
            <p className="tz-stock-saved">{sentMsg}</p>
          </div>
        </div>
      )}
    </div>
  );
}
