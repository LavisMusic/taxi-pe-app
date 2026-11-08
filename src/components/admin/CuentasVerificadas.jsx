import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { supabase } from "../../supabaseClient";
import MedidorCuentas from "../MedidorCuentas";

// Cuentas verificadas de Taxi-PE (fase 5a, migración 20261111100000):
// un medidor por rol con su meta (editable por el admin).
const ROLES = [
  { rol: "pasajero", titulo: "Pasajeros" },
  { rol: "conductor", titulo: "Conductores" },
  { rol: "recolector", titulo: "Recolectores" },
];

export default function CuentasVerificadas() {
  const [datos, setDatos] = useState(null);
  const leer = useCallback(async () => {
    const { data, error } = await supabase.rpc("taxi_resumen_cuentas");
    if (!error && Array.isArray(data)) setDatos(data);
  }, []);
  useEffect(() => {
    leer();
    const t = setInterval(leer, 60000);
    return () => clearInterval(t);
  }, [leer]);

  if (!datos) return null;
  return (
    <section className="tz-cuentas-verificadas">
      <h3 className="tz-cuentas-verificadas-titulo">
        <ShieldCheck size={16} /> Cuentas verificadas
      </h3>
      <div className="tz-cuentas-verificadas-grid">
        {ROLES.map(({ rol, titulo }) => {
          const d = datos.find((x) => x.rol === rol) || {};
          return (
            <MedidorCuentas
              key={rol}
              titulo={titulo}
              verificadas={d.verificadas || 0}
              enRevision={d.en_revision || 0}
              temporales={d.temporales || 0}
              meta={d.meta || 100}
              nuevasSemana={d.nuevas_semana || 0}
              porVencer={d.por_vencer || 0}
              onGuardarMeta={async (meta) => {
                const { error } = await supabase.rpc("taxi_guardar_meta_cuentas", { p_rol: rol, p_meta: meta });
                if (!error) leer();
                return { error };
              }}
            />
          );
        })}
      </div>
    </section>
  );
}
