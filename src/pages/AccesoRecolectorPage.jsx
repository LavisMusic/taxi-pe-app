import Styles from "../components/Styles";
import AccesoRecolectorModal from "../components/AccesoRecolectorModal";

// Ingreso propio de los recolectores (/recolector sin sesión): ya no hay
// botón en la portada de Taxi PE; entran por esta dirección, que se instala
// como su propia app (manifest-recolector.webmanifest). Al ingresar o
// registrarse, el formulario los lleva a su panel.
export default function AccesoRecolectorPage() {
  return (
    <div className="tz-root">
      <Styles />
      <AccesoRecolectorModal pagina onClose={() => {}} />
    </div>
  );
}
