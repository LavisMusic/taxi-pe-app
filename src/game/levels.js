import { BOSS, CRUMBLE, PHYSICS, SAW, SAW_SAFE_JUMP_RADIUS, TOTAL_LEVELS, tierForLevel } from "./constants";

/* 25 niveles hechos A MANO uno por uno no es viable ni verificable acá
   (no hay forma de jugar/ajustar cada mapa visualmente en esta sesión)
   — en su lugar, cada nivel se GENERA de forma procedural pero
   DETERMINISTA: la misma semilla (el índice del nivel) siempre produce
   exactamente el mismo mapa, así que "Nivel 7" es siempre el mismo
   Nivel 7 para cualquier jugador, se puede memorizar y compartir tips,
   y no cambia entre sesiones. La dificultad (huecos más anchos, más
   enemigos, más plataformas móviles/impulsores) escala con el índice
   según el tramo Fácil/Intermedio/Extremo. */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

function randInt(rng, min, max) {
  return Math.floor(randRange(rng, min, max + 1));
}

function shuffle(rng, arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Distancia máxima "cómoda" de salto con la física actual (v0*t con
// t = tiempo hasta el pico), usada para no generar huecos imposibles
// de cruzar. Se deja un margen (0.8) para que siempre sea generoso.
const MAX_JUMP_GAP =
  PHYSICS.maxRunSpeed * ((2 * Math.abs(PHYSICS.jumpVelocity)) / PHYSICS.gravity) * 0.8;

const TIER_PARAMS = {
  facil: {
    segments: [6, 8],
    gap: [50, Math.min(140, MAX_JUMP_GAP)],
    dy: 60,
    platformW: [150, 230],
    // Subido de 0.12 a 0.22 (casi el doble) — a pedido: más variedad
    // de plataformas móviles desde el principio, no solo a partir de
    // Intermedio.
    movingChance: 0.22,
    boosterChance: 0.05,
    enemyCount: [1, 2],
    enemySpeed: [45, 75],
    goldCount: 3,
  },
  intermedio: {
    segments: [9, 12],
    gap: [80, Math.min(190, MAX_JUMP_GAP)],
    dy: 90,
    platformW: [120, 200],
    movingChance: 0.32,
    boosterChance: 0.12,
    enemyCount: [2, 4],
    enemySpeed: [80, 120],
    goldCount: 4,
  },
  extremo: {
    segments: [13, 16],
    gap: [100, Math.min(220, MAX_JUMP_GAP)],
    dy: 120,
    platformW: [100, 170],
    movingChance: 0.42,
    boosterChance: 0.2,
    enemyCount: [4, 6],
    enemySpeed: [110, 165],
    goldCount: 5,
  },
};

const MIN_Y = 120;
const MAX_Y = 460;
const PLATFORM_H = 24;
const ENEMY_W = 30;
const ENEMY_H = 34;

export function generateLevel(levelIndex) {
  const tier = tierForLevel(levelIndex);
  const params = TIER_PARAMS[tier];
  const rng = mulberry32(1000 + levelIndex * 7919 + 17);
  // Se usa tanto para elegir qué arma dar (ver 'weapon-heavy' más
  // abajo) como para decidir si el nivel trae jefe — un solo cálculo,
  // reusado, en vez de repetir la misma comparación dos veces.
  const isBossLevel = levelIndex >= TOTAL_LEVELS - BOSS.levelsFromEnd;

  const platforms = [];
  let x = 0;
  let y = 420;
  let w = 260;
  platforms.push({ id: 0, x, y, w, h: PLATFORM_H, type: "static" });

  const segments = randInt(rng, params.segments[0], params.segments[1]);
  for (let i = 1; i <= segments; i++) {
    const gap = randRange(rng, params.gap[0], params.gap[1]);
    const dy = randRange(rng, -params.dy, params.dy);
    const newW = randRange(rng, params.platformW[0], params.platformW[1]);
    const newX = x + w + gap;
    const newY = Math.min(MAX_Y, Math.max(MIN_Y, y + dy));

    let type = "static";
    if (i === segments) {
      // La plataforma donde se apoya el portal (ver 'last' más abajo)
      // SIEMPRE es estática — pisar la meta y que encima se mueva bajo
      // los pies mientras terminás de juntar zaphitos es injusto, no
      // desafiante.
      type = "static";
    } else if (i === segments - 1) {
      // La plataforma INMEDIATAMENTE ANTES del portal nunca es
      // 'moving': saltar contra un blanco que se corre justo en el
      // tramo final (reportado en el Nivel 3 — la plataforma rosa
      // "dejaba pasar al vacío" o empujaba de vuelta) es frustración
      // de timing de física, no de habilidad. Acá es estática o
      // 'crumbling' (se derrumba con aviso de sobra para saltar) —
      // cruzarla es cuestión de reflejos, no de acertarle a un blanco
      // móvil.
      type = rng() < CRUMBLE.chance ? "crumbling" : "static";
    } else {
      const roll = rng();
      if (roll < params.boosterChance) {
        type = "booster";
      } else if (roll < params.boosterChance + params.movingChance) {
        type = "moving";
      }
    }

    const platform = { id: i, x: newX, y: newY, w: newW, h: PLATFORM_H, type };
    if (type === "crumbling") {
      platform.state = "idle";
      platform.timer = 0;
    } else if (type === "moving") {
      platform.axis = rng() < 0.5 ? "x" : "y";
      platform.amplitude = randRange(rng, 40, 90);
      platform.speed = randRange(rng, 0.6, 1.3);
      platform.phase = rng() * Math.PI * 2;
      platform.origin = { x: newX, y: newY };
    }

    platforms.push(platform);
    x = newX;
    y = newY;
    w = newW;
  }

  const last = platforms[platforms.length - 1];
  const portal = { x: last.x + last.w / 2 - 22, y: last.y - 74, w: 44, h: 74 };
  const levelWidth = last.x + last.w + 220;

  // Candidatos para colocar pickups/enemigos: cualquier plataforma
  // menos la de arranque y la del portal (para no bloquear el inicio
  // ni el final con algo encima).
  const candidates = shuffle(
    rng,
    platforms.slice(1, -1).length > 0 ? platforms.slice(1, -1) : [platforms[0]]
  );

  const collectibles = [];
  // OJO: guarda 'platformId' + offset RELATIVO al origen de la
  // plataforma anfitriona, no x/y absolutos — si la plataforma es de
  // tipo 'moving', engine.js recalcula la posición real del
  // coleccionable cada frame a partir de dónde está la plataforma EN
  // ESE MOMENTO (ver collectiblePosition()). Antes se guardaba la
  // posición fija del momento de generar el nivel, así que un
  // coleccionable sobre una plataforma móvil quedaba "flotando" en el
  // punto de origen mientras la plataforma se alejaba meciéndose —
  // este era el bug reportado en el Nivel 3 (perla verde vs.
  // plataforma rosa). x/y siguen viajando en el objeto como posición
  // INICIAL (para el primer render antes del primer tick), pero la
  // fuente de verdad en juego es platformId+offset.
  const pickAt = (platform, offset) => {
    const x = Math.min(platform.x + platform.w - 24, platform.x + 14 + offset);
    const y = platform.y - 34;
    return { x, y, platformId: platform.id, offsetX: x - platform.x, offsetY: y - platform.y };
  };

  const mandatory = [
    { type: "zaphito-azul", color: "azul" },
    { type: "zaphito-rojo", color: "rojo" },
    { type: "zaphito-verde", color: "verde" },
  ];
  mandatory.forEach((m, idx) => {
    const platform = candidates[idx % candidates.length];
    const pos = pickAt(platform, 0);
    collectibles.push({ id: `mand-${idx}`, type: m.type, collected: false, ...pos });
  });

  // El arma es SIEMPRE del nivel actual, no persiste entre niveles —
  // cada mapa tiene la suya propia. En los niveles con jefe se entrega
  // el arma PESADA (weapon-heavy) en vez de la normal, y a propósito
  // en una plataforma temprana (no en el orden aleatorio de
  // 'candidates') — así siempre llegás a la pelea final ya armado con
  // algo capaz de bajarle la vida rápido, en vez de encontrarla recién
  // cerca del jefe o no encontrarla del todo.
  const weaponPlatform = isBossLevel
    ? platforms[Math.min(2, Math.max(1, platforms.length - 2))]
    : candidates[mandatory.length % candidates.length];
  const weaponPos = pickAt(weaponPlatform, 30);
  collectibles.push({
    id: "weapon-0",
    type: isBossLevel ? "weapon-heavy" : "weapon",
    collected: false,
    ...weaponPos,
  });

  for (let g = 0; g < params.goldCount; g++) {
    const platform = candidates[(mandatory.length + 1 + g) % candidates.length];
    const pos = pickAt(platform, 30 + (g % 3) * 22);
    collectibles.push({
      id: `gold-${g}`,
      type: "zaphito-dorado",
      collected: false,
      ...pos,
    });
  }

  const enemyCount = randInt(rng, params.enemyCount[0], params.enemyCount[1]);
  const enemies = [];
  for (let e = 0; e < enemyCount; e++) {
    const platform = candidates[(e * 3) % candidates.length];
    const patrolMin = platform.x + 8;
    const patrolMax = Math.max(patrolMin, platform.x + platform.w - ENEMY_W - 8);
    enemies.push({
      id: `enemy-${e}`,
      x: randRange(rng, patrolMin, patrolMax),
      y: platform.y - ENEMY_H,
      w: ENEMY_W,
      h: ENEMY_H,
      vx: rng() < 0.5 ? -1 : 1,
      speed: randRange(rng, params.enemySpeed[0], params.enemySpeed[1]),
      patrolMin,
      patrolMax,
      health: 2,
      alive: true,
      hitFlash: 0,
    });
  }

  // ---- Sierras: una por hueco (con probabilidad SAW.chance[tier]),
  // nunca en huecos angostos (ahí ya casi no hay margen ni para saltar
  // el vacío). Chicas -> se apoyan a la altura del hueco, su diámetro
  // entra bajo la altura máxima de un salto normal (SAW_SAFE_JUMP_
  // RADIUS*2), así que se cruzan saltando por encima. Grandes -> el
  // diámetro YA NO entra bajo esa altura, así que se fuerzan a
  // moverse en X con una amplitud que en el extremo de su recorrido
  // libera el hueco por completo — se cruzan esperando esa ventana,
  // nunca saltando por encima. Es un criterio best-effort (no hay un
  // solver formal acá), pero garantiza que siempre exista un camino.
  const saws = [];
  for (let i = 0; i < platforms.length - 1; i++) {
    const a = platforms[i];
    const b = platforms[i + 1];
    const gapStart = a.x + a.w;
    const gapEnd = b.x;
    const gapWidth = gapEnd - gapStart;
    if (gapWidth < 50) continue;
    if (rng() >= SAW.chance[tier]) continue;

    const [minR, maxR] = SAW.radiusRange[tier];
    const radius = randRange(rng, minR, maxR);
    const cx = (gapStart + gapEnd) / 2;
    const groundY = Math.max(a.y, b.y);
    const isGiant = radius > SAW_SAFE_JUMP_RADIUS;

    if (isGiant) {
      const cy = Math.max(60, groundY - radius - 10);
      saws.push({
        id: `saw-${i}`,
        x: cx,
        y: cy,
        radius,
        type: "moving",
        axis: "x",
        amplitude: gapWidth / 2 + radius + 30,
        speed: randRange(rng, 0.35, 0.55),
        phase: rng() * Math.PI * 2,
        origin: { x: cx, y: cy },
      });
    } else {
      const cy = groundY - radius;
      const saw = { id: `saw-${i}`, x: cx, y: cy, radius, type: "static" };
      if (rng() < SAW.movingChance[tier]) {
        saw.type = "moving";
        saw.axis = rng() < 0.5 ? "x" : "y";
        saw.amplitude = randRange(rng, 20, Math.min(50, gapWidth / 2));
        saw.speed = randRange(rng, 0.6, 1.2);
        saw.phase = rng() * Math.PI * 2;
        saw.origin = { x: cx, y: cy };
      }
      saws.push(saw);
    }
  }

  // ---- Jefe final: solo en los últimos BOSS.levelsFromEnd niveles.
  // Flota (no usa la física de plataformas — un jefe gigante "parado"
  // en una plataforma normal se sentiría raro) cerca del portal, con
  // un rango corto de patrullaje horizontal.
  let boss = null;
  if (isBossLevel) {
    const centerX = Math.max(240, portal.x - 220);
    boss = {
      x: centerX - BOSS.w / 2,
      y: Math.max(80, last.y - 260),
      w: BOSS.w,
      h: BOSS.h,
      healthMax: BOSS.health,
      patrolMin: centerX - BOSS.patrolRange / 2 - BOSS.w / 2,
      patrolMax: centerX + BOSS.patrolRange / 2 - BOSS.w / 2,
    };
  }

  return {
    index: levelIndex,
    tier,
    width: levelWidth,
    playerStart: { x: 30, y: platforms[0].y - PHYSICS.playerH - 2 },
    platforms,
    collectibles,
    enemies,
    saws,
    boss,
    portal,
  };
}
