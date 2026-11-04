import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Smartphone, KeyRound, Copy, Check, Delete } from "lucide-react";
import { buildWhatsappLink } from "../lib/whatsapp";

/* PIN privado al crear una cuenta (revisión de seguridad, P0 #2).

   Quien crea la cuenta (cajero, admin, superadmin) le pasa su celular a la
   persona y ELLA escribe su PIN en un teclado propio: sin campo de texto,
   sin botón de "ver", sin autocompletar del navegador. El PIN se escribe
   dos veces y va directo en la misma petición que crea la cuenta; nunca se
   guarda en la pantalla de quien la crea.

   Si la persona no está presente, la cuenta se crea sin PIN y el servidor
   devuelve un código de activación de un solo uso: se muestra acá con un
   botón para enviarlo por WhatsApp.

   Uso:
     const { pedirPin, mostrarCodigo, modalesPin } = usePinPrivado();
     const r = await pedirPin("María");   // { pin } | { ausente: true } | null (canceló)
     ...crear la cuenta con r.pin (o sin PIN si r.ausente)...
     if (data.codigoActivacion) mostrarCodigo({ codigo, nombre, celular });
     ...y renderizar {modalesPin} una vez. */

const LARGO = 6;
const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "borrar"];

function TecladoPin({ nombre, onListo, onAusente, onCancelar }) {
  const [pin, setPin] = useState("");
  const [primero, setPrimero] = useState(null);
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState(false);
  const [sacudir, setSacudir] = useState(0);
  const listoRef = useRef(false);

  const pulsar = useCallback(
    (tecla) => {
      if (listoRef.current) return;
      setError(false);
      if (tecla === "borrar") {
        setPin((p) => p.slice(0, -1));
        return;
      }
      setPin((p) => (p.length < LARGO ? p + tecla : p));
    },
    []
  );

  // Al completar los 6: primera vez se pide confirmar; la segunda se compara.
  useEffect(() => {
    if (pin.length !== LARGO) return undefined;
    const t = setTimeout(() => {
      if (primero === null) {
        setPrimero(pin);
        setPin("");
      } else if (pin === primero) {
        listoRef.current = true;
        const final = pin;
        setPin("");
        setPrimero(null);
        onListo(final);
      } else {
        setPin("");
        setPrimero(null);
        setError(true);
        setAviso("No coinciden. Empieza de nuevo");
        setSacudir((n) => n + 1);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [pin, primero, onListo]);

  // En computadora también se puede usar el teclado físico.
  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) pulsar(e.key);
      else if (e.key === "Backspace") pulsar("borrar");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pulsar]);

  return (
    <div className="tz-modal tz-pinp" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Crear PIN">
      <button className="tz-modal-close" onClick={onCancelar} aria-label="Cancelar">
        <X size={18} />
      </button>
      <div className="tz-pinp-icono" aria-hidden="true">
        <Smartphone size={26} />
      </div>
      <h3 className="tz-pinp-titulo">Pásale el celular{nombre ? ` a ${nombre}` : ""}</h3>
      <p className="tz-pinp-sub">Que escriba su PIN de 6 dígitos. Nadie más lo verá.</p>

      <div className={`tz-pinp-puntos ${error ? "is-error" : ""}`} key={sacudir} aria-live="polite">
        {Array.from({ length: LARGO }, (_, i) => (
          <span key={i} className={`tz-pinp-punto ${i < pin.length ? "is-lleno" : ""}`} />
        ))}
      </div>
      <p className={`tz-pinp-aviso ${error ? "is-error" : ""}`}>
        {error ? aviso : primero === null ? "Escribe tu PIN" : "Escríbelo otra vez para confirmar"}
      </p>

      <div className="tz-pinp-teclado">
        {TECLAS.map((t, i) =>
          t === "" ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              className={`tz-pinp-tecla ${t === "borrar" ? "is-borrar" : ""}`}
              onClick={() => pulsar(t)}
              aria-label={t === "borrar" ? "Borrar" : t}
            >
              {t === "borrar" ? <Delete size={20} /> : t}
            </button>
          )
        )}
      </div>

      {onAusente && (
        <button type="button" className="tz-entrada-menu-btn tz-pinp-ausente" onClick={onAusente}>
          <KeyRound size={15} /> {nombre ? `${nombre} no está aquí` : "No está aquí"}: enviar código
        </button>
      )}
    </div>
  );
}

function CodigoActivacion({ codigo, nombre, celular, onCerrar }) {
  const [copiado, setCopiado] = useState(false);
  const url = typeof window !== "undefined" ? window.location.origin : "";
  const mensaje =
    `Hola${nombre ? ` ${nombre}` : ""}, tu código para activar tu cuenta es *${codigo}*.\n\n` +
    `Entra a ${url}/login, escribe tu celular y este código, y crea tu PIN de 6 dígitos. ` +
    `El código sirve una sola vez y vence en 48 horas.`;
  const enlace = (celular && buildWhatsappLink(celular, mensaje)) || `https://wa.me/?text=${encodeURIComponent(mensaje)}`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      // sin portapapeles: el código igual está a la vista
    }
  };

  return (
    <div className="tz-modal tz-pinp" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Código de activación">
      <button className="tz-modal-close" onClick={onCerrar} aria-label="Cerrar">
        <X size={18} />
      </button>
      <div className="tz-pinp-icono" aria-hidden="true">
        <KeyRound size={26} />
      </div>
      <h3 className="tz-pinp-titulo">Código de activación</h3>
      <p className="tz-pinp-sub">
        {nombre ? `Pásaselo a ${nombre}. ` : ""}Sirve una sola vez y vence en 48 horas.
      </p>
      <div className="tz-pinp-codigo">{codigo}</div>
      <div className="tz-pinp-acciones">
        <a className="tz-entrada-menu-btn tz-pinp-accion" href={enlace} target="_blank" rel="noopener noreferrer">
          Enviar por WhatsApp
        </a>
        <button type="button" className="tz-entrada-menu-btn tz-pinp-accion" onClick={copiar}>
          {copiado ? <Check size={15} /> : <Copy size={15} />} {copiado ? "Copiado" : "Copiar código"}
        </button>
      </div>
      <p className="tz-pinp-nota">
        Al entrar por primera vez escribirá su celular, este código y su nuevo PIN.
      </p>
    </div>
  );
}

export function usePinPrivado() {
  const [pedido, setPedido] = useState(null); // { nombre, permitirAusente, resolver }
  const [codigo, setCodigo] = useState(null); // { codigo, nombre, celular }

  const pedirPin = useCallback(
    (nombre, { permitirAusente = true } = {}) =>
      new Promise((resolver) => setPedido({ nombre, permitirAusente, resolver })),
    []
  );

  const cerrarCon = (valor) => {
    pedido?.resolver(valor);
    setPedido(null);
  };

  const mostrarCodigo = useCallback((datos) => setCodigo(datos), []);

  const modalesPin =
    typeof document === "undefined"
      ? null
      : createPortal(
          <>
            {pedido && (
              <div className="tz-portal tz-modal-backdrop tz-modal-backdrop-nested tz-pinp-fondo">
                <TecladoPin
                  nombre={pedido.nombre}
                  onListo={(pin) => cerrarCon({ pin })}
                  onAusente={pedido.permitirAusente ? () => cerrarCon({ ausente: true }) : null}
                  onCancelar={() => cerrarCon(null)}
                />
              </div>
            )}
            {codigo && (
              <div className="tz-portal tz-modal-backdrop tz-modal-backdrop-nested tz-pinp-fondo">
                <CodigoActivacion
                  {...codigo}
                  onCerrar={() => {
                    const alCerrar = codigo.alCerrar;
                    setCodigo(null);
                    alCerrar?.();
                  }}
                />
              </div>
            )}
          </>,
          document.body
        );

  return { pedirPin, mostrarCodigo, modalesPin };
}
