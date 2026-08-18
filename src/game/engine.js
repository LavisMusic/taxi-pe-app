import { BIRD, BOSS, CANVAS_W, COLORS, COMBAT, CRUMBLE, PHYSICS } from "./constants";

const COLLECT_SIZE = 26;

function randRangeRuntime(min, max) {
  return min + Math.random() * (max - min);
}

export function createWorldFromLevel(level) {
  const deathY = level.platforms.reduce((m, p) => Math.max(m, p.y), 0) + 400;
  return {
    level,
    deathY,
    player: {
      x: level.playerStart.x,
      y: level.playerStart.y,
      w: PHYSICS.playerW,
      h: PHYSICS.playerH,
      vx: 0,
      vy: 0,
      onGround: false,
      facing: 1,
      hasWeapon: false,
      weaponPower: 1, // 1 = arma normal, 2 = arma pesada (solo niveles con jefe)
      attackCooldown: 0,
      attackAnim: 0,
      invulnerable: 0,
      ridingPlatformId: null,
    },
    platforms: level.platforms.map((p) => ({ ...p })),
    enemies: level.enemies.map((e) => ({ ...e })),
    collectibles: level.collectibles.map((c) => ({ ...c })),
    saws: level.saws.map((s) => ({ ...s })),
    // Los jefes flotan cerca del portal en los últimos niveles (ver
    // levels.js/BOSS.levelsFromEnd) — 'level.boss' es null en el resto.
    boss: level.boss
      ? { ...level.boss, health: level.boss.healthMax, alive: true, vx: 1, rayTimer: BOSS.rayCooldown, hitFlash: 0 }
      : null,
    // Aves + bombas: sistema puramente de RUNTIME (no forman parte del
    // mapa generado/determinista) — usan Math.random() a propósito,
    // como ya hacen las partículas, porque es aleatoriedad de "juego
    // en vivo", no de generación de nivel.
    birds: [],
    bombs: [],
    birdTimer: randRangeRuntime(...BIRD.intervalRangeByTier[level.tier]),
    portal: { ...level.portal },
    projectiles: [],
    particles: [],
    zaphitos: { azul: false, rojo: false, verde: false },
    portalActive: false,
    time: 0,
    cameraX: 0,
    cleared: false,
    failed: false,
  };
}

function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// Círculo (sierra) vs rectángulo (jugador): punto más cercano del AABB
// al centro del círculo, comparado contra el radio.
function circleAabb(circle, box) {
  const closestX = Math.max(box.x, Math.min(circle.x, box.x + box.w));
  const closestY = Math.max(box.y, Math.min(circle.y, box.y + box.h));
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy < circle.radius * circle.radius;
}

function spawnBurst(world, x, y, color, count, speedRange) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = speedRange[0] + Math.random() * (speedRange[1] - speedRange[0]);
    world.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.4 + Math.random() * 0.5,
      maxLife: 0.9,
      color,
      size: 2 + Math.random() * 2.5,
    });
  }
}

function damageEnemy(world, enemy, amount) {
  enemy.health -= amount;
  enemy.hitFlash = 0.12;
  if (enemy.health <= 0) {
    enemy.alive = false;
    spawnBurst(world, enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, COLORS.enemy, 22, [60, 260]);
  }
}

// Bombas de las aves y rayos del jefe matan a los enemigos comunes de
// un solo golpe (fuego "amigo" entre peligros — el jefe/las bombas no
// discriminan) — reusa damageEnemy con daño = toda la vida restante,
// para no duplicar la lógica de explosión/partículas.
function killEnemy(world, enemy) {
  damageEnemy(world, enemy, enemy.health);
}

function damageBoss(world, amount) {
  const boss = world.boss;
  if (!boss || !boss.alive) return;
  boss.health -= amount;
  boss.hitFlash = 0.15;
  if (boss.health <= 0) {
    boss.alive = false;
    spawnBurst(world, boss.x + boss.w / 2, boss.y + boss.h / 2, COLORS.boss, 46, [90, 320]);
  }
}

function updateMovingPlatforms(world) {
  world.platforms.forEach((p) => {
    if (p.type !== "moving") return;
    const prevX = p.x;
    const prevY = p.y;
    const t = (world.time + p.phase) * p.speed;
    if (p.axis === "x") {
      p.x = p.origin.x + Math.sin(t) * p.amplitude;
    } else {
      p.y = p.origin.y + Math.sin(t) * p.amplitude;
    }
    p.dx = p.x - prevX;
    p.dy = p.y - prevY;
  });
}

// idle -> (el jugador se para encima) -> shaking (avisa, pero SIGUE
// sólida durante CRUMBLE.shakeDuration segundos — tiempo de sobra
// para saltar a la siguiente plataforma) -> gone (deja de colisionar).
// Se detecta "el jugador se paró encima" vía ridingPlatformId, que
// resolvePlayerVsPlatforms ya deja actualizado ANTES de que esta
// función corra (ver orden en stepPhysics) — por eso una 'crumbling'
// NO se excluye de esa asignación (solo 'booster' se excluye).
function updateCrumblingPlatforms(world, dt) {
  world.platforms.forEach((p) => {
    if (p.type !== "crumbling") return;
    if (p.state === "idle") {
      if (world.player.ridingPlatformId === p.id) {
        p.state = "shaking";
        p.timer = CRUMBLE.shakeDuration;
      }
      return;
    }
    if (p.state === "shaking") {
      p.timer -= dt;
      if (p.timer <= 0) {
        p.state = "gone";
        spawnBurst(world, p.x + p.w / 2, p.y + p.h / 2, COLORS.crumbling, 20, [40, 160]);
      }
    }
  });
}

// Una plataforma 'crumbling' que ya terminó de derrumbarse ('gone')
// deja de existir para toda colisión (jugador Y proyectiles) — sigue
// en el array (mismo 'id', para que cualquier cosa que la referencie
// no rompa), simplemente ya no bloquea nada.
function isSolid(p) {
  return !(p.type === "crumbling" && p.state === "gone");
}

function resolvePlayerVsPlatforms(world, dt) {
  const player = world.player;

  const riding =
    player.ridingPlatformId != null
      ? world.platforms.find((p) => p.id === player.ridingPlatformId)
      : null;

  // Si el jugador venía parado/montado sobre una plataforma móvil, lo
  // arrastra con ella ANTES de aplicar su propio movimiento — en X
  // para que no "resbale" al quedarse quieto, y en Y para que el
  // aterrizaje (más abajo) compare posiciones RELATIVAS, no absolutas.
  //
  // El arrastre en Y tiene que resolverse ACÁ, antes del bloque de
  // colisión en X, no después: 'updateMovingPlatforms' ya movió la
  // plataforma este frame, así que si el jugador no se ha movido con
  // ella todavía y la plataforma subió, sus AABB quedan superpuestos
  // en Y un instante antes de que el bloque de X corra. Ese bloque
  // solo mira si hay overlap y en qué dirección viene 'vx' — no sabe
  // que el solape es por movimiento vertical de la plataforma — así
  // que lo trataba como si hubiera chocado contra una pared lateral y
  // lo expulsaba del borde ("Edge Ejection"). Arrastrando primero, el
  // jugador ya queda alineado con la nueva posición de la plataforma
  // antes de que el chequeo de X exista, y el falso solape desaparece.
  if (riding && riding.type === "moving") {
    if (riding.axis === "x") player.x += riding.dx;
    else if (riding.axis === "y") player.y += riding.dy;
  }

  // Eje X — nunca se resuelve colisión lateral contra la plataforma en
  // la que el jugador está parado/montado: pisar la parte de arriba
  // tiene prioridad absoluta sobre cualquier empuje en X, sin importar
  // qué tan al borde esté o si el arrastre de arriba dejó algún resto
  // de superposición por redondeo. Cualquier OTRA plataforma (paredes,
  // otras plataformas) sigue resolviendo colisión lateral normal.
  player.x += player.vx * dt;
  for (const p of world.platforms) {
    if (!isSolid(p) || p === riding || !aabb(player, p)) continue;
    if (player.vx > 0) player.x = p.x - player.w;
    else if (player.vx < 0) player.x = p.x + p.w;
    player.vx = 0;
  }

  // Eje Y — el fondo ANTES de mover, para distinguir "aterrizar desde
  // arriba" (fondo previo por encima de la plataforma) de "empujar
  // desde abajo" al chocar con la cabeza.
  const prevBottom = player.y + player.h;
  player.y += player.vy * dt;
  player.onGround = false;
  player.ridingPlatformId = null;
  for (const p of world.platforms) {
    if (!isSolid(p) || !aabb(player, p)) continue;
    if (player.vy > 0 && prevBottom <= p.y + 1) {
      // Cayendo, aterriza encima.
      player.y = p.y - player.h;
      player.vy = p.type === "booster" ? PHYSICS.boosterVelocity : 0;
      if (p.type !== "booster") {
        player.onGround = true;
        player.ridingPlatformId = p.id;
      }
    } else if (player.vy < 0) {
      // Subiendo, se golpea la cabeza contra el fondo de la plataforma.
      player.y = p.y + p.h;
      player.vy = 0;
    }
  }

  player.x = Math.max(0, Math.min(world.level.width - player.w, player.x));
}

function updatePlayerCombat(world, dt, input) {
  const player = world.player;
  player.attackCooldown = Math.max(0, player.attackCooldown - dt);
  player.attackAnim = Math.max(0, player.attackAnim - dt);
  player.invulnerable = Math.max(0, player.invulnerable - dt);

  if (input.moveAxis > 0.15) player.facing = 1;
  else if (input.moveAxis < -0.15) player.facing = -1;

  if (!input.wantAttack || player.attackCooldown > 0) return;

  player.attackAnim = 0.18;
  if (player.hasWeapon) {
    const heavy = player.weaponPower === 2;
    const speed = heavy ? COMBAT.heavyProjectileSpeed : COMBAT.projectileSpeed;
    const w = heavy ? 22 : 14;
    const h = heavy ? 10 : 6;
    player.attackCooldown = heavy ? COMBAT.heavyProjectileCooldown : COMBAT.projectileCooldown;
    world.projectiles.push({
      x: player.facing > 0 ? player.x + player.w : player.x - w,
      y: player.y + player.h / 2 - h / 2,
      w,
      h,
      vx: player.facing * speed,
      owner: "player",
      heavy,
      damage: heavy ? COMBAT.heavyProjectileDamage : COMBAT.projectileDamage,
      life: heavy ? COMBAT.heavyProjectileLifetime : COMBAT.projectileLifetime,
    });
  } else {
    player.attackCooldown = COMBAT.meleeCooldown;
    const hitbox = {
      x: player.facing > 0 ? player.x + player.w : player.x - COMBAT.meleeRange,
      y: player.y + (player.h - COMBAT.meleeHeight) / 2,
      w: COMBAT.meleeRange,
      h: COMBAT.meleeHeight,
    };
    world.enemies.forEach((enemy) => {
      if (enemy.alive && aabb(hitbox, enemy)) {
        damageEnemy(world, enemy, COMBAT.meleeDamage);
      }
    });
    if (world.boss && world.boss.alive && aabb(hitbox, world.boss)) {
      damageBoss(world, COMBAT.meleeDamage);
    }
  }
}

function updateEnemies(world, dt) {
  world.enemies.forEach((enemy) => {
    if (!enemy.alive) return;
    enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
    enemy.x += enemy.vx * enemy.speed * dt;
    if (enemy.x <= enemy.patrolMin) {
      enemy.x = enemy.patrolMin;
      enemy.vx = 1;
    } else if (enemy.x >= enemy.patrolMax) {
      enemy.x = enemy.patrolMax;
      enemy.vx = -1;
    }
  });
}

function spawnBird(world) {
  const fromLeft = Math.random() < 0.5;
  const x = fromLeft ? world.cameraX - 60 : world.cameraX + CANVAS_W + 60;
  const y = randRangeRuntime(60, 160);
  world.birds.push({
    x,
    y,
    vx: fromLeft ? BIRD.speed : -BIRD.speed,
    // Apunta a donde estaba el jugador AL APARECER, no lo persigue
    // después — es una amenaza esquivable moviéndose, no un misil
    // teledirigido.
    targetX: world.player.x + world.player.w / 2,
    dropped: false,
  });
}

// Aves que cruzan la pantalla y sueltan UNA bomba al pasar sobre la
// posición del jugador (probabilidad 0.5 por intento — "5 de 10").
// Las bombas matan enemigos comunes al contacto y reinician el nivel
// si tocan al jugador — por eso esta función devuelve { playerHit }
// en vez de tocar 'world.failed' directamente: stepPhysics junta TODOS
// los peligros (enemigos/sierras/jefe/bombas) en un único chequeo al
// final, para no repetir la lógica de "reiniciar + partículas" cuatro
// veces.
function updateBirdsAndBombs(world, dt) {
  const tier = world.level.tier;
  world.birdTimer -= dt;
  if (world.birdTimer <= 0) {
    world.birdTimer = randRangeRuntime(...BIRD.intervalRangeByTier[tier]);
    if (Math.random() < BIRD.spawnChanceByTier[tier]) spawnBird(world);
  }

  world.birds.forEach((bird) => {
    bird.x += bird.vx * dt;
    if (!bird.dropped && Math.abs(bird.x - bird.targetX) < 12) {
      bird.dropped = true;
      world.bombs.push({ x: bird.x, y: bird.y + 14, vy: 40, r: BIRD.bombRadius });
    }
  });
  world.birds = world.birds.filter(
    (b) => b.x > world.cameraX - 150 && b.x < world.cameraX + CANVAS_W + 150
  );

  let playerHit = false;
  world.bombs = world.bombs.filter((bomb) => {
    bomb.vy += BIRD.bombGravity * dt;
    bomb.y += bomb.vy * dt;
    const bombBox = { x: bomb.x - bomb.r, y: bomb.y - bomb.r, w: bomb.r * 2, h: bomb.r * 2 };

    if (world.player.invulnerable <= 0 && aabb(world.player, bombBox)) {
      playerHit = true;
      spawnBurst(world, bomb.x, bomb.y, COLORS.bomb, 20, [70, 220]);
      return false;
    }
    for (const enemy of world.enemies) {
      if (enemy.alive && aabb(enemy, bombBox)) {
        killEnemy(world, enemy);
        spawnBurst(world, bomb.x, bomb.y, COLORS.bomb, 20, [70, 220]);
        return false;
      }
    }
    for (const p of world.platforms) {
      if (isSolid(p) && aabb(bombBox, p)) {
        spawnBurst(world, bomb.x, bomb.y, COLORS.bomb, 14, [50, 160]);
        return false;
      }
    }
    return bomb.y <= world.deathY;
  });

  return { playerHit };
}

function updateSaws(world) {
  world.saws.forEach((s) => {
    if (s.type !== "moving") return;
    const t = (world.time + s.phase) * s.speed;
    if (s.axis === "x") s.x = s.origin.x + Math.sin(t) * s.amplitude;
    else s.y = s.origin.y + Math.sin(t) * s.amplitude;
  });
}

function checkEnemyTouchesPlayer(world) {
  if (world.player.invulnerable > 0) return false;
  return world.enemies.some((enemy) => enemy.alive && aabb(world.player, enemy));
}

function checkSawTouchesPlayer(world) {
  return world.saws.some((s) => circleAabb(s, world.player));
}

function checkBossTouchesPlayer(world) {
  if (!BOSS.meleeContactIsHazard || !world.boss || !world.boss.alive) return false;
  return aabb(world.player, world.boss);
}

// El jefe patrulla su rango corto y, cada BOSS.rayCooldown segundos,
// dispara un rayo apuntado hacia donde está el jugador EN ESE
// INSTANTE (dirección recalculada en cada disparo, no un misil que
// gira en pleno vuelo). El rayo reutiliza el mismo array de
// proyectiles que ya usan jugador/nada — ver updateProjectiles, que
// ahora también mueve en Y (los del jugador siguen siendo horizontales
// puros porque nunca les asigno vy) y sabe reaccionar a owner:'boss'.
function updateBoss(world, dt) {
  const boss = world.boss;
  if (!boss) return;
  boss.hitFlash = Math.max(0, boss.hitFlash - dt);
  if (!boss.alive) return;

  boss.x += boss.vx * BOSS.patrolSpeed * dt;
  if (boss.x <= boss.patrolMin) {
    boss.x = boss.patrolMin;
    boss.vx = 1;
  } else if (boss.x >= boss.patrolMax) {
    boss.x = boss.patrolMax;
    boss.vx = -1;
  }

  boss.rayTimer -= dt;
  if (boss.rayTimer <= 0) {
    boss.rayTimer = BOSS.rayCooldown;
    const bossCx = boss.x + boss.w / 2;
    const bossCy = boss.y + boss.h / 2;
    const playerCx = world.player.x + world.player.w / 2;
    const playerCy = world.player.y + world.player.h / 2;
    const dx = playerCx - bossCx;
    const dy = playerCy - bossCy;
    const dist = Math.max(1, Math.hypot(dx, dy));
    world.projectiles.push({
      x: bossCx,
      y: bossCy,
      w: BOSS.rayW,
      h: BOSS.rayH,
      vx: (dx / dist) * BOSS.raySpeed,
      vy: (dy / dist) * BOSS.raySpeed,
      owner: "boss",
      life: 2.2,
    });
  }
}

function updateProjectiles(world, dt) {
  let playerHit = false;
  world.projectiles = world.projectiles.filter((proj) => {
    proj.x += proj.vx * dt;
    proj.y += (proj.vy || 0) * dt;
    proj.life -= dt;
    if (proj.life <= 0) return false;

    if (proj.owner === "player") {
      const damage = proj.damage ?? COMBAT.projectileDamage;
      for (const enemy of world.enemies) {
        if (enemy.alive && aabb(proj, enemy)) {
          damageEnemy(world, enemy, damage);
          return false;
        }
      }
      if (world.boss && world.boss.alive && aabb(proj, world.boss)) {
        damageBoss(world, damage);
        return false;
      }
    } else if (proj.owner === "boss") {
      // "de igual forma" que el resto de los peligros — tocar al
      // jugador reinicia el nivel — y de paso mata a los enemigos
      // comunes que agarre de curso (fuego amigo del jefe).
      if (world.player.invulnerable <= 0 && aabb(proj, world.player)) {
        playerHit = true;
        spawnBurst(world, proj.x, proj.y, COLORS.bossRay, 18, [60, 200]);
        return false;
      }
      for (const enemy of world.enemies) {
        if (enemy.alive && aabb(proj, enemy)) {
          killEnemy(world, enemy);
          spawnBurst(world, proj.x, proj.y, COLORS.bossRay, 12, [50, 160]);
          return false;
        }
      }
    }
    for (const p of world.platforms) {
      if (isSolid(p) && aabb(proj, p)) {
        spawnBurst(
          world,
          proj.x,
          proj.y,
          proj.owner === "boss" ? COLORS.bossRay : COLORS.projectilePlayer,
          6,
          [30, 90]
        );
        return false;
      }
    }
    return true;
  });
  return { playerHit };
}

function updateParticles(world, dt) {
  world.particles = world.particles.filter((p) => {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += PHYSICS.gravity * 0.25 * dt;
    p.life -= dt;
    return p.life > 0;
  });
}

// Posición REAL de un coleccionable en este instante: si vive sobre
// una plataforma (platformId != null), se recalcula a partir de dónde
// está esa plataforma AHORA (offsetX/offsetY relativos a su origen) —
// así uno sobre una plataforma 'moving' viaja con ella en vez de
// quedar flotando en el punto donde estaba la plataforma al generar
// el nivel (el bug reportado en el Nivel 3). Si la plataforma no
// existe (no debería pasar) cae de vuelta a x/y absolutos guardados.
export function collectiblePosition(world, c) {
  if (c.platformId == null) return { x: c.x, y: c.y };
  const platform = world.platforms.find((p) => p.id === c.platformId);
  if (!platform) return { x: c.x, y: c.y };
  return { x: platform.x + c.offsetX, y: platform.y + c.offsetY };
}

function updateCollectibles(world, events) {
  const player = world.player;
  world.collectibles.forEach((c) => {
    if (c.collected) return;
    const pos = collectiblePosition(world, c);
    const box = { x: pos.x, y: pos.y, w: COLLECT_SIZE, h: COLLECT_SIZE };
    if (!aabb(player, box)) return;
    c.collected = true;

    if (c.type === "zaphito-azul") world.zaphitos.azul = true;
    else if (c.type === "zaphito-rojo") world.zaphitos.rojo = true;
    else if (c.type === "zaphito-verde") world.zaphitos.verde = true;
    else if (c.type === "zaphito-dorado") events.goldGained += 1;
    else if (c.type === "weapon") {
      player.hasWeapon = true;
      player.weaponPower = 1;
    } else if (c.type === "weapon-heavy") {
      player.hasWeapon = true;
      player.weaponPower = 2;
    }

    const color =
      c.type === "zaphito-azul"
        ? COLORS.zaphitoAzul
        : c.type === "zaphito-rojo"
          ? COLORS.zaphitoRojo
          : c.type === "zaphito-verde"
            ? COLORS.zaphitoVerde
            : c.type === "zaphito-dorado"
              ? COLORS.zaphitoDorado
              : c.type === "weapon-heavy"
                ? COLORS.weaponHeavy
                : COLORS.weapon;
    spawnBurst(
      world,
      pos.x + COLLECT_SIZE / 2,
      pos.y + COLLECT_SIZE / 2,
      color,
      c.type === "weapon-heavy" ? 22 : 14,
      [40, 140]
    );
  });

  world.portalActive = world.zaphitos.azul && world.zaphitos.rojo && world.zaphitos.verde;
}

/* Un solo paso de tiempo FIJO — el componente llama a esta función
   tantas veces como haga falta por frame (acumulador de timestep fijo)
   para que la física sea estable sin importar el refresh rate real de
   la pantalla del jugador. */
export function stepPhysics(world, dt, input) {
  const events = { cleared: false, failed: false, goldGained: 0 };
  if (world.cleared || world.failed) return events;

  world.time += dt;

  // Movimiento horizontal (aceleración + fricción, no velocidad
  // instantánea) para que se sienta como una plataforma real.
  const player = world.player;
  if (Math.abs(input.moveAxis) > 0.05) {
    player.vx += input.moveAxis * PHYSICS.moveAccel * dt;
    player.vx = Math.max(-PHYSICS.maxRunSpeed, Math.min(PHYSICS.maxRunSpeed, player.vx));
  } else if (player.vx !== 0) {
    const decel = PHYSICS.friction * dt;
    player.vx = Math.abs(player.vx) <= decel ? 0 : player.vx - Math.sign(player.vx) * decel;
  }

  if (input.wantJump && player.onGround) {
    // Si el elevador donde está parado sube, ese impulso se suma al
    // salto (se siente como saltar desde un ascensor en movimiento).
    // 'riding.dy' es el desplazamiento vertical del frame anterior
    // (updateMovingPlatforms todavía no corrió este frame) — con
    // movimiento senoidal suave es una aproximación de sobra buena de
    // su velocidad instantánea. Solo se suma cuando sube (dy < 0,
    // arriba en pantalla); si bajara no se resta nada, para no
    // castigar el salto con un piso descendente.
    let liftVelocity = 0;
    if (player.ridingPlatformId != null) {
      const riding = world.platforms.find((p) => p.id === player.ridingPlatformId);
      if (riding && riding.type === "moving" && riding.axis === "y" && riding.dy < 0) {
        liftVelocity = riding.dy / dt;
      }
    }
    player.vy = PHYSICS.jumpVelocity + liftVelocity;
    player.onGround = false;
    player.ridingPlatformId = null;
  }

  player.vy = Math.min(PHYSICS.maxFallSpeed, player.vy + PHYSICS.gravity * dt);

  updateMovingPlatforms(world);
  updateSaws(world);
  resolvePlayerVsPlatforms(world, dt);
  updateCrumblingPlatforms(world, dt);
  updatePlayerCombat(world, dt, input);
  updateEnemies(world, dt);
  updateBoss(world, dt);
  const projectileResult = updateProjectiles(world, dt);
  const bombResult = updateBirdsAndBombs(world, dt);
  updateParticles(world, dt);
  updateCollectibles(world, events);

  // Todos los peligros de contacto (enemigos, sierras, el jefe, sus
  // rayos, las bombas de las aves) desembocan en el MISMO desenlace:
  // reiniciar el nivel — un único chequeo acá evita repetir 5 veces
  // "world.failed = true; spawnBurst(...)".
  const hitByHazard =
    checkEnemyTouchesPlayer(world) ||
    checkSawTouchesPlayer(world) ||
    checkBossTouchesPlayer(world) ||
    projectileResult.playerHit ||
    bombResult.playerHit;

  if (hitByHazard) {
    world.failed = true;
    events.failed = true;
    spawnBurst(world, player.x + player.w / 2, player.y + player.h / 2, COLORS.enemy, 26, [80, 260]);
  }

  if (player.y > world.deathY) {
    world.failed = true;
    events.failed = true;
  }

  if (world.portalActive && aabb(player, world.portal)) {
    world.cleared = true;
    events.cleared = true;
  }

  world.cameraX = Math.max(
    0,
    Math.min(world.level.width - CANVAS_W, player.x + player.w / 2 - CANVAS_W / 2)
  );

  return events;
}
