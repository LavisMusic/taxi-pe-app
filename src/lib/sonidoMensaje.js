// Sonido de mensaje nuevo (chats "Taxi PE" / "Tonazo"): dos notas cortas
// y brillantes en subida, tipo sintetizador, a tono con la estética neón.
// Se genera con Web Audio (sin archivos). El navegador no deja sonar nada
// hasta que la persona toca la página, así que el contexto se "despierta"
// con su primer toque.
let ctx = null;

function contexto() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

if (typeof window !== "undefined") {
  const despertar = () => {
    const c = contexto();
    if (c && c.state === "suspended") c.resume().catch(() => {});
    window.removeEventListener("pointerdown", despertar);
    window.removeEventListener("keydown", despertar);
  };
  window.addEventListener("pointerdown", despertar);
  window.addEventListener("keydown", despertar);
}

// Una nota: un seno con un triángulo apenas desafinado encima (brillo),
// ataque rápido y caída suave.
function nota(c, frecuencia, inicio, duracion, volumen) {
  const salida = c.createGain();
  salida.gain.setValueAtTime(0.0001, inicio);
  salida.gain.exponentialRampToValueAtTime(volumen, inicio + 0.012);
  salida.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
  salida.connect(c.destination);

  [
    { tipo: "sine", detune: 0, peso: 1 },
    { tipo: "triangle", detune: 7, peso: 0.35 },
  ].forEach(({ tipo, detune, peso }) => {
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(frecuencia, inicio);
    osc.detune.setValueAtTime(detune, inicio);
    g.gain.value = peso;
    osc.connect(g).connect(salida);
    osc.start(inicio);
    osc.stop(inicio + duracion + 0.02);
  });
}

export function sonarMensaje() {
  const c = contexto();
  if (!c || c.state !== "running") return;
  const t = c.currentTime + 0.01;
  nota(c, 880, t, 0.16, 0.09); // La5
  nota(c, 1318.5, t + 0.09, 0.32, 0.08); // Mi6
}
