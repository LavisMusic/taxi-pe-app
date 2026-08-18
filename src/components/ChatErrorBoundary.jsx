import { Component } from "react";
import { AlertTriangle } from "lucide-react";

// Blindaje final del Chat: React NO tiene una forma declarativa de
// "atrapar" un error de render con hooks — el mecanismo real
// (getDerivedStateFromError/componentDidCatch) exige una clase. Sin
// esto, CUALQUIER excepción no prevista durante el render de
// ConductorChatInboxModal/ChatModal (una propiedad undefined que se
// nos escapó, un dato con una forma que no anticipamos) desmontaba el
// árbol de React ENTERO — la pantalla gris reportada. Con este límite
// alrededor, el error queda contenido acá: se ve un aviso adentro del
// modal en vez de tumbar toda la sesión. El botón "X" de cerrar vive
// FUERA de este boundary (es hermano, no hijo, en ChatModal.jsx /
// ConductorChatInboxModal.jsx) — sigue funcionando aunque el contenido
// de adentro se rompa.
export default class ChatErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Chat: error de render atrapado por ChatErrorBoundary", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="tz-empty" style={{ textAlign: "center", padding: "24px 10px" }}>
          <AlertTriangle size={22} color="var(--danger)" />
          <p style={{ margin: "8px 0 0" }}>
            Ocurrió un problema al mostrar el chat. Cierra esta ventana (botón "X" arriba) e intenta de nuevo.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
