import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Al navegar dentro de la app, vuelve a elegir el manifiesto de la entrada
// en la que estás (index.html: window.__tzManifiesto), así "Instalar app"
// instala ESA entrada (admin, superadmin, negocio, recolector…) con su
// nombre y abriendo en su dirección. Mismo archivo en Taxi-PE y Caja.
export default function ManifiestoRuta() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.__tzManifiesto?.(pathname);
  }, [pathname]);
  return null;
}
