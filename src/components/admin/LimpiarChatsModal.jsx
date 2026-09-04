import { useState } from "react";
import { Trash2, X, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import { supabase } from "../../supabaseClient";

// Limpieza manual de caché de chats — borra TODA la tabla `chat_mensajes`
// de un saque: mensajes, ofertas, tarjetas de viaje (sistema_viaje) y
// checks de lectura de CUALQUIER conductor/pasajero, sin excepción. No
// hay una tabla `viajes` separada en este esquema (ver notas de rondas
// anteriores) — "el viaje" ES esta tabla, así que esto también apaga de
// raíz cualquier negociación o viaje en curso en el momento de borrar
// (su `estado_oferta` deja de existir, no queda ningún rastro para que
// el chat de ninguno de los dos lados lo siga mostrando). Doble
// confirmación a propósito, aunque el pedido fuera "un solo click" —
// es DEMASIADO destructivo (afecta a todos los usuarios a la vez, sin
// deshacer posible) para no pedir una segunda pasada explícita.
export default function LimpiarChatsModal({ onClose }) {
  const [confirmando, setConfirmando] = useState(false);
  const [limpiando, setLimpiando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState("");

  const ejecutarLimpieza = async () => {
    setLimpiando(true);
    setError("");
    setProgreso(0);
    setListo(false);

    // Barra de carga: DELETE sin filtro es una sola operación atómica
    // en Supabase — no hay eventos de progreso reales que escuchar (no
    // es una subida de archivo por partes). Esta animación es honesta
    // sobre eso: sube rápido hasta 90% mientras la operación está en
    // vuelo y solo salta a 100% cuando la base confirmó que terminó de
    // verdad — nunca "miente" llegando a 100% antes de tiempo.
    const avance = setInterval(() => {
      setProgreso((p) => (p < 90 ? p + Math.max(1, (90 - p) / 8) : p));
    }, 120);

    // `.not("id", "is", null)` — Supabase-js no exige un filtro para
    // `.delete()`, pero se deja explícito a propósito: dice, a simple
    // vista leyendo el código, "esto es un borrado TOTAL a mano, no un
    // filtro que se rompió y quedó vacío por accidente".
    //
    // `.select("id")` acá SÍ es obligatorio (no solo prolijidad): un
    // DELETE bloqueado por RLS (falta la política, ver el SQL que se
    // entregó aparte) no tira ningún error — Supabase simplemente borra
    // 0 filas en silencio. Sin revisar cuántas filas volvieron, este
    // modal decía "Listo" aunque la tabla siguiera intacta.
    const { data: filasBorradas, error: deleteError } = await supabase
      .from("chat_mensajes")
      .delete()
      .not("id", "is", null)
      .select("id");

    clearInterval(avance);
    setLimpiando(false);
    if (deleteError) {
      setError(deleteError.message || "No se pudo limpiar los chats.");
      return;
    }
    if (!filasBorradas || filasBorradas.length === 0) {
      setError(
        "No se borró ninguna fila. O ya no había ningún chat guardado, o (más probable si sabías que sí había) falta la política RLS de DELETE en chat_mensajes."
      );
      return;
    }
    setProgreso(100);
    setListo(true);
    setConfirmando(false);
  };

  return (
    <div className="tz-modal-backdrop">
      <div className="tz-modal" onClick={(e) => e.stopPropagation()}>
        <button className="tz-modal-close" onClick={onClose} aria-label="Cerrar" disabled={limpiando}>
          <X size={18} />
        </button>
        <div className="tz-payment-modal">
          <h2>
            <Trash2 size={17} /> Limpiar Caché de Chats
          </h2>

          {listo ? (
            <p className="tz-success" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircle2 size={16} /> Listo — todos los chats quedaron vacíos.
            </p>
          ) : (
            <>
              <p className="tz-stock-editor-sub" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <AlertTriangle size={16} color="var(--danger)" style={{ flexShrink: 0, marginTop: 2 }} />
                <span>
                  Esto borra <strong>absolutamente todos</strong> los mensajes, ofertas y tarjetas de viaje de{" "}
                  <strong>todos</strong> los conductores y pasajeros — no hay una copia ni forma de deshacerlo.
                  Si hay algún viaje en curso en este instante, su negociación desaparece también. Usalo solo
                  para limpiar caché/datos de prueba, no en producción con viajes activos.
                </span>
              </p>

              {error && <p className="tz-error">{error}</p>}

              {limpiando && (
                <div className="tz-limpiar-chats-progreso-track">
                  <div className="tz-limpiar-chats-progreso-fill" style={{ width: `${progreso}%` }} />
                </div>
              )}

              {confirmando ? (
                <div className="tz-vis-confirm-delete" style={{ marginTop: 10 }}>
                  <p>
                    ¿Seguro? Se van a borrar <strong>todos</strong> los chats de <strong>todos</strong> los
                    usuarios ahora mismo.
                  </p>
                  <div className="tz-vis-confirm-actions">
                    <button
                      type="button"
                      className="tz-cliente-action-btn tz-cliente-action-deuda"
                      onClick={ejecutarLimpieza}
                      disabled={limpiando}
                    >
                      {limpiando ? <Loader2 size={13} className="tz-spin" /> : <Trash2 size={13} />}
                      Sí, borrar TODO
                    </button>
                    <button
                      type="button"
                      className="tz-cliente-action-btn"
                      onClick={() => setConfirmando(false)}
                      disabled={limpiando}
                    >
                      <X size={13} /> Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="tz-btn-solido-rojo"
                  style={{ marginTop: 10, width: "100%", justifyContent: "center" }}
                  onClick={() => setConfirmando(true)}
                >
                  <Trash2 size={16} /> Limpiar todos los chats
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
