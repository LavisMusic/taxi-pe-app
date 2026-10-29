import { useEffect, useRef, useState } from "react";
import { ClipboardPaste } from "lucide-react";

// "Pegar comprobante": un atajo para no tener que guardar la captura del
// pago y buscarla — la persona la copia (ej. en Yape: copiar imagen) y la
// pega acá. Va debajo de cada "Adjuntar comprobante". El botón lee la
// imagen del portapapeles (el navegador pide permiso la primera vez) y,
// mientras esté en pantalla, Ctrl+V / "Pegar" también la toma.
// `onArchivo(file)`: el mismo camino que la imagen elegida a mano.
export default function BotonPegarComprobante({ onArchivo, deshabilitado = false }) {
  const [aviso, setAviso] = useState("");
  const ref = useRef(onArchivo);
  ref.current = onArchivo;

  const entregar = (blob, tipo) => {
    setAviso("");
    ref.current(new File([blob], `comprobante-${Date.now()}.${(tipo.split("/")[1] || "png").split("+")[0]}`, { type: tipo }));
  };

  useEffect(() => {
    if (deshabilitado) return undefined;
    const alPegar = (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
      const archivo = item?.getAsFile();
      if (!archivo) return;
      e.preventDefault();
      entregar(archivo, archivo.type);
    };
    document.addEventListener("paste", alPegar);
    return () => document.removeEventListener("paste", alPegar);
  }, [deshabilitado]);

  const pegar = async () => {
    if (!navigator.clipboard?.read) {
      setAviso("Tu navegador no deja leer lo copiado desde un botón: usa Ctrl+V (o mantén presionado y elige Pegar).");
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const tipo = it.types.find((t) => t.startsWith("image/"));
        if (tipo) return entregar(await it.getType(tipo), tipo);
      }
      setAviso("No hay ninguna imagen copiada. Copia la captura del pago y vuelve a tocar.");
    } catch {
      setAviso("No se pudo leer lo copiado. Permite el acceso al portapapeles o usa Ctrl+V.");
    }
  };

  return (
    <>
      <button type="button" className="tz-scan-btn tz-pegar-comprobante" onClick={pegar} disabled={deshabilitado}>
        <ClipboardPaste size={16} /> Pegar comprobante
      </button>
      {aviso && <p className="tz-pegar-comprobante-aviso">{aviso}</p>}
    </>
  );
}
