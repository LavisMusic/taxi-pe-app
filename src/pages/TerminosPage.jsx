import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Styles from "../components/Styles";
import TerminosTexto from "../components/TerminosTexto";

// Ruta pública /terminos: los Términos y Condiciones completos (el enlace
// del registro abre esta página).
export default function TerminosPage() {
  const navigate = useNavigate();
  return (
    <div className="tz-root" style={{ padding: 16 }}>
      <Styles />
      <div className="tz-modal tz-terminos-pagina" style={{ position: "static", margin: "0 auto" }}>
        <TerminosTexto />
        <button
          type="button"
          className="tz-scan-btn tz-payment-save"
          style={{ marginTop: 16 }}
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
        >
          <ArrowLeft size={16} /> Volver
        </button>
      </div>
    </div>
  );
}
