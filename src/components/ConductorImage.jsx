import { useRef } from "react";
import { Image as ImageIcon } from "lucide-react";

// Igual que ProductImage.jsx (mismo contenedor .tz-product-image,
// mismo glow que sigue al cursor vía --mouse-x/--mouse-y), pero la
// capa trasera es .tz-driver-image-particles con data-estado — el
// color del Aurora lo decide el CSS según 'activo'/'ocupado' (ver
// Styles.jsx), no una prop de color fija. Componente aparte en vez de
// una rama condicional dentro de ProductImage: son dos dominios
// distintos (producto vs. conductor) que solo comparten la técnica
// visual, no los datos.
export default function ConductorImage({ fotoUrl, nombre, estado }) {
  const containerRef = useRef(null);

  const handleMouseMove = (e) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty("--mouse-x", `${x}%`);
    el.style.setProperty("--mouse-y", `${y}%`);
  };

  const hasImage = !!fotoUrl;

  return (
    <div
      ref={containerRef}
      className="tz-product-image"
      onMouseMove={hasImage ? handleMouseMove : undefined}
    >
      {hasImage ? (
        <>
          <div className="tz-driver-image-particles" data-estado={estado} aria-hidden="true" />
          <div className="tz-product-image-liquid" aria-hidden="true" />
          <img src={fotoUrl} alt={nombre} className="tz-product-image-cutout" />
        </>
      ) : (
        <div className="tz-product-image-placeholder">
          <ImageIcon size={22} />
        </div>
      )}
    </div>
  );
}
