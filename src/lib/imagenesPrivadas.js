import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Fotos de verificación y con el DNI: viven en el bucket PRIVADO
// 'verificaciones' (tanda 3d). En la base no se guarda un enlace sino
// 'privado:<archivo>'; para mostrarlas se pide un enlace firmado que vence
// (solo lo consigue el Admin, o quien subió la foto). Las fotos viejas
// siguen siendo enlaces públicos normales y se muestran tal cual.
export const BUCKET_PRIVADO = "verificaciones";
const PREFIJO = "privado:";
const VIGENCIA_SEGUNDOS = 3600;

export const esImagenPrivada = (valor) => typeof valor === "string" && valor.startsWith(PREFIJO);
export const valorPrivado = (archivo) => `${PREFIJO}${archivo}`;

const cache = new Map();

export async function urlVisible(valor) {
  if (!valor) return "";
  if (!esImagenPrivada(valor)) return valor;
  const enCache = cache.get(valor);
  if (enCache && enCache.vence > Date.now()) return enCache.url;
  const { data, error } = await supabase.storage
    .from(BUCKET_PRIVADO)
    .createSignedUrl(valor.slice(PREFIJO.length), VIGENCIA_SEGUNDOS);
  if (error || !data?.signedUrl) return "";
  cache.set(valor, { url: data.signedUrl, vence: Date.now() + (VIGENCIA_SEGUNDOS - 60) * 1000 });
  return data.signedUrl;
}

// El enlace que se puede poner en un <img> (pública: tal cual; privada:
// firmada, se resuelve sola).
export function useUrlVisible(valor) {
  const [url, setUrl] = useState(() => (esImagenPrivada(valor) ? "" : valor || ""));
  useEffect(() => {
    let cancelado = false;
    if (!esImagenPrivada(valor)) {
      setUrl(valor || "");
      return undefined;
    }
    urlVisible(valor).then((u) => {
      if (!cancelado) setUrl(u);
    });
    return () => {
      cancelado = true;
    };
  }, [valor]);
  return url;
}
