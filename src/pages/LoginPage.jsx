import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCategoriasPublicas } from "../hooks/useCategoriasPublicas";
import { useCrearConductorConUsuario } from "../hooks/useCrearConductorConUsuario";
import Styles from "../components/Styles";
import PasajeroAuthForm from "../components/PasajeroAuthForm";
import StaffLoginForm from "../components/StaffLoginForm";
import RegistroConductorForm from "../components/recolector/RegistroConductorForm";
import logo from "../assets/logo.png";

// Conductor/Recolector: mismo toggle Ingresar/Registrarse que ya usan
// los modales de acceso de la Home (AccesoConductorModal.jsx) — acá
// vive el equivalente para quien entra directo por /login en vez de
// pasar por el header público. "Ingresar" es el StaffLoginForm
// compartido (Teléfono+PIN, rutea sola según el rol real de la
// cuenta); "Registrarse" reusa RegistroConductorForm en modo self-
// registro (aprobado:false, cae en el Centro de Peticiones).
function AccesoStaff() {
  const { categorias, subgrupos } = useCategoriasPublicas();
  const { crear: crearConductorConUsuario } = useCrearConductorConUsuario();
  const [modo, setModo] = useState("ingresar");

  return (
    <>
      <div className="tz-gasto-tipo-buttons" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={`tz-gasto-tipo-btn ${modo === "ingresar" ? "tz-gasto-tipo-active" : ""}`}
          onClick={() => setModo("ingresar")}
        >
          Ingresar
        </button>
        <button
          type="button"
          className={`tz-gasto-tipo-btn ${modo === "registrar" ? "tz-gasto-tipo-active" : ""}`}
          onClick={() => setModo("registrar")}
        >
          Registrarme
        </button>
      </div>

      {modo === "ingresar" ? (
        <StaffLoginForm />
      ) : (
        <RegistroConductorForm
          categorias={categorias}
          subgrupos={subgrupos}
          crearConductorConUsuario={crearConductorConUsuario}
          requiereLogin
          aprobado={false}
          onClose={() => {}}
          onCreatedUsuario={() => {}}
        />
      )}
    </>
  );
}

// Ruta /login — punto de entrada único para los 3 roles, con dos
// experiencias distintas: Conductor/Recolector (Teléfono+PIN, ver
// StaffLoginForm.jsx) y Pasajero (autoservicio, Registro con
// DNI+Teléfono+PIN pero Login liviano solo con Teléfono+PIN).
export default function LoginPage() {
  const navigate = useNavigate();
  const [rol, setRol] = useState("pasajero");

  return (
    <div
      className="tz-root"
      style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <Styles />
      <div className="tz-modal" style={{ position: "static" }}>
        <img src={logo} alt="TaxiP" className="tz-modal-logo" />
        <p className="tz-brand-sub">Ingresa a tu cuenta</p>

        <div className="tz-gasto-tipo-buttons" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={`tz-gasto-tipo-btn ${rol === "pasajero" ? "tz-gasto-tipo-active" : ""}`}
            onClick={() => setRol("pasajero")}
          >
            Pasajero
          </button>
          <button
            type="button"
            className={`tz-gasto-tipo-btn ${rol === "staff" ? "tz-gasto-tipo-active" : ""}`}
            onClick={() => setRol("staff")}
          >
            Conductor / Recolector
          </button>
        </div>

        {/* Tanto PasajeroAuthForm como StaffLoginForm ya traen su
           propio "Olvidé mi PIN" — nada que agregar acá, evita
           duplicarlo. */}
        {rol === "pasajero" ? <PasajeroAuthForm /> : <AccesoStaff />}

        {rol === "staff" && (
          <button
            type="button"
            className="tz-metodo-pago-change"
            style={{ display: "block", width: "100%", textAlign: "center", margin: "8px 0 0" }}
            onClick={() => navigate("/registro-conductor")}
          >
            ¿Un recolector ya te registró como conductor? Crea tu cuenta
          </button>
        )}
      </div>
    </div>
  );
}
