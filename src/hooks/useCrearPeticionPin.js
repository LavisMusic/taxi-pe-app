import { useCallback, useState } from "react";
import { supabase } from "../supabaseClient";

// Lado PÚBLICO del flujo de recuperación de PIN — la página
// /recuperar-pin (sin sesión, es justo para quien no puede loguearse).
//
// La persona solo da su celular (el mismo del login): la base busca la
// cuenta y arma la petición para el Admin con sus datos reales — nombre,
// tipo, DNI y placa si tiene, teléfono (migración 20261015100000). Así el
// Admin siempre tiene a qué número mandar el código, y sirve también
// para pasajeros, que no tienen DNI. 5 números sin cuenta desde el mismo
// dispositivo → 15 min de bloqueo.
const MENSAJES = {
  pendiente: "Ya enviaste una solicitud: un Admin te enviará un código por WhatsApp para que elijas tu PIN nuevo.",
  codigo_enviado:
    'Ya te enviamos un código por WhatsApp: escríbelo en "Ya tengo mi código". Si venció, pide al Admin que te lo reenvíe.',
  no_existe: "No encontramos una cuenta con ese número. Revisa que esté bien escrito.",
  invalido: "Ingresa un celular válido: 9 dígitos, empieza con 9 (ej. 987654321).",
  bloqueado: "Demasiados intentos. Espera 15 minutos antes de volver a probar.",
};

export function useCrearPeticionPin() {
  const [loading, setLoading] = useState(false);

  // Devuelve { estado, message }: 'enviada' sin message si salió bien.
  const crear = useCallback(async (telefono) => {
    setLoading(true);
    const { data, error } = await supabase.rpc("taxi_pedir_cambio_pin", { p_telefono: telefono });
    setLoading(false);
    if (error) return { estado: "error", message: "No se pudo enviar tu solicitud. Intenta de nuevo." };
    const estado = data?.estado;
    if (estado === "enviada") return { estado, message: null };
    return { estado, message: MENSAJES[estado] || "No se pudo enviar tu solicitud. Intenta de nuevo." };
  }, []);

  return { crear, loading };
}
