import { useUrlVisible } from "../lib/imagenesPrivadas";

// <img> para una foto guardada que puede ser pública (enlace) o privada
// ('privado:<archivo>', ver lib/imagenesPrivadas.js). Mientras se pide el
// enlace firmado no muestra nada.
export default function ImagenGuardada({ src, alt = "", ...props }) {
  const url = useUrlVisible(src);
  if (!url) return null;
  return <img src={url} alt={alt} {...props} />;
}
