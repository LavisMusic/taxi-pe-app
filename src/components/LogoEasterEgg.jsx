import { useRef, useState } from "react";
import EasterEggGame from "./EasterEggGame";

const CLICKS_REQUIRED = 5;
const WINDOW_MS = 2000;

/* Envuelve CUALQUIER <img> de logo existente sin cambiar su
   apariencia (mismo src/alt/className) — 5 clics seguidos en menos de
   2 segundos abren el minijuego arcade. Se usa en el header del POS
   (admin/cajero, App.jsx) y en el catálogo público (cliente,
   CatalogPage.jsx) para que los 3 roles puedan encontrarlo. */
export default function LogoEasterEgg({ src, alt, className }) {
  const [open, setOpen] = useState(false);
  const clickTimesRef = useRef([]);

  const handleClick = () => {
    const now = Date.now();
    const recent = clickTimesRef.current.filter((t) => now - t < WINDOW_MS);
    recent.push(now);
    clickTimesRef.current = recent;
    if (recent.length >= CLICKS_REQUIRED) {
      clickTimesRef.current = [];
      setOpen(true);
    }
  };

  return (
    <>
      <img
        src={src}
        alt={alt}
        className={className}
        onClick={handleClick}
        style={{ cursor: "pointer" }}
      />
      {open && <EasterEggGame onClose={() => setOpen(false)} />}
    </>
  );
}
