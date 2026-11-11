import { ShieldAlert } from "lucide-react";

// Aviso de cuenta suspendida o bloqueada por un reporte (fase 4) — MISMO
// archivo en Taxi-PE y Caja (src/components/AvisoSancion.jsx).
//   sancion: { accion: 'suspension' | 'bloqueo', hasta }
//   rol: pasajero | conductor (Taxi PE) · cliente (Tonazo: pedidos online)
const TEXTOS = {
  conductor: "Por un reporte, no puedes conectarte ni tomar viajes o repartos por ahora.",
  pasajero: "Por un reporte, no puedes pedir viajes por ahora.",
  cliente: "Por un reporte, no puedes hacer pedidos online por ahora. En las tiendas puedes seguir comprando.",
};

export default function AvisoSancion({ sancion, rol }) {
  if (!sancion) return null;
  const hasta = sancion.hasta
    ? new Date(sancion.hasta).toLocaleString("es-PE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;
  const esCliente = rol === "cliente";
  const titulo =
    sancion.accion === "bloqueo" || !hasta
      ? esCliente ? "Pedidos online bloqueados" : "Cuenta bloqueada"
      : esCliente ? `Pedidos online suspendidos hasta el ${hasta}` : `Cuenta suspendida hasta el ${hasta}`;
  return (
    <div className="tz-aviso-sancion" role="alert">
      <style>{ESTILO}</style>
      <ShieldAlert size={22} className="tz-aviso-sancion-icono" />
      <div>
        <b>{titulo}</b>
        <p>
          {TEXTOS[rol] || TEXTOS.pasajero} Los detalles están en el chat {esCliente ? "Tonazo" : "Taxi PE"}; si crees que es
          un error, escríbenos.
        </p>
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
.tz-aviso-sancion b { display: block; font-size: 14.5px; color: #ff5470; }
.tz-aviso-sancion p { margin: 3px 0 0; font-size: 12.5px; line-height: 1.4; color: var(--text-dim); }
@keyframes tz-aviso-sancion-in { from { opacity: 0; transform: translateY(-10px) scale(.95); filter: blur(3px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes tz-aviso-sancion-late { 0%, 100% { box-shadow: 0 0 16px rgba(255,84,112,0.2); } 50% { box-shadow: 0 0 30px rgba(255,84,112,0.45); } }
`;
