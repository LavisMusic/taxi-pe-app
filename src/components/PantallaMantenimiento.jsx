import { Wrench, Sparkles } from "lucide-react";

// Pantalla de "modo mantenimiento" — MISMO archivo en Taxi-PE y Caja
// (src/components/PantallaMantenimiento.jsx): mantener iguales. La muestra
// CompuertaMantenimiento a todos menos al panel de administración mientras
// el modo está prendido; se va sola cuando se apaga (Realtime).
export default function PantallaMantenimiento({ mensaje }) {
  return (
    <div className="tz-mantenimiento" role="alert">
      <style>{ESTILO}</style>
      <div className="tz-mant-halo" aria-hidden="true" />
      <div className="tz-mant-caja">
        <div className="tz-mant-icono" aria-hidden="true">
          <Wrench size={42} />
          <Sparkles size={18} className="tz-mant-chispa" />
        </div>
        <h1>Estamos haciendo mejoras</h1>
        <p className="tz-mant-mensaje">
          {mensaje || "Estamos ajustando algunas cosas para que todo funcione mejor. Vuelve en unos minutos."}
        </p>
        <p className="tz-mant-pronto">
          <span className="tz-mant-punto" /> Volvemos pronto
        </p>
      </div>
    </div>
  );
}

const ESTILO = `
.tz-mantenimiento {
  position: fixed; inset: 0; z-index: 99990; display: grid; place-items: center; padding: 24px;
  background: radial-gradient(120% 90% at 50% 0%, #22104a 0%, #0b0818 55%, #05030c 100%);
  color: #f4f2ff; font-family: inherit; overflow: hidden;
  animation: tz-mant-in .6s ease both;
}
@keyframes tz-mant-in { from { opacity: 0; } to { opacity: 1; } }
.tz-mant-halo {
  position: absolute; width: 520px; height: 520px; border-radius: 50%;
  background: radial-gradient(closest-side, rgba(43,232,255,0.22), rgba(255,47,158,0.1), transparent);
  filter: blur(20px); animation: tz-mant-respira 4s ease-in-out infinite;
}
@keyframes tz-mant-respira { 0%, 100% { transform: scale(.9); opacity: .7; } 50% { transform: scale(1.08); opacity: 1; } }
.tz-mant-caja {
  position: relative; max-width: 420px; text-align: center; padding: 30px 26px; border-radius: 24px;
  background: rgba(12,9,26,0.82); border: 1px solid rgba(43,232,255,0.35);
  box-shadow: 0 0 40px rgba(43,232,255,0.18), inset 0 0 30px rgba(255,47,158,0.06);
  animation: tz-mant-sube .7s cubic-bezier(.34,1.56,.64,1) .1s both;
}
@keyframes tz-mant-sube { from { opacity: 0; transform: translateY(24px) scale(.94); } to { opacity: 1; transform: none; } }
.tz-mant-icono {
  position: relative; width: 84px; height: 84px; margin: 0 auto 16px; display: grid; place-items: center; border-radius: 50%;
  color: #2be8ff; background: rgba(43,232,255,0.1); border: 1px solid rgba(43,232,255,0.45);
  box-shadow: 0 0 24px rgba(43,232,255,0.4);
}
.tz-mant-icono > svg:first-child { animation: tz-mant-gira 2.6s cubic-bezier(.45,.05,.55,.95) infinite; transform-origin: 50% 50%; }
@keyframes tz-mant-gira { 0%, 100% { transform: rotate(-18deg); } 50% { transform: rotate(22deg); } }
.tz-mant-chispa { position: absolute; top: 10px; right: 10px; color: #d7ff3b; animation: tz-mant-chispa 1.8s ease-in-out infinite; }
@keyframes tz-mant-chispa { 0%, 100% { opacity: .3; transform: scale(.7); } 50% { opacity: 1; transform: scale(1.15); } }
.tz-mantenimiento h1 { margin: 0 0 10px; font-size: 22px; line-height: 1.2;
  background: linear-gradient(90deg, #2be8ff, #ff2f9e); -webkit-background-clip: text; background-clip: text; color: transparent; }
.tz-mant-mensaje { margin: 0 0 18px; font-size: 14.5px; line-height: 1.5; color: #d6d0f5; white-space: pre-line; }
.tz-mant-pronto { margin: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 800;
  letter-spacing: .12em; text-transform: uppercase; color: #39ffb0; }
.tz-mant-punto { width: 8px; height: 8px; border-radius: 50%; background: #39ffb0; box-shadow: 0 0 10px #39ffb0;
  animation: tz-mant-latido 1.4s ease-in-out infinite; }
@keyframes tz-mant-latido { 0%, 100% { transform: scale(.7); opacity: .5; } 50% { transform: scale(1.2); opacity: 1; } }
`;
