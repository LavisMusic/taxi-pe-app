import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Volume2, VolumeX, ChevronRight, SkipForward, Play, Moon, Mic } from "lucide-react";
import { supabase } from "../../supabaseClient";
import DonPeje from "./DonPeje";
import AuraVoz from "../chat/AuraVoz";
import { PASOS, leerEstado } from "./pasosGuia";
import { useEscucha, entenderOrden } from "./useEscucha";

// Don Peje (fase 1, sin IA).
//   * Despierto (el doble de grande; en el celular con un 12 % fuera de la
//     pantalla para no tapar tanto) guía paso a paso: abre la pantalla que
//     hace falta, pone el foco de luz en el campo, se para a su lado, lo mira
//     y le habla en un globo con el estilo glitch de la nube "Hacer cliente".
//   * Dormido: asomado en la esquina, con "Zzz". Tocarlo lo despierta: sigue
//     la guía si falta, o pregunta "¿Qué necesitas?".
//   * Micrófono (como el del chat, con su aura): entiende órdenes simples
//     ("siguiente", "a dormir", "la guía"…) hasta que llegue la IA.
//   * Se muestra u oculta desde Configuraciones (EVENTO_MASCOTA).
// El progreso va en la cuenta (0186, profiles.guia_don_peje).

export const EVENTO_GUIA_ABRIR = "tz-guia-abrir";
export const EVENTO_MASCOTA = "tz-mascota-visible";
const abrir = (detalle) => window.dispatchEvent(new CustomEvent(EVENTO_GUIA_ABRIR, { detail: detalle }));

const CLAVE_SONIDO = "tz-donpeje-sonido";
const leerSonido = () => {
  try {
    return localStorage.getItem(CLAVE_SONIDO) !== "0";
  } catch {
    return true;
  }
};

// Ancho útil SIN la barra de desplazamiento (con innerWidth el globo quedaba
// debajo de ella, cortado a la derecha).
const medirPantalla = () => ({ w: document.documentElement.clientWidth || window.innerWidth, h: window.innerHeight });
function usePantalla() {
  const [p, setP] = useState(medirPantalla);
  useEffect(() => {
    const f = () => setP(medirPantalla());
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return p;
}

// Pitidos de robot mientras escribe (Web Audio; recién tras un toque).
function usePitidos(activo) {
  const ctx = useRef(null);
  const despertar = useCallback(() => {
    try {
      if (!ctx.current) ctx.current = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.current.state === "suspended") ctx.current.resume();
    } catch {
      /* sin audio */
    }
  }, []);
  const pitido = useCallback(() => {
    const c = ctx.current;
    if (!activo || !c || c.state !== "running") return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "square";
    o.frequency.value = 480 + Math.random() * 320;
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.035, c.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.05);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.06);
  }, [activo]);
  return { despertar, pitido };
}

// Forma de la nube pixelada (esquinas en escalón) con la cola hacia Don
// Peje: abajo (globo encima de él) o arriba (globo debajo).
function formaNube(colaX, colaAbajo) {
  const X = `${Math.round(colaX)}px`;
  const c = (dx) => `calc(${X} ${dx < 0 ? "-" : "+"} ${Math.abs(dx)}px)`;
  if (colaAbajo) {
    const B = "calc(100% - 14px)";
    const b = (d) => `calc(100% - ${14 - d}px)`;
    return `polygon(0 8px, 4px 8px, 4px 4px, 8px 4px, 8px 0, calc(100% - 8px) 0, calc(100% - 8px) 4px, calc(100% - 4px) 4px,
      calc(100% - 4px) 8px, 100% 8px, 100% calc(100% - 22px), calc(100% - 4px) calc(100% - 22px), calc(100% - 4px) calc(100% - 18px),
      calc(100% - 8px) calc(100% - 18px), calc(100% - 8px) ${B}, ${c(14)} ${B}, ${c(14)} ${b(4)}, ${c(9)} ${b(4)}, ${c(9)} ${b(9)},
      ${c(4)} ${b(9)}, ${c(4)} 100%, ${c(-4)} 100%, ${c(-4)} ${b(9)}, ${c(-9)} ${b(9)}, ${c(-9)} ${b(4)}, ${c(-14)} ${b(4)},
      ${c(-14)} ${B}, 8px ${B}, 8px calc(100% - 18px), 4px calc(100% - 18px), 4px calc(100% - 22px), 0 calc(100% - 22px))`;
  }
  return `polygon(0 22px, 4px 22px, 4px 18px, 8px 18px, 8px 14px, ${c(-14)} 14px, ${c(-14)} 10px, ${c(-9)} 10px, ${c(-9)} 5px,
    ${c(-4)} 5px, ${c(-4)} 0, ${c(4)} 0, ${c(4)} 5px, ${c(9)} 5px, ${c(9)} 10px, ${c(14)} 10px, ${c(14)} 14px,
    calc(100% - 8px) 14px, calc(100% - 8px) 18px, calc(100% - 4px) 18px, calc(100% - 4px) 22px, 100% 22px,
    100% calc(100% - 8px), calc(100% - 4px) calc(100% - 8px), calc(100% - 4px) calc(100% - 4px), calc(100% - 8px) calc(100% - 4px),
    calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 4px), 4px calc(100% - 4px), 4px calc(100% - 8px), 0 calc(100% - 8px))`;
}

export default function GuiaDonPeje({ rol = "admin", negocioId, nombre = "", pausada = false }) {
  const pasosRol = PASOS[rol] || [];
  const pantalla = usePantalla();
  const movil = pantalla.w < 640;
  const despierto = { tam: movil ? 236 : 336 };
  const dormidoTam = movil ? 170 : 230;

  const [guia, setGuia] = useState(null); // { paso, terminada, dormido }
  const [oculta, setOculta] = useState(false);
  const [estado, setEstado] = useState(null);
  const [modo, setModo] = useState(null); // 'guia' | 'charla' | 'dormido'
  const [indice, setIndice] = useState(0);
  const [rect, setRect] = useState(null);
  const [mensaje, setMensaje] = useState(null); // { texto, emocion } (respuesta libre)
  const [oido, setOido] = useState(""); // lo que entendió del micrófono
  const [escrito, setEscrito] = useState("");
  const [sonido, setSonido] = useState(leerSonido);
  const motor = useRef(null);
  const { despertar: despertarAudio, pitido } = usePitidos(sonido);
  const primerNombre = (nombre || "").split(" ")[0] || "amigo";

  const pasos = useMemo(() => (estado ? pasosRol.filter((p) => !p.hecho || !p.hecho(estado)) : []), [pasosRol, estado]);
  const paso = modo === "guia" ? pasos[indice] : null;
  const tam = modo === "dormido" ? dormidoTam : despierto.tam;
  const tamH = Math.round(tam * 1.15);

  // ---- Cargar progreso, si se muestra y lo que ya tiene el negocio.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const [g, e] = await Promise.all([
        supabase.rpc("mi_guia_leer").then(({ data, error }) => (error ? {} : data || {})),
        leerEstado(rol, negocioId),
      ]);
      if (!vivo) return;
      const mio = g?.[rol] || {};
      setGuia(mio);
      setOculta(!!g?.mascota?.oculta);
      setEstado(e);
      setModo(mio.terminada || mio.dormido ? "dormido" : "guia");
    })();
    return () => {
      vivo = false;
    };
  }, [rol, negocioId]);

  // Mostrar / ocultar desde Configuraciones.
  useEffect(() => {
    const f = (e) => setOculta(!e.detail?.visible);
    window.addEventListener(EVENTO_MASCOTA, f);
    return () => window.removeEventListener(EVENTO_MASCOTA, f);
  }, []);

  // Retoma donde quedó.
  useEffect(() => {
    if (!pasos.length || !guia?.paso) return;
    const i = pasos.findIndex((p) => p.id === guia.paso);
    if (i > 0) setIndice(i);
    // solo al cargar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasos.length]);

  const guardar = useCallback(
    (cambios) => {
      setGuia((g) => {
        const nuevo = { ...(g || {}), ...cambios };
        supabase.rpc("mi_guia_guardar", { p_rol: rol, p_estado: nuevo }).then(() => {});
        return nuevo;
      });
    },
    [rol]
  );

  // ---- Cada paso: abre lo que hace falta, busca el objetivo y lo sigue.
  // Si lo que señala no existe en esta pantalla (p. ej. las gemas sin saldo),
  // ese paso se salta solo.
  const pasarRef = useRef(null);
  useEffect(() => {
    if (!paso) {
      setRect(null);
      return undefined;
    }
    let vivo = true;
    let cuadro = 0;
    if (paso.abrir) abrir(paso.abrir);
    setRect(null);
    const inicio = performance.now();
    let el = null;
    let ultimaBusqueda = 0;
    let vistoAlguna = false;
    const seguir = () => {
      if (!vivo) return;
      if (!el && !vistoAlguna && !paso.abrir && performance.now() - inicio > 2600) {
        pasarRef.current?.();
        return;
      }
      // Busca el objetivo (al principio cada cuadro; después, si se cerró la
      // pantalla, cada medio segundo por si la vuelve a abrir).
      if (!el && paso.objetivo && (performance.now() - inicio < 3500 || performance.now() - ultimaBusqueda > 500)) {
        ultimaBusqueda = performance.now();
        el = document.querySelector(paso.objetivo);
        if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      if (el && el.isConnected) {
        vistoAlguna = true;
        const r = el.getBoundingClientRect();
        setRect((prev) =>
          prev && Math.abs(prev.x - r.x) < 1 && Math.abs(prev.y - r.y) < 1 && Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1
            ? prev
            : { x: r.x, y: r.y, w: r.width, h: r.height }
        );
      } else if (el && !el.isConnected) {
        // Se cerró la pantalla (p. ej. el Perfil): el foco se quita.
        el = null;
        setRect(null);
      }
      cuadro = requestAnimationFrame(seguir);
    };
    if (paso.objetivo) cuadro = requestAnimationFrame(seguir);
    return () => {
      vivo = false;
      cancelAnimationFrame(cuadro);
    };
  }, [paso]);

  // ---- Lo que dice ahora: una respuesta libre, el paso o el "¿qué necesitas?".
  const texto = useMemo(() => {
    if (mensaje) return mensaje.texto;
    if (paso) return paso.texto.replace("{nombre}", primerNombre);
    if (modo === "charla") return `¡Hola de nuevo, ${primerNombre}! ¿Qué necesitas?`;
    return "";
  }, [mensaje, paso, modo, primerNombre]);
  const claveTexto = mensaje ? `m-${mensaje.id}` : paso ? `p-${paso.id}` : modo;

  useEffect(() => {
    if (!texto) return undefined;
    setEscrito("");
    let i = 0;
    const m = motor.current;
    if (mensaje) {
      m?.emocion(mensaje.emocion || "normal");
      if (mensaje.accion) m?.hacer(mensaje.accion);
    } else if (paso) {
      m?.emocion(paso.emocion || "normal");
      if (paso.accion) m?.hacer(paso.accion);
      else if (paso.objetivo) m?.hacer("senalar");
    } else {
      m?.emocion("feliz");
    }
    const t = setInterval(() => {
      i += 1;
      setEscrito(texto.slice(0, i));
      if (i % 2 === 0) {
        pitido();
        motor.current?.hablar(0.35 + Math.random() * 0.6);
      }
      if (i >= texto.length) {
        clearInterval(t);
        motor.current?.hablar(0);
      }
    }, 26);
    return () => {
      clearInterval(t);
      motor.current?.hablar(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveTexto, texto, pitido]);
  const escribiendo = escrito.length < texto.length;

  // ---- Posiciones.
  const donPos = useMemo(() => {
    const { w, h } = pantalla;
    if (modo === "dormido") return { x: Math.round(-tam * 0.28), y: Math.round(h - tamH * 0.74) };
    const corte = movil ? 0.12 : 0; // en el celular, un poco fuera de la pantalla
    const margen = movil ? 0 : 8;
    const esquina = (der, arriba) => ({
      x: Math.round(der ? w - tam * (1 - corte) - margen : -tam * corte + margen),
      y: Math.round(arriba ? margen : h - tamH * (1 - corte) - margen),
    });
    if (!rect) return esquina(false, false);
    if (!movil) {
      const y = Math.max(8, Math.min(h - tamH - 8, rect.y + rect.h / 2 - tamH * 0.6));
      if (rect.x + rect.w + 14 + tam <= w - 8) return { x: Math.round(rect.x + rect.w + 14), y: Math.round(y) };
      if (rect.x - tam - 14 >= 8) return { x: Math.round(rect.x - tam - 14), y: Math.round(y) };
    }
    const der = rect.x + rect.w / 2 < w / 2;
    const arriba = rect.y + rect.h > h - tamH * 0.85;
    return esquina(der, arriba);
  }, [pantalla, rect, modo, movil, tam, tamH]);

  // Mira hacia el objetivo.
  useEffect(() => {
    const m = motor.current;
    if (!m) return;
    if (!rect) {
      m.mirar(0, 0);
      return;
    }
    const cx = rect.x + rect.w / 2 - (donPos.x + tam / 2);
    const cy = rect.y + rect.h / 2 - (donPos.y + tamH * 0.4);
    m.mirar(cx / (pantalla.w / 2), cy / (pantalla.h / 2));
  }, [rect, donPos, pantalla, tam, tamH]);

  // Globo: sobre su cabeza (o debajo si no cabe), con la cola hacia él.
  // Celular: lo justo para que Siguiente, Saltar y el micrófono vayan en una fila.
  const anchoGlobo = movil ? Math.min(pantalla.w - 16, 340) : 360;
  // Alto real del globo (para no salirse por arriba de la pantalla).
  const globoRef = useRef(null);
  const [altoGlobo, setAltoGlobo] = useState(0);
  useLayoutEffect(() => {
    const el = globoRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setAltoGlobo(el.offsetHeight));
    ro.observe(el);
    setAltoGlobo(el.offsetHeight);
    return () => ro.disconnect();
  });
  const globo = useMemo(() => {
    const cabezaX = donPos.x + tam * 0.5;
    // El cuadro se corre hacia el lado libre y la cola apunta a la cabeza.
    const haciaIzq = cabezaX > pantalla.w / 2;
    const deseado = cabezaX - anchoGlobo * (haciaIzq ? 0.72 : 0.28);
    const left = Math.max(8, Math.min(pantalla.w - anchoGlobo - 8, deseado));
    const colaX = Math.max(26, Math.min(anchoGlobo - 26, cabezaX - left));
    const topeCabeza = donPos.y + tamH * 0.2;
    const arriba = topeCabeza > 240;
    let estilo = arriba
      ? { left, width: anchoGlobo, bottom: Math.round(pantalla.h - topeCabeza + 2) }
      : { left, width: anchoGlobo, top: Math.round(donPos.y + tamH * 0.92) };
    // No cabe encima: se pega arriba (sin salirse de la pantalla).
    if (arriba && altoGlobo && topeCabeza - altoGlobo < 8) estilo = { left, width: anchoGlobo, top: 8 };
    return { estilo, forma: formaNube(colaX, arriba), arriba };
  }, [donPos, tam, tamH, pantalla, anchoGlobo, altoGlobo]);

  // ---- Acciones.
  const decir = (texto2, extra = {}) => setMensaje({ id: Date.now(), texto: texto2, ...extra });

  const dormir = useCallback(() => {
    setMensaje(null);
    setOido("");
    abrir({ cerrar: true });
    guardar({ dormido: true });
    setModo("dormido");
  }, [guardar]);

  const avanzar = () => {
    despertarAudio();
    if (escribiendo) {
      setEscrito(texto);
      motor.current?.hablar(0);
      return;
    }
    if (mensaje) {
      setMensaje(null);
      setOido("");
      return;
    }
    pasarPaso();
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    pasarRef.current = pasarPaso;
  });
  // Siguiente paso de la guía (o el final: celebra y se duerme).
  const pasarPaso = () => {
    setMensaje(null);
    if (modo !== "guia") return;
    if (indice >= pasos.length - 1) {
      guardar({ paso: null, terminada: true });
      motor.current?.hacer("celebrar");
      abrir({ cerrar: true });
      setTimeout(dormir, 1600);
      return;
    }
    const sig = pasos[indice + 1];
    guardar({ paso: sig.id, terminada: false });
    setIndice(indice + 1);
  };

  const empezarGuia = async () => {
    despertarAudio();
    setMensaje(null);
    setOido("");
    const e = await leerEstado(rol, negocioId);
    setEstado(e);
    setIndice(0);
    guardar({ terminada: false, paso: null, dormido: false });
    setModo("guia");
  };

  const despertar = () => {
    despertarAudio();
    motor.current?.hacer("despertar");
    guardar({ dormido: false });
    setModo(guia?.terminada ? "charla" : "guia");
  };

  // En la charla, si nadie le hace caso, se vuelve a dormir.
  useEffect(() => {
    if (modo !== "charla" || mensaje) return undefined;
    const t = setTimeout(dormir, 30000);
    return () => clearTimeout(t);
  }, [modo, mensaje, dormir]);

  // ---- Micrófono.
  const alOir = (dicho) => {
    if (dicho === null) {
      decir("No pude usar el micrófono. Revisa que la app tenga permiso para escucharte.", { emocion: "triste" });
      return;
    }
    if (!dicho) {
      decir("No te escuché bien… ¿lo intentas otra vez?", { emocion: "normal" });
      return;
    }
    setOido(dicho);
    const orden = entenderOrden(dicho);
    if (orden === "dormir") {
      decir("¡Hasta luego! Me echo una siestita. Tócame cuando me necesites.", { emocion: "feliz" });
      setTimeout(dormir, 2600);
    } else if (orden === "siguiente" || orden === "saltar") {
      if (modo === "guia") {
        setMensaje(null);
        setOido("");
        pasarPaso();
      } else decir("Ahora no estamos en la guía. Si quieres, te la muestro.", {});
    } else if (orden === "guia") {
      if (modo === "guia") decir("¡Ya estamos en la guía! Sigamos con este paso.", { accion: "asentir" });
      else empezarGuia();
    } else if (orden === "quien") {
      decir("Soy Don Peje, tu robot asistente. Estoy aquí para ayudarte con todo lo que necesites en la app.", { accion: "saludar", emocion: "feliz" });
    } else if (orden === "hola") {
      decir(`¡Hola, ${primerNombre}! ¿En qué te ayudo?`, { accion: "saludar", emocion: "feliz" });
    } else if (orden === "gracias") {
      decir("¡De nada! Para eso estoy.", { accion: "asentir", emocion: "feliz" });
    } else {
      decir(
        "Todavía estoy aprendiendo a entender todo lo que me dices. Muy pronto podré responderte y hacer cosas por ti. Por ahora puedo guiarte o echarme una siesta.",
        { accion: "negar" }
      );
    }
  };
  const escucha = useEscucha(alOir);
  const alternarMic = () => {
    despertarAudio();
    // Tocar de nuevo cancela (no se envía lo dicho).
    if (escucha.escuchando) escucha.cancelar();
    else {
      setOido("");
      escucha.iniciar();
    }
  };
  useEffect(() => {
    motor.current?.mirar(0, escucha.escuchando ? -0.2 : 0);
    if (escucha.escuchando) motor.current?.emocion("normal");
  }, [escucha.escuchando]);

  const alternarSonido = () => {
    despertarAudio();
    setSonido((s) => {
      try {
        localStorage.setItem(CLAVE_SONIDO, s ? "0" : "1");
      } catch {
        /* sin almacenamiento */
      }
      return !s;
    });
  };

  if (!modo || oculta || !estado || pausada) return null;
  const hablando = modo !== "dormido" && (texto || escucha.escuchando);

  return (
    <>
      {paso && rect && !mensaje &&
        createPortal(
          <div
            className="tz-guia-foco tz-portal"
            style={{ left: rect.x - 8, top: rect.y - 8, width: rect.w + 16, height: rect.h + 16 }}
            aria-hidden="true"
          />,
          document.body
        )}
      <DonPeje
        pos={donPos}
        tam={tam}
        dormido={modo === "dormido"}
        onListo={(m) => {
          motor.current = m;
          if (m && paso?.accion) m.hacer(paso.accion);
        }}
        onClick={modo === "dormido" ? despertar : undefined}
        etiqueta={modo === "dormido" ? "Despertar a Don Peje" : "Don Peje"}
      />
      {hablando &&
        createPortal(
          <div
            className={`tz-guia-globo tz-portal ${globo.arriba ? "is-arriba" : "is-abajo"} ${movil ? "is-movil" : ""}`}
            style={globo.estilo}
            ref={globoRef}
            key={claveTexto}
            role="dialog"
            aria-label="Don Peje"
          >
            <div className="tz-guia-forma" style={{ clipPath: globo.forma }}>
              <div className="tz-guia-globo-cabeza">
                <strong className="tz-guia-glitch" data-texto="DON PEJE">
                  DON PEJE
                </strong>
                {paso && !mensaje && paso.id !== "hola" && paso.id !== "fin" && (
                  <span className="tz-guia-progreso">
                    {pasos.map((p, i) => (
                      <i key={p.id} className={i < indice ? "is-hecho" : i === indice ? "is-actual" : ""} />
                    ))}
                  </span>
                )}
                <button type="button" className="tz-guia-icono" onClick={alternarSonido} aria-label={sonido ? "Silenciar" : "Activar sonido"}>
                  {sonido ? <Volume2 size={15} /> : <VolumeX size={15} />}
                </button>
                <button type="button" className="tz-guia-icono" onClick={dormir} aria-label="Dormir a Don Peje" title="A dormir">
                  <Moon size={15} />
                </button>
              </div>

              {escucha.escuchando ? (
                <div className="tz-guia-escucha">
                  <div className="tz-guia-aura">
                    <AuraVoz analizador={escucha.analizador}>
                      <span className="tz-guia-escucha-texto">Te escucho…</span>
                    </AuraVoz>
                  </div>
                  {escucha.texto && <p className="tz-guia-oido">«{escucha.texto}»</p>}
                </div>
              ) : (
                <>
                  {oido && <p className="tz-guia-oido">Dijiste: «{oido}»</p>}
                  <p className="tz-guia-texto" onClick={avanzar}>
                    <span className="tz-guia-glitch" data-texto={escrito}>
                      {escrito}
                    </span>
                    {escribiendo && <span className="tz-guia-cursor" />}
                  </p>
                </>
              )}

              <div className="tz-guia-acciones">
                {!escucha.escuchando && (
                  <>
                    {mensaje ? (
                      <button type="button" className="tz-guia-btn is-principal" onClick={avanzar}>
                        {modo === "guia" ? "Seguir" : "Ok"} <ChevronRight size={15} />
                      </button>
                    ) : modo === "charla" ? (
                      <button type="button" className="tz-guia-btn is-principal" onClick={empezarGuia}>
                        <Play size={14} /> Ver la guía otra vez
                      </button>
                    ) : (
                      paso && (
                        <>
                          <button type="button" className="tz-guia-btn is-principal" onClick={avanzar}>
                            {paso.boton || "Siguiente"} <ChevronRight size={15} />
                          </button>
                          {paso.id !== "hola" && paso.id !== "fin" && (
                            <button type="button" className="tz-guia-btn" onClick={avanzar}>
                              <SkipForward size={14} /> Saltar
                            </button>
                          )}
                        </>
                      )
                    )}
                  </>
                )}
                <button
                  type="button"
                  className={`tz-entrada-accion is-mic tz-guia-mic ${escucha.escuchando ? "is-grabando" : ""}`}
                  onClick={alternarMic}
                  aria-label={escucha.escuchando ? "Dejar de escuchar" : "Hablarle a Don Peje"}
                  title={escucha.escuchando ? "Dejar de escuchar" : "Háblale"}
                >
                  <Mic size={19} />
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
