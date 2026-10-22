// Sonido de mensaje nuevo (chats "Taxi PE" / "Tonazo"): dos notas cortas
// y brillantes en subida, tipo sintetizador, a tono con la estética neón.
// Se genera con Web Audio (sin archivos).
//
// Navegadores, y sobre todo iPhone (Safari):
//   - el audio queda "bloqueado" hasta un toque de la persona: el contexto
//     se crea y se desbloquea dentro de ese toque (con un sonido mudo,
//     como pide iOS) y se sigue intentando en cada toque hasta lograrlo;
//   - al pasar la app a segundo plano iOS lo suspende ("interrupted"): al
//     volver se reanuda, y si igual está suspendido al sonar se reanuda
//     antes de tocar las notas;
//   - el interruptor de silencio del iPhone apaga el sonido web.
let ctx = null;

function contexto() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

const EVENTOS = ["touchend", "pointerdown", "click", "keydown"];

function desbloquear() {
  const c = contexto();
  if (!c) return;
  // iOS solo libera el audio si algo suena dentro del gesto: un búfer mudo.
  try {
    const buf = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(0);
  } catch {
    // sin búfer: igual se intenta reanudar
  }
  if (c.state !== "running") c.resume().catch(() => {});
  if (c.state === "running") EVENTOS.forEach((e) => window.removeEventListener(e, desbloquear, true));
}

if (typeof window !== "undefined") {
  EVENTOS.forEach((e) => window.addEventListener(e, desbloquear, true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ctx && ctx.state !== "running") ctx.resume().catch(() => {});
  });
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

function tocar(c) {
  const t = c.currentTime + 0.01;
  nota(c, 880, t, 0.16, 0.12); // La5
  nota(c, 1318.5, t + 0.09, 0.32, 0.1); // Mi6
}

export function sonarMensaje() {
  const c = contexto();
  if (!c) return;
  if (c.state === "running") {
    tocar(c);
    return;
  }
  c.resume()
    .then(() => {
      if (c.state === "running") tocar(c);
    })
    .catch(() => {});
}
