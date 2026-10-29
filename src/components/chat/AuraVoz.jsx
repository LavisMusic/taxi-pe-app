import { useEffect, useRef } from "react";

// Aura de la grabación (nota de voz): una esfera de luz arcoíris, como la
// de Siri, que crece, brilla, se deforma y gira según lo que se habla — en
// silencio queda casi quieta (no es una animación en bucle). Dibujada en un
// canvas para verse igual sobre cualquier tema. Con `cancelar`, roja.
// `analizador()`: el AnalyserNode del micrófono (o null).
// `children`: lo que va al centro (el contador).
const TAM = 240;
const PUNTOS = 72;

export default function AuraVoz({ analizador, cancelar = false, children }) {
  const canvasRef = useRef(null);
  const cancelarRef = useRef(cancelar);
  cancelarRef.current = cancelar;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = TAM * dpr;
    canvas.height = TAM * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const c = TAM / 2;
    let raf;
    let nivel = 0;
    let giro = 0;
    let suavizado = new Float32Array(PUNTOS);
    let frec = null;
    let onda = null;

    const dibujar = () => {
      const an = analizador?.();
      let rms = 0;
      if (an) {
        frec = frec || new Uint8Array(an.frequencyBinCount);
        onda = onda || new Uint8Array(an.fftSize);
        an.getByteFrequencyData(frec);
        an.getByteTimeDomainData(onda);
        let suma = 0;
        for (let i = 0; i < onda.length; i++) {
          const v = (onda[i] - 128) / 128;
          suma += v * v;
        }
        rms = Math.min(1, Math.sqrt(suma / onda.length) * 3.2);
      }
      // Sube rápido con la voz y baja suave.
      nivel += (rms - nivel) * (rms > nivel ? 0.35 : 0.08);
      giro += 0.002 + nivel * 0.06;

      // Deformación por punto según las frecuencias (simétrica, sin cortes).
      for (let i = 0; i < PUNTOS; i++) {
        const j = i < PUNTOS / 2 ? i : PUNTOS - 1 - i;
        const v = frec ? frec[Math.min(frec.length - 1, 2 + Math.floor((j / (PUNTOS / 2)) * frec.length * 0.55))] / 255 : 0;
        suavizado[i] += (v - suavizado[i]) * 0.25;
      }

      ctx.clearRect(0, 0, TAM, TAM);
      const rojo = cancelarRef.current;
      const base = TAM * 0.2 + nivel * TAM * 0.07;

      // Halo exterior.
      const halo = ctx.createRadialGradient(c, c, base * 0.6, c, c, base * 2.2);
      halo.addColorStop(0, rojo ? `rgba(255,70,100,${0.25 + nivel * 0.4})` : `rgba(140,120,255,${0.22 + nivel * 0.4})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, TAM, TAM);

      ctx.save();
      // Capas superpuestas con transparencia (sumarlas con 'lighter' o
      // 'screen' quema el arcoíris a blanco).
      ctx.globalCompositeOperation = "source-over";
      // Tres capas de luz desfasadas: el arcoíris gira con la voz.
      for (let capa = 0; capa < 3; capa++) {
        const desfase = giro * (capa % 2 ? -1 : 1) + capa * 2.1;
        ctx.beginPath();
        for (let i = 0; i <= PUNTOS; i++) {
          const k = i % PUNTOS;
          const ang = (k / PUNTOS) * Math.PI * 2;
          const ondula = Math.sin(ang * (3 + capa) + desfase * 3) * nivel * TAM * 0.025;
          const r = base * (1 - capa * 0.07) + suavizado[k] * TAM * (0.09 - capa * 0.02) + ondula;
          const x = c + Math.cos(ang + desfase) * r;
          const y = c + Math.sin(ang + desfase) * r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        let relleno;
        if (ctx.createConicGradient && !rojo) {
          relleno = ctx.createConicGradient(desfase, c, c);
          ["#ff3b6b", "#ffb52e", "#f6ff4a", "#39ffb0", "#2be8ff", "#6c5bff", "#ff4fd8", "#ff3b6b"].forEach((col, n, arr) =>
            relleno.addColorStop(n / (arr.length - 1), col)
          );
        } else {
          relleno = ctx.createRadialGradient(c, c, 0, c, c, base * 1.3);
          relleno.addColorStop(0, rojo ? "#ff6b85" : "#8a7bff");
          relleno.addColorStop(1, rojo ? "#ff2f55" : "#2be8ff");
        }
        ctx.globalAlpha = (capa === 0 ? 0.9 : capa === 1 ? 0.55 : 0.4) * (0.75 + nivel * 0.25);
        ctx.shadowColor = rojo ? "#ff3b5c" : capa === 0 ? "#2be8ff" : capa === 1 ? "#ff4fd8" : "#a6ff4a";
        ctx.shadowBlur = 10 + nivel * 26;
        ctx.fillStyle = relleno;
        ctx.fill();
      }
      ctx.restore();

      // Corazón oscuro para que se lea el contador.
      const centro = ctx.createRadialGradient(c, c, 0, c, c, base * 0.9);
      centro.addColorStop(0, "rgba(8,6,20,0.95)");
      centro.addColorStop(0.55, "rgba(8,6,20,0.75)");
      centro.addColorStop(1, "rgba(8,6,20,0)");
      ctx.fillStyle = centro;
      ctx.beginPath();
      ctx.arc(c, c, base * 0.9, 0, Math.PI * 2);
      ctx.fill();

      // Anillo de partículas (como la referencia), que se abre con la voz.
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 90; i++) {
        const ang = (i / 90) * Math.PI * 2 + giro * 0.5;
        const v = suavizado[Math.floor((i / 90) * PUNTOS)];
        const r = base * 1.28 + v * TAM * 0.08;
        ctx.fillStyle = rojo ? `rgba(255,120,140,${0.25 + v * 0.7})` : `hsla(${(i * 4 + giro * 80) % 360},100%,72%,${0.25 + v * 0.7})`;
        ctx.beginPath();
        ctx.arc(c + Math.cos(ang) * r, c + Math.sin(ang) * r, 1.1 + v * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      raf = requestAnimationFrame(dibujar);
    };
    raf = requestAnimationFrame(dibujar);
    return () => cancelAnimationFrame(raf);
  }, [analizador]);

  return (
    <div className="tz-aura" style={{ width: TAM, height: TAM }}>
      <canvas ref={canvasRef} style={{ width: TAM, height: TAM }} />
      <div className="tz-aura-centro">{children}</div>
    </div>
  );
}
