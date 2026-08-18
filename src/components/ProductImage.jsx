import { useRef } from "react";
import { Image as ImageIcon, Camera } from "lucide-react";

// Espacio reservado para la foto del producto/combo en cada tarjeta.
// Cuando SÍ hay foto, se arma en 3 capas superpuestas (position:
// absolute, ver .tz-product-image-particles/-liquid/-cutout en
// Styles.jsx): atrás, un Aurora/Mesh Gradient en movimiento rápido
// (puro CSS, sin GIF/imagen externa); en el medio, un glow que sigue
// al cursor y "empuja"/distorsiona ese aurora (mix-blend-mode) al
// pasar el mouse — solo desktop, no hace nada en touch; adelante, la
// foto del producto flotando con su propio drop-shadow.
// Clientes y Cajero solo ven esto; el Admin puede tocarlo para abrir el
// modal de "Gestión de Imagen" (ver App.jsx).
export default function ProductImage({ item, editable, onManage, compact }) {
  const containerRef = useRef(null);

  // Mutación directa del DOM (sin useState) a propósito: mousemove
  // dispara decenas de veces por segundo, y pasar eso por setState
  // re-renderizaría todo el árbol de React en cada pixel de
  // movimiento. Las variables CSS solo necesitan existir en el
  // navegador — React no tiene por qué enterarse.
  const handleMouseMove = (e) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty("--mouse-x", `${x}%`);
    el.style.setProperty("--mouse-y", `${y}%`);
  };

  // A propósito NO hay onMouseLeave que resetee --mouse-x/--mouse-y:
  // si las devolviéramos a 50%/50%, el brillo "saltaría" de golpe al
  // centro antes de apagarse. Dejándolas congeladas en la última
  // posición real del cursor, el glow se apaga exactamente donde salió
  // — la desaparición la maneja el :hover en CSS (solo opacity, ver
  // .tz-product-image-liquid en Styles.jsx), sin tocar la posición.
  const hasImage = !!item.imagenUrl;

  return (
    <div
      ref={containerRef}
      className={`tz-product-image ${compact ? "tz-product-image-sm" : ""} ${
        editable ? "tz-product-image-editable" : ""
      }`}
      onClick={
        editable
          ? (e) => {
              e.stopPropagation();
              onManage(item);
            }
          : undefined
      }
      onMouseMove={hasImage ? handleMouseMove : undefined}
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? `Gestionar imagen de ${item.name}` : undefined}
      title={editable ? "Gestionar imagen" : undefined}
    >
      {hasImage ? (
        <>
          <div className="tz-product-image-particles" aria-hidden="true" />
          <div className="tz-product-image-liquid" aria-hidden="true" />
          <img
            src={item.imagenUrl}
            alt={item.name}
            className="tz-product-image-cutout"
          />
        </>
      ) : (
        <div className="tz-product-image-placeholder">
          <ImageIcon size={compact ? 16 : 22} />
        </div>
      )}
      {editable && (
        <span className={`tz-product-image-edit-badge ${compact ? "tz-product-image-edit-badge-sm" : ""}`}>
          <Camera size={compact ? 9 : 12} />
        </span>
      )}
    </div>
  );
}
