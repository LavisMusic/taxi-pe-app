import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";
import { subscribeTable } from "../lib/realtime";
import {
  ESTADO_RECARGA_APROBADO,
  ESTADO_RECARGA_PENDIENTE,
  ESTADO_RECARGA_RECHAZADO,
  TIPO_ITEM_MEMBRESIA,
} from "../lib/taxiEnums";

// Saldo/membresía de un Recolector (columnas nuevas en `usuarios`):
// dos caminos posibles llegan acá con la MISMA lógica de "aplicar
// beneficio" —
//   1) Recarga Rápida del Admin sobre la tarjeta de un recolector en el
//      Directorio: crea la petición YA 'aprobada' (autoAprobar=true) y
//      aplica el beneficio en el mismo momento.
//   2) Autorecarga del propio recolector (/recolector, botón
//      "Recargar"): crea la petición 'pendiente' — el Admin la revisa
//      en el Centro de Peticiones (pestaña "Recargas de Recolectores")
//      y recién ahí, al aprobar, se aplica el beneficio.
// `tipo_item`/`creditos`/`dias_membresia` quedan grabados EN la
// petición (copiados del paquete al crearla) — mismo patrón que
// `ventas.detalle` con Recarga Rápida de conductores: si el admin edita
// o borra el paquete después, la petición vieja sigue siendo correcta.
export function useRecargasRecolector() {
  const [peticiones, setPeticiones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const { data, error: fetchError } = await supabase
      .from("peticiones_recarga_recolector")
      .select(
        "id, recolector_id, paquete_id, paquete_nombre, tipo_item, creditos, dias_membresia, monto, metodo_pago, comprobante_url, estado, created_at, resuelto_at"
      )
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError("No se pudieron cargar las recargas de recolectores.");
      setPeticiones([]);
    } else {
      setPeticiones(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Una autorecarga nueva del recolector tiene que aparecer en el
  // Centro de Peticiones sin F5.
  useEffect(() => subscribeTable("peticiones_recarga_recolector", () => refresh()), [refresh]);

  const aplicarBeneficio = async (recolector, peticion) => {
    const patch = {};
    if (peticion.tipo_item === TIPO_ITEM_MEMBRESIA) {
      const actual = recolector.membresia_vencimiento ? new Date(recolector.membresia_vencimiento) : null;
      const base = actual && actual > new Date() ? actual : new Date();
      base.setDate(base.getDate() + (Number(peticion.dias_membresia) || 0));
      patch.membresia_vencimiento = base.toISOString();
    } else {
      patch.creditos_disponibles = Number(recolector.creditos_disponibles || 0) + Number(peticion.creditos || 0);
    }
    return supabase.from("usuarios").update(patch).eq("id", recolector.id).select();
  };

  // `recolector` es la fila completa de `usuarios` (para leer su saldo
  // actual antes de sumarle el del paquete). `autoAprobar` es lo único
  // que distingue la Recarga Rápida del Admin (true) de la Autorecarga
  // del propio recolector (false, queda 'pendiente').
  const crearPeticion = useCallback(
    async ({ recolector, paquete, metodoPago, comprobanteUrl, autoAprobar = false }) => {
      const row = {
        recolector_id: recolector.id,
        paquete_id: paquete.id,
        paquete_nombre: paquete.nombre,
        tipo_item: paquete.tipo_item,
        creditos: paquete.creditos || null,
        dias_membresia: paquete.dias_membresia || null,
        monto: paquete.precio,
        metodo_pago: metodoPago,
        comprobante_url: comprobanteUrl || null,
        estado: autoAprobar ? ESTADO_RECARGA_APROBADO : ESTADO_RECARGA_PENDIENTE,
        resuelto_at: autoAprobar ? new Date().toISOString() : null,
      };

      const { data: peticionCreada, error: insertError } = await supabase
        .from("peticiones_recarga_recolector")
        .insert(row)
        .select()
        .single();
      if (insertError) return { error: insertError };

      if (autoAprobar) {
        const { error: beneficioError } = await aplicarBeneficio(recolector, peticionCreada);
        if (beneficioError) {
          return { error: new Error("La solicitud se creó, pero no se pudo actualizar el saldo del recolector.") };
        }
      }

      await refresh();
      return { error: null };
    },
    [refresh]
  );

  // Aprobar una petición 'pendiente' desde el Centro de Peticiones —
  // `recolector` viene de la lista `usuarios` que ya tiene cargada
  // PeticionesModal (no hace falta un fetch aparte).
  const aprobarPeticion = useCallback(
    async (peticion, recolector) => {
      const { error: beneficioError } = await aplicarBeneficio(recolector, peticion);
      if (beneficioError) return { error: beneficioError };

      const { error: updateError } = await supabase
        .from("peticiones_recarga_recolector")
        .update({ estado: ESTADO_RECARGA_APROBADO, resuelto_at: new Date().toISOString() })
        .eq("id", peticion.id);
      if (updateError) return { error: updateError };

      await refresh();
      return { error: null };
    },
    [refresh]
  );

  const rechazarPeticion = useCallback(
    async (id) => {
      const { error: updateError } = await supabase
        .from("peticiones_recarga_recolector")
        .update({ estado: ESTADO_RECARGA_RECHAZADO, resuelto_at: new Date().toISOString() })
        .eq("id", id);
      if (!updateError) await refresh();
      return { error: updateError };
    },
    [refresh]
  );

  const pendientes = peticiones.filter((p) => p.estado === ESTADO_RECARGA_PENDIENTE);

  return {
    peticiones,
    pendientes,
    loading,
    error,
    refresh,
    crearPeticion,
    aprobarPeticion,
    rechazarPeticion,
  };
}
