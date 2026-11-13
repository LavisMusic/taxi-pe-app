import { useState } from "react";
import { ShieldAlert, Scale, Loader2, Send, CheckCircle2 } from "lucide-react";

// Aviso de cuenta suspendida o bloqueada por un reporte (fase 4) — MISMO
// archivo en Taxi-PE y Caja (src/components/AvisoSancion.jsx).
//   sancion: { id, accion: 'suspension' | 'bloqueo', hasta, motivo,
//              apelada_at, apelacion_resuelta_at, apelacion_respuesta }
//   rol: pasajero | conductor (Taxi PE) · cliente | negocio (Tonazo)
//   apelar(sancionId, texto) → { error? }: botón "Apelar" (fase C2), una
//   vez por sanción; lo revisa el administrador.
const TEXTOS = {
  conductor: "Por un reporte, no puedes conectarte ni tomar viajes o repartos por ahora.",
  pasajero: "Por un reporte, no puedes pedir viajes por ahora.",
  cliente: "Por un reporte, no puedes hacer pedidos online por ahora. En las tiendas puedes seguir comprando.",
  negocio: "Por un reporte, tu tienda no aparece en el Directorio por ahora. Tu caja sigue funcionando.",
};
const TEXTO_RECLAMOS =
  "Tienes dos reclamos confirmados en los últimos 90 días (pedido no entregado o dinero no rendido): no puedes conectarte ni tomar viajes o repartos hasta que el administrador lo revise.";

const fechaCorta = (f) =>
  f ? new Date(f).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;

export default function AvisoSancion({ sancion, rol, apelar = null }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [enviada, setEnviada] = useState(false);
  if (!sancion) return null;
  const hasta = fechaCorta(sancion.hasta);
  const esTonazo = rol === "cliente" || rol === "negocio";
  const titulo =
    rol === "negocio"
      ? hasta ? `Tu tienda está fuera del Directorio hasta el ${hasta}` : "Tu tienda está fuera del Directorio"
      : sancion.accion === "bloqueo" || !hasta
        ? rol === "cliente" ? "Pedidos online bloqueados" : sancion.motivo === "reclamos" ? "Cuenta suspendida" : "Cuenta bloqueada"
        : rol === "cliente" ? `Pedidos online suspendidos hasta el ${hasta}` : `Cuenta suspendida hasta el ${hasta}`;
  const apelada = enviada || !!sancion.apelada_at;
  const rechazada = !!sancion.apelacion_resuelta_at;
  const t = texto.trim();

  const enviar = async () => {
    if (t.length < 10 || enviando) return;
    setEnviando(true);
    setError("");
    const r = await apelar(sancion.id, t);
    setEnviando(false);
    if (r?.error) return setError(r.error.message || "No se pudo enviar la apelación.");
    setEnviada(true);
    setAbierto(false);
  };

  return (
    <div className="tz-aviso-sancion" role="alert">
      <style>{ESTILO}</style>
      <ShieldAlert size={22} className="tz-aviso-sancion-icono" />
      <div className="tz-aviso-sancion-cuerpo">
        <b>{titulo}</b>
        <p>
          {sancion.motivo === "reclamos" ? TEXTO_RECLAMOS : TEXTOS[rol] || TEXTOS.pasajero} Los detalles están en el chat{" "}
          {esTonazo ? "Tonazo" : "Taxi PE"}.
        </p>

        {apelar && apelada && (
          <p className={`tz-aviso-sancion-estado ${rechazada ? "is-rechazada" : ""}`}>
            {rechazada ? <Scale size={14} /> : <CheckCircle2 size={14} />}
            {rechazada
              ? `Revisamos tu apelación y la sanción sigue.${sancion.apelacion_respuesta ? ` ${sancion.apelacion_respuesta}` : ""}`
              : "Apelación enviada: la estamos revisando. Te avisaremos por el chat."}
          </p>
        )}
        {apelar && !apelada && !abierto && (
          <button type="button" className="tz-aviso-sancion-apelar" onClick={() => setAbierto(true)}>
            <Scale size={14} /> Apelar
          </button>
        )}
        {apelar && !apelada && abierto && (
          <div className="tz-aviso-sancion-form">
            <textarea
              value={texto}
              maxLength={600}
              rows={3}
              placeholder="Cuéntanos por qué crees que es un error…"
              onChange={(e) => setTexto(e.target.value)}
              disabled={enviando}
              autoFocus
            />
            <div className="tz-aviso-sancion-acciones">
              <small>{t.length < 10 ? "Al menos 10 letras" : `${texto.length}/600`}</small>
              <button type="button" className="tz-aviso-sancion-cancelar" onClick={() => setAbierto(false)} disabled={enviando}>
                Cancelar
              </button>
              <button type="button" className="tz-aviso-sancion-enviar" onClick={enviar} disabled={enviando || t.length < 10}>
                {enviando ? <Loader2 size={14} className="tz-spin" /> : <Send size={14} />} Enviar apelación
              </button>
            </div>
            {error && <p className="tz-aviso-sancion-error">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

const ESTILO = `
.tz-aviso-sancion { box-sizing: border-box; display: flex; gap: 11px; align-items: flex-start; width: min(560px, calc(100% - 32px)); margin: 12px auto;
  padding: 12px 14px; border-radius: 18px; color: var(--text); background: linear-gradient(120deg, rgba(255,84,112,0.16), rgba(255,149,0,0.08));
  border: 1px solid rgba(255,84,112,0.55); box-shadow: 0 0 22px rgba(255,84,112,0.25); text-align: left;
  animation: tz-aviso-sancion-in .6s cubic-bezier(.34,1.56,.64,1) both, tz-aviso-sancion-late 2.6s 1s ease-in-out infinite; }
.tz-aviso-sancion-icono { flex-shrink: 0; color: #ff5470; filter: drop-shadow(0 0 8px rgba(255,84,112,0.7)); }
.tz-aviso-sancion-cuerpo { flex: 1; min-width: 0; }
.tz-aviso-sancion b { display: block; font-size: 14.5px; color: #ff5470; }
.tz-aviso-sancion p { margin: 3px 0 0; font-size: 12.5px; line-height: 1.4; color: var(--text-dim); }
.tz-aviso-sancion-apelar { display: inline-flex; align-items: center; gap: 6px; margin-top: 9px; padding: 7px 14px; border-radius: 999px;
  cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 800; color: #fff; border: 0;
  background: linear-gradient(110deg, #ff5470, #ff9500); box-shadow: 0 0 16px rgba(255,84,112,0.45);
  transition: transform .35s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease; animation: tz-aviso-sancion-in .5s .2s cubic-bezier(.34,1.56,.64,1) both; }
.tz-aviso-sancion-apelar:hover { transform: translateY(-2px) scale(1.03); box-shadow: 0 0 24px rgba(255,84,112,0.6); }
.tz-aviso-sancion-apelar:active { transform: scale(.96); }
.tz-aviso-sancion-form { margin-top: 9px; transform-origin: top; animation: tz-aviso-sancion-abre .5s cubic-bezier(.34,1.56,.64,1) both; }
.tz-aviso-sancion-form textarea { box-sizing: border-box; width: 100%; resize: vertical; min-height: 70px; padding: 9px 11px; border-radius: 12px;
  font: inherit; font-size: 13px; color: var(--text); background: rgba(5,3,12,0.55); border: 1px solid rgba(255,84,112,0.4); outline: none;
  transition: border-color .25s ease, box-shadow .3s ease; }
.tz-aviso-sancion-form textarea:focus { border-color: #ff5470; box-shadow: 0 0 14px rgba(255,84,112,0.3); }
.tz-aviso-sancion-acciones { display: flex; align-items: center; gap: 8px; margin-top: 7px; flex-wrap: wrap; }
.tz-aviso-sancion-acciones small { flex: 1; font-size: 11px; color: var(--text-dim); }
.tz-aviso-sancion-cancelar, .tz-aviso-sancion-enviar { display: inline-flex; align-items: center; gap: 5px; padding: 7px 12px; border-radius: 999px;
  cursor: pointer; font: inherit; font-size: 12px; font-weight: 800; transition: transform .3s cubic-bezier(.34,1.56,.64,1), opacity .2s ease; }
.tz-aviso-sancion-cancelar { color: var(--text-dim); background: transparent; border: 1px solid rgba(255,255,255,0.18); }
.tz-aviso-sancion-enviar { color: #fff; border: 0; background: linear-gradient(110deg, #ff5470, #ff2f9e); box-shadow: 0 0 14px rgba(255,84,112,0.4); }
.tz-aviso-sancion-enviar:disabled { opacity: .5; cursor: default; }
.tz-aviso-sancion-enviar:hover:not(:disabled), .tz-aviso-sancion-cancelar:hover:not(:disabled) { transform: translateY(-1px); }
.tz-aviso-sancion-estado { display: flex; align-items: flex-start; gap: 6px; margin-top: 8px !important; color: #39ffb0 !important; font-weight: 700;
  animation: tz-aviso-sancion-in .5s cubic-bezier(.34,1.56,.64,1) both; }
.tz-aviso-sancion-estado svg { flex: none; margin-top: 2px; }
.tz-aviso-sancion-estado.is-rechazada { color: #ff9500 !important; }
.tz-aviso-sancion-error { color: #ff5470 !important; }
@keyframes tz-aviso-sancion-in { from { opacity: 0; transform: translateY(-10px) scale(.95); filter: blur(3px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes tz-aviso-sancion-abre { from { opacity: 0; transform: scaleY(.6); filter: blur(2px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes tz-aviso-sancion-late { 0%, 100% { box-shadow: 0 0 16px rgba(255,84,112,0.2); } 50% { box-shadow: 0 0 30px rgba(255,84,112,0.45); } }
`;
