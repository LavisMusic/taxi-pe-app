import { useEffect, useRef, useState } from "react";
import { AtSign, Sparkles } from "lucide-react";
import {
  FORMATO_USUARIO,
  normalizarUsuario,
  esUsuarioProvisional,
  usuarioLibre,
  sugerirUsuarioLibre,
} from "../lib/nombreUsuario";

// Campo "Nombre de usuario" (perfil y formularios de verificación): revisa
// en vivo si está libre y, si la cuenta todavía no eligió uno (las que
// llegan de Caja traen el teléfono), le propone uno libre al abrir.
// useCampoUsuario devuelve { valor, estado, cambiar, listo, cambio }:
//   estado: propio | sugiriendo | sugerido | revisando | libre | tomado | invalido | sinrevisar
//   listo:  se puede guardar (propio, sugerido o libre)
//   cambio: es distinto del que ya tenía la cuenta
export function useCampoUsuario({ nombre, nombreUsuario, telefono, usuarioId }) {
  const provisional = esUsuarioProvisional(nombreUsuario, telefono);
  const [valor, setValor] = useState(provisional ? "" : nombreUsuario || "");
  const [estado, setEstado] = useState(provisional ? "sugiriendo" : "propio");
  const consulta = useRef(0);

  useEffect(() => {
    if (!provisional) return undefined;
    let vivo = true;
    sugerirUsuarioLibre(nombre, usuarioId).then((s) => {
      if (!vivo || consulta.current > 0) return; // ya empezó a escribir
      if (s) {
        setValor(s);
        setEstado("sugerido");
      } else {
        setEstado("sinrevisar");
      }
    });
    return () => {
      vivo = false;
    };
  }, [provisional, nombre, usuarioId]);

  const cambiar = (texto) => {
    const limpio = normalizarUsuario(texto);
    setValor(limpio);
    const n = ++consulta.current;
    if (!provisional && limpio === nombreUsuario) return setEstado("propio");
    if (!FORMATO_USUARIO.test(limpio)) return setEstado("invalido");
    setEstado("revisando");
    setTimeout(async () => {
      if (n !== consulta.current) return;
      const libre = await usuarioLibre(limpio, usuarioId);
      if (n === consulta.current) setEstado(libre === null ? "sinrevisar" : libre ? "libre" : "tomado");
    }, 400);
  };

  return {
    valor,
    estado,
    cambiar,
    marcarGuardado: () => setEstado("propio"),
    listo: ["propio", "sugerido", "libre"].includes(estado),
    cambio: valor !== (nombreUsuario || ""),
  };
}

const TEXTO = {
  sugiriendo: "Buscando un nombre libre…",
  sugerido: "Te sugerimos este: está libre. Puedes cambiarlo.",
  revisando: "Revisando…",
  libre: "Está libre.",
  tomado: "Ya lo usa otra persona.",
  invalido: "De 3 a 20: letras, números, punto o guion bajo.",
  sinrevisar: "No se pudo revisar si está libre. Intenta de nuevo en un momento.",
};

// `children`: lo que va a la derecha del campo (ej. el botón Guardar).
// `bloqueadoHasta` (texto de fecha): ya lo cambió esta semana — no se edita.
export default function CampoUsuario({ campo, id = "campo-usuario", children, bloqueadoHasta = null }) {
  const texto = bloqueadoHasta ? `Ya lo cambiaste esta semana: podrás cambiarlo de nuevo el ${bloqueadoHasta}.` : TEXTO[campo.estado];
  return (
    <>
      <label className="tz-field-label" htmlFor={id}>Nombre de usuario</label>
      <div className="tz-perfil-pasajero-fila">
        <span className="tz-perfil-usuario-input">
          <AtSign size={15} />
          <input
            id={id}
            className="tz-text-input"
            value={campo.valor}
            maxLength={20}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            placeholder={campo.estado === "sugiriendo" ? "…" : "tu.usuario"}
            onChange={(e) => campo.cambiar(e.target.value)}
            disabled={!!bloqueadoHasta}
          />
        </span>
        {children}
      </div>
      {texto && (
        <p key={bloqueadoHasta ? "bloqueado" : campo.estado} className={`tz-perfil-usuario-estado is-${bloqueadoHasta ? "invalido" : campo.estado}`}>
          {campo.estado === "sugerido" && <Sparkles size={12} />} {texto}
        </p>
      )}
    </>
  );
}
