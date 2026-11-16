import { Hand, HandCoins, Banknote } from "lucide-react";
import IconoGema from "./IconoGema";

// Aviso "pagó con una gema" — MISMO archivo en Taxi-PE y Caja
// (src/components/AvisoPagoGema.jsx). Un cuadro con una escena animada: una
// mano deja caer monedas y la gema en la mano de quien cobra; debajo, lo que
// cobra en mano y la gema que recibe.
//   Taxi-PE: conductor y pasajero, cuando el pasajero usa una gema verde en
//   la tarifa (debajo del aviso de la negociación confirmada).
//   Caja: el negocio, sus cajeros y el cliente, cuando el cliente paga un
//   pedido con una gema celeste.
// `pagador`: lo ve quien pagó ("Pagaste con 1 gema" / "Pagas S/ x");
// si no, quien cobra ("{quien} pagó con 1 gema" / "Cobras S/ x").
// Sin <p> adentro a propósito: los chats les ponen scroll a los párrafos de
// las burbujas y eso recortaba el brillo de la gema.
const COLORES = {
  verde: { rgb: "57,255,176", hex: "#39ffb0" },
  celeste: { rgb: "43,232,255", hex: "#2be8ff" },
};

export default function AvisoPagoGema({ color = "verde", quien = "El pasajero", cobras = null, valor = 0.1, hora = null, pagador = false }) {
  const c = COLORES[color] || COLORES.verde;
  return (
    <div className="tz-gp" style={{ "--gp-rgb": c.rgb, "--gp-hex": c.hex }}>
      <style>{ESTILO}</style>
      <div className="tz-gp-escena" aria-hidden="true">
        <span className="tz-gp-mano-arriba">
          <Hand size={38} strokeWidth={1.8} />
        </span>
        <span className="tz-gp-cae tz-gp-moneda" style={{ "--d": "0s", "--x": "-6px" }}>S/</span>
        <span className="tz-gp-cae tz-gp-gema" style={{ "--d": "0.55s", "--x": "2px" }}>
          <IconoGema color={color} size={16} />
        </span>
        <span className="tz-gp-cae tz-gp-moneda" style={{ "--d": "1.1s", "--x": "8px" }}>S/</span>
        <span className="tz-gp-mano-abajo">
          <HandCoins size={44} strokeWidth={1.8} />
        </span>
      </div>
      <div className="tz-gp-titulo">
        <IconoGema color={color} size={15} /> {pagador ? "Pagaste" : `${quien} pagó`} con <strong>1 gema</strong>
      </div>
      <div className="tz-gp-detalle">
        <span className="tz-gp-chip is-billete">
          <Banknote size={15} /> {pagador ? "Pagas" : "Cobras"}{" "}
          {cobras != null ? <strong>S/ {Number(cobras).toFixed(2)}</strong> : "el total menos la gema"}
        </span>
        <span className="tz-gp-mas">+</span>
        <span className="tz-gp-chip is-gema">
          <IconoGema color={color} size={13} /> <strong>1 gema</strong> (S/ {Number(valor).toFixed(2)})
        </span>
      </div>
      {hora && <span className="tz-gp-hora">{hora}</span>}
    </div>
  );
}

const ESTILO = `
.tz-gp {
  align-self: center; width: 92%; max-width: 92%; box-sizing: border-box; margin: 4px auto;
  padding: 10px 12px 12px; border-radius: 14px; text-align: center; color: var(--text, #fff);
  border: 1px solid rgba(215,255,59,0.4); background: rgba(215,255,59,0.08);
  animation: tz-gp-entra 0.6s cubic-bezier(.34,1.56,.64,1) both;
}
@keyframes tz-gp-entra {
  from { opacity: 0; transform: translateY(12px) scale(0.9); filter: blur(3px); }
  to { opacity: 1; transform: none; filter: none; }
}
.tz-gp-escena { position: relative; width: 140px; height: 106px; margin: 2px auto 4px; }
.tz-gp-mano-arriba {
  position: absolute; left: 50%; top: 0; margin-left: -30px; color: #ffd36b; display: inline-flex;
  transform: rotate(160deg); transform-origin: 50% 50%;
  filter: drop-shadow(0 0 6px rgba(255,211,107,0.55));
  animation: tz-gp-suelta 1.65s ease-in-out infinite;
}
@keyframes tz-gp-suelta {
  0%, 100% { transform: rotate(160deg) translateY(0); }
  30% { transform: rotate(150deg) translateY(-2px); }
  60% { transform: rotate(168deg) translateY(1px); }
}
.tz-gp-mano-abajo {
  position: absolute; left: 50%; bottom: 0; margin-left: -22px; color: var(--gp-hex); display: inline-flex;
  filter: drop-shadow(0 0 7px rgba(var(--gp-rgb),0.55));
  animation: tz-gp-recibe 0.55s ease-in-out infinite;
}
@keyframes tz-gp-recibe {
  0%, 70%, 100% { transform: translateY(0) scale(1); }
  82% { transform: translateY(2px) scale(1.06); }
}
.tz-gp-cae {
  position: absolute; left: 50%; top: 30px; display: inline-flex; align-items: center; justify-content: center;
  opacity: 0; animation: tz-gp-caer 1.65s cubic-bezier(.45,0,.75,1) var(--d, 0s) infinite;
}
.tz-gp-moneda {
  width: 17px; height: 17px; margin-left: -8px; border-radius: 999px;
  font-size: 7px; font-weight: 900; color: #6b4a00;
  background: radial-gradient(circle at 35% 30%, #fff6c9, #ffd36b 45%, #d99a14);
  box-shadow: 0 0 8px rgba(255,211,107,0.75), inset 0 -1px 0 rgba(0,0,0,0.25);
}
.tz-gp-gema { margin-left: -8px; padding: 3px; }
@keyframes tz-gp-caer {
  0% { opacity: 0; transform: translate(0, 0) rotate(0deg) scale(0.7); }
  12% { opacity: 1; transform: translate(calc(var(--x) * 0.3), 4px) rotate(40deg) scale(1); }
  78% { opacity: 1; transform: translate(var(--x), 44px) rotate(260deg) scale(1); }
  100% { opacity: 0; transform: translate(var(--x), 52px) rotate(320deg) scale(0.6); }
}
.tz-gp-titulo {
  display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap;
  margin: 0 0 8px; padding: 3px 4px; font-size: 14px; line-height: 1.4;
}
.tz-gp-detalle {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px;
  padding: 3px; font-size: 12px; line-height: 1.3;
}
.tz-gp-chip {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 999px;
  animation: tz-gp-brillo 2.4s ease-in-out infinite;
}
.tz-gp-chip.is-billete { color: #d7ff3b; border: 1px solid rgba(215,255,59,0.45); background: rgba(215,255,59,0.08); }
.tz-gp-chip.is-gema {
  color: var(--gp-hex); border: 1px solid rgba(var(--gp-rgb),0.45); background: rgba(var(--gp-rgb),0.08);
  animation-delay: 1.2s;
}
@keyframes tz-gp-brillo {
  0%, 100% { box-shadow: 0 0 0 rgba(var(--gp-rgb),0); }
  50% { box-shadow: 0 0 12px rgba(var(--gp-rgb),0.35); }
}
.tz-gp-mas { color: var(--text-dim, #aaa); font-weight: 800; }
.tz-gp-hora { display: block; margin-top: 6px; font-size: 11px; color: var(--text-dim, #aaa); }
`;
