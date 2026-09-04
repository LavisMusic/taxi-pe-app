import { useCallback, useEffect, useState } from "react";

const PREFIJO = "tz-compra-creditos-";

// "Compra Confirmada" (pedido nuevo, separado de Membresía Activada —
// ver useMembresiaActivadaNeon.js): se dispara en CADA compra de un
// paquete de CRÉDITOS, incluso si es el mismo paquete de siempre — a
// diferencia de la membresía (que tiene un "paquete activo" único y
// solo avisa cuando CAMBIA de cuál), los créditos se van sumando, no
// hay un estado "activo" que comparar. Por eso acá se compara un
// TIMESTAMP (`ultima_compra_creditos_at`, un valor nuevo en cada venta)
// contra el último que vimos, en vez de comparar un id de paquete.
//
// Mismo criterio de "primera vez no dispara nada" que el resto de los
// avisos de bienvenida: si este navegador nunca vio a este conductor,
// el timestamp que YA tenía guardado (de una compra vieja, de antes de
// que existiera esta función) no cuenta como "recién comprado".
export function useCompraCreditosNeon(conductorId, ultimaCompraAt, nombre, descripcion) {
  const [compra, setCompra] = useState(null);

  useEffect(() => {
    if (!conductorId) return;

    let ultimoVisto;
    try {
      ultimoVisto = window.localStorage.getItem(PREFIJO + conductorId);
    } catch {
      return;
    }

    if (ultimoVisto === null) {
      try {
        window.localStorage.setItem(PREFIJO + conductorId, ultimaCompraAt ?? "");
      } catch {
        // no-op
      }
      return;
    }

    const actual = ultimaCompraAt ?? "";
    if (actual && actual !== ultimoVisto) {
      setCompra({ nombre, descripcion, at: actual });
    }
  }, [conductorId, ultimaCompraAt, nombre, descripcion]);

  const marcarVista = useCallback(() => {
    if (!conductorId || !compra) return;
    try {
      window.localStorage.setItem(PREFIJO + conductorId, compra.at);
    } catch {
      // no-op
    }
    setCompra(null);
  }, [conductorId, compra]);

  return { compra, marcarVista };
}
