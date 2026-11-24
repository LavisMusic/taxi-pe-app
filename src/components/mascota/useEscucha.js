import { useCallback, useEffect, useRef, useState } from "react";

// Micrófono de Don Peje: abre el micrófono para el aura (AnalyserNode, la
// misma esfera de luz del chat) y, si el navegador lo tiene, el
// reconocimiento de voz para entender lo que se dice (texto parcial en vivo
// y el final). Un silencio lo termina y entrega lo dicho (`alTerminar(texto)`);
// `cancelar()` (tocar el micrófono de nuevo) lo corta sin enviar nada.
export function useEscucha(alTerminar) {
  const [escuchando, setEscuchando] = useState(false);
  const [texto, setTexto] = useState("");
  const rec = useRef(null);
  const audio = useRef(null); // { stream, ctx, analyser }
  const final = useRef("");
  const cancelado = useRef(false);
  const fin = useRef(alTerminar);
  fin.current = alTerminar;

  const analizador = useCallback(() => audio.current?.analyser ?? null, []);

  const cerrarAudio = () => {
    const a = audio.current;
    audio.current = null;
    a?.stream?.getTracks().forEach((t) => t.stop());
    a?.ctx?.close?.().catch(() => {});
  };

  const detener = useCallback(() => {
    if (rec.current) {
      try {
        rec.current.stop();
      } catch {
        /* ya detenido */
      }
      return; // el texto final llega en onend
    }
    cerrarAudio();
    setEscuchando(false);
    fin.current?.(final.current.trim());
  }, []);

  // Corta la escucha sin enviar lo dicho.
  const cancelar = useCallback(() => {
    cancelado.current = true;
    const r = rec.current;
    rec.current = null;
    try {
      r?.abort();
    } catch {
      /* ya detenido */
    }
    cerrarAudio();
    setEscuchando(false);
    setTexto("");
  }, []);

  const iniciar = useCallback(async () => {
    if (escuchando) return;
    cancelado.current = false;
    final.current = "";
    setTexto("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      audio.current = { stream, ctx, analyser };
    } catch {
      fin.current?.(null); // sin permiso de micrófono
      return;
    }
    if (cancelado.current) {
      // Se canceló mientras se pedía el permiso.
      cerrarAudio();
      return;
    }
    setEscuchando(true);
    const Reconocer = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Reconocer) return; // sin reconocimiento: solo aura, se detiene a mano
    const r = new Reconocer();
    r.lang = "es-PE";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let parcial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final.current += t;
        else parcial += t;
      }
      setTexto((final.current + " " + parcial).trim());
    };
    r.onerror = () => {};
    r.onend = () => {
      if (rec.current === r) rec.current = null;
      cerrarAudio();
      setEscuchando(false);
      if (!cancelado.current) fin.current?.(final.current.trim());
    };
    rec.current = r;
    try {
      r.start();
    } catch {
      rec.current = null;
    }
  }, [escuchando]);

  useEffect(
    () => () => {
      try {
        rec.current?.abort();
      } catch {
        /* nada */
      }
      cerrarAudio();
    },
    []
  );

  return { escuchando, texto, analizador, iniciar, detener, cancelar };
}

// Órdenes simples (sin IA todavía): qué quiso decir.
const sinTildes = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export function entenderOrden(texto) {
  const t = sinTildes(texto);
  if (!t) return "nada";
  if (/(duerm|dormir|descansa|chau|adios|hasta luego)/.test(t)) return "dormir";
  if (/(siguiente|listo|ya esta|continua|sigue|avanza)/.test(t)) return "siguiente";
  if (/(salta|omit|despues)/.test(t)) return "saltar";
  if (/(guia|ayuda|configur|empez|ensena)/.test(t)) return "guia";
  if (/(quien eres|como te llamas|tu nombre)/.test(t)) return "quien";
  if (/(hola|buen(os|as) (dias|tardes|noches)|que tal)/.test(t)) return "hola";
  if (/(gracias)/.test(t)) return "gracias";
  return "otra";
}
