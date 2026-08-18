// Easter Egg: minijuego arcade 2D estilo FRIV, oculto tras 5 clics
// rápidos en el logo. Todo lo que se pueda ajustar (física, colores,
// personajes) vive acá para no tener números mágicos repartidos entre
// el generador de niveles, el motor y el componente de React.

export const CANVAS_W = 960;
export const CANVAS_H = 540;

// Unidades en px/segundo (no px/frame) — el loop del juego corre con
// paso de tiempo fijo (ver engine.js), así que la física es estable
// sin importar el refresh rate real de la pantalla del jugador.
export const PHYSICS = {
  gravity: 2000,
  moveAccel: 3400,
  maxRunSpeed: 260,
  friction: 2600,
  jumpVelocity: -680,
  boosterVelocity: -1050,
  maxFallSpeed: 900,
  playerW: 28,
  playerH: 40,
};

export const COMBAT = {
  meleeRange: 34,
  meleeHeight: 40,
  meleeDamage: 1,
  meleeCooldown: 0.35,
  projectileSpeed: 620,
  projectileDamage: 1,
  projectileCooldown: 0.28,
  projectileLifetime: 1.4,
  enemyHealth: 2,
  enemyTouchInvulnerability: 0.2,
  // Arma pesada: aparece SOLO en los niveles con jefe (ver
  // BOSS.levelsFromEnd), temprano en el mapa — para que llegues a la
  // pelea final ya armado con algo capaz de bajarle la vida rápido y
  // "despejar el paso" al portal en vez de tener que esquivarlo 14
  // golpes de la pistola normal. Más daño por disparo, un poco más
  // lenta entre tiro y tiro (no es gratis, sigue habiendo timing).
  heavyProjectileSpeed: 560,
  heavyProjectileDamage: 4,
  heavyProjectileCooldown: 0.45,
  heavyProjectileLifetime: 1.4,
};

// Altura máxima del arco de salto normal (v0^2 / 2g) — se usa para
// decidir qué tan grande puede ser una sierra "saltable por encima"
// sin volverse imposible con la física actual. Con un 10% de margen
// de seguridad (0.9), para que quede holgado y no al pixel exacto.
export const JUMP_APEX_CLEARANCE = Math.abs(
  (PHYSICS.jumpVelocity * PHYSICS.jumpVelocity) / (2 * PHYSICS.gravity)
) * 0.9;
// Radio máximo de una sierra "chica" (saltable): su DIÁMETRO tiene que
// entrar bajo esa altura de salto.
export const SAW_SAFE_JUMP_RADIUS = JUMP_APEX_CLEARANCE / 2;

// Sierras: chicas -> se saltan por encima (radio <= SAW_SAFE_JUMP_RADIUS).
// Grandes -> se cruzan por TEMPORIZACIÓN (siempre móviles, con
// amplitud calculada en levels.js para que en algún punto de su
// recorrido liberen el hueco por completo), no saltando por encima.
export const SAW = {
  radiusRange: {
    facil: [14, 28],
    intermedio: [18, 42],
    extremo: [22, 85],
  },
  chance: { facil: 0.22, intermedio: 0.38, extremo: 0.55 },
  movingChance: { facil: 0.2, intermedio: 0.4, extremo: 0.55 },
};

// Aves: cruzan la pantalla de tanto en tanto y sueltan UNA bomba
// apuntando a donde estaba el jugador al momento de aparecer (no lo
// persiguen después — es una "mirada previa" esquivable, no un
// misil teledirigido). "5 de 10" = spawnChance 0.5 (el valor base,
// Intermedio) — escala por dificultad: en Fácil aparecen menos
// seguido y con menos probabilidad, en Extremo mucho más de ambas
// cosas. updateBirdsAndBombs (engine.js) lee 'world.level.tier' para
// elegir el set correcto en cada intento de aparición.
export const BIRD = {
  intervalRangeByTier: {
    facil: [6, 10],
    intermedio: [4.5, 7],
    extremo: [3, 5.5],
  },
  spawnChanceByTier: {
    facil: 0.35,
    intermedio: 0.5,
    extremo: 0.65,
  },
  speed: 230,
  bombRadius: 9,
  bombGravity: 1400,
};

// Jefes finales: solo en los últimos 3 niveles (ver tierForLevel /
// generateLevel). Flotan (no usan la física de plataformas — un jefe
// gigante "parado" en una plataforma normal se vería y sentiría raro),
// patrullan un rango corto y disparan un rayo apuntado hacia el
// jugador. Ese rayo reutiliza el sistema de proyectiles existente
// (owner:'boss') y SÍ daña a los enemigos comunes de paso.
export const BOSS = {
  levelsFromEnd: 3,
  w: 120,
  h: 140,
  health: 14,
  patrolSpeed: 45,
  patrolRange: 160,
  rayCooldown: 1.5,
  raySpeed: 380,
  rayW: 20,
  rayH: 8,
  meleeContactIsHazard: true,
};

// Plataforma "quebradiza": sólida hasta que el jugador se para en
// ella, entonces empieza a temblar/desvanecerse y desaparece del todo
// pasados 'shakeDuration' segundos — deliberadamente NUNCA se mueve
// (a diferencia de 'moving'), para que cruzarla sea cuestión de
// reflejos/tiempo, no de acertarle a un blanco móvil. Se usa sobre
// todo en la plataforma justo antes del portal (ver levels.js), que
// ahora nunca es 'moving' — reemplaza el diseño anterior que hacía
// que la última plataforma antes de la meta "se corriera" del salto.
export const CRUMBLE = {
  chance: 0.5, // probabilidad de que esa plataforma sea crumbling en vez de simplemente estática
  shakeDuration: 1.3, // segundos de aviso, de sobra para saltar a la plataforma del portal
};

export const COLORS = {
  bg: "#050310",
  bgGrid: "rgba(43,232,255,0.05)",
  platform: "#2be8ff",
  moving: "#ff2f9e",
  booster: "#ffe066",
  crumbling: "#ffb454",
  enemy: "#ff3b4d",
  zaphitoAzul: "#3b82ff",
  zaphitoRojo: "#ff3b4d",
  zaphitoVerde: "#3bff7a",
  zaphitoDorado: "#ffd43b",
  weapon: "#d7ff3b",
  weaponHeavy: "#ff5e2c",
  projectilePlayer: "#2be8ff",
  projectileHeavy: "#ff5e2c",
  projectileEnemy: "#ff3b4d",
  portalLocked: "#4b3b6b",
  portalActive: "#b98bff",
  text: "#e8f6ff",
  textDim: "#8fa3c8",
  saw: "#c8d6e5",
  bird: "#ff9f43",
  bomb: "#ff3b4d",
  boss: "#b91cff",
  bossRay: "#ff2fe0",
};

// 'accent' decide un pequeño rasgo extra que se dibuja sobre la
// silueta neón base (ver drawPlayer en EasterEggGame.jsx) — como no
// hay sprites/imágenes, la diferencia entre personajes es color +
// un detalle vectorial simple, no un dibujo distinto por completo.
export const CHARACTERS = [
  { id: "clasico", name: "Zaph Clásico", color: "#2be8ff", accent: "none", cost: 0 },
  { id: "cyber", name: "Zaph Cyber", color: "#ff2f9e", accent: "antena", cost: 50 },
  { id: "ninja", name: "Zaph Ninja", color: "#3bff7a", accent: "banda", cost: 120 },
  { id: "fuego", name: "Zaph Fuego", color: "#ff9f43", accent: "llama", cost: 200 },
  { id: "real", name: "Zaph Real", color: "#ffd43b", accent: "corona", cost: 400 },
];

export const EASY_LEVELS = 10;
export const MEDIUM_LEVELS = 10;
export const EXTREME_LEVELS = 5;
export const TOTAL_LEVELS = EASY_LEVELS + MEDIUM_LEVELS + EXTREME_LEVELS;

export const SAVE_KEY = "tonazo_arcade_save_v1";

export function tierForLevel(levelIndex) {
  if (levelIndex < EASY_LEVELS) return "facil";
  if (levelIndex < EASY_LEVELS + MEDIUM_LEVELS) return "intermedio";
  return "extremo";
}
