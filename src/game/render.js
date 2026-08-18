import { CANVAS_H, CANVAS_W, COLORS, CRUMBLE } from "./constants";
import { collectiblePosition } from "./engine";

/* Todo el "arte" del juego son trazos de canvas con resplandor
   (shadowBlur + shadowColor) sobre fondo negro — cero imágenes, así
   el Easter Egg no agrega peso al bundle ni pide assets nuevos. */
function setNeon(ctx, color, blur = 14) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
}

function drawBackground(ctx, world) {
  ctx.shadowBlur = 0;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.strokeStyle = COLORS.bgGrid;
  ctx.lineWidth = 1;
  const offset = -(world.cameraX * 0.3) % 60;
  for (let x = offset; x < CANVAS_W; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CANVAS_H);
    ctx.stroke();
  }
  for (let y = 0; y < CANVAS_H; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CANVAS_W, y);
    ctx.stroke();
  }
}

function drawPlatform(ctx, p, camX, t) {
  if (p.type === "crumbling" && p.state === "gone") return;
  const x = p.x - camX;
  if (x + p.w < 0 || x > CANVAS_W) return;

  const color =
    p.type === "moving"
      ? COLORS.moving
      : p.type === "booster"
        ? COLORS.booster
        : p.type === "crumbling"
          ? COLORS.crumbling
          : COLORS.platform;

  // 'shaking': tiembla y se va desvaneciendo a medida que se acerca a
  // 'gone' — la vibración avisa "esto se va a caer", el desvanecido da
  // una pista visual de cuánto tiempo queda para saltar.
  let drawX = x;
  let alpha = 1;
  if (p.type === "crumbling" && p.state === "shaking") {
    const urgency = 1 - p.timer / CRUMBLE.shakeDuration;
    drawX = x + Math.sin(t * 45) * (2 + urgency * 4);
    alpha = Math.max(0.3, p.timer / CRUMBLE.shakeDuration);
  }

  setNeon(ctx, color, p.type === "booster" ? 22 : 12);
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 3;
  ctx.strokeRect(drawX, p.y, p.w, p.h);
  ctx.globalAlpha = 0.12 * alpha;
  ctx.fillRect(drawX, p.y, p.w, p.h);
  ctx.globalAlpha = 1;
  if (p.type === "booster") {
    ctx.beginPath();
    ctx.moveTo(x + p.w / 2 - 8, p.y - 4);
    ctx.lineTo(x + p.w / 2 + 8, p.y - 4);
    ctx.lineTo(x + p.w / 2, p.y - 16);
    ctx.closePath();
    ctx.fill();
  }
}

function collectibleColor(type) {
  switch (type) {
    case "zaphito-azul":
      return COLORS.zaphitoAzul;
    case "zaphito-rojo":
      return COLORS.zaphitoRojo;
    case "zaphito-verde":
      return COLORS.zaphitoVerde;
    case "zaphito-dorado":
      return COLORS.zaphitoDorado;
    case "weapon-heavy":
      return COLORS.weaponHeavy;
    default:
      return COLORS.weapon;
  }
}

function drawCollectible(ctx, c, pos, camX, t) {
  if (c.collected) return;
  const x = pos.x - camX;
  if (x < -30 || x > CANVAS_W + 30) return;
  const bob = Math.sin(t * 3 + c.x) * 4;
  const cx = x + 13;
  const cy = pos.y + 13 + bob;
  const color = collectibleColor(c.type);
  setNeon(ctx, color, 16);
  ctx.lineWidth = 2.5;

  if (c.type === "weapon" || c.type === "weapon-heavy") {
    const heavy = c.type === "weapon-heavy";
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-0.3);
    ctx.strokeRect(heavy ? -20 : -16, heavy ? -6 : -4, heavy ? 40 : 32, heavy ? 12 : 8);
    if (heavy) {
      // "cañón doble" para que se lea claramente distinta al arma
      // normal, no solo por color.
      ctx.strokeRect(-20, -12, 40, 4);
    }
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(cx, cy - 12);
  ctx.lineTo(cx + 10, cy);
  ctx.lineTo(cx, cy + 12);
  ctx.lineTo(cx - 10, cy);
  ctx.closePath();
  ctx.stroke();
  ctx.globalAlpha = 0.25;
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawEnemy(ctx, e, camX) {
  if (!e.alive) return;
  const x = e.x - camX;
  if (x + e.w < 0 || x > CANVAS_W) return;
  const color = e.hitFlash > 0 ? "#ffffff" : COLORS.enemy;
  setNeon(ctx, color, 16);
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x, e.y, e.w, e.h);
  ctx.fillRect(x + e.w * 0.25 - 2, e.y + 10, 4, 4);
  ctx.fillRect(x + e.w * 0.75 - 2, e.y + 10, 4, 4);
}

function drawPlayer(ctx, player, character, camX) {
  const x = player.x - camX;
  const y = player.y;
  setNeon(ctx, character.color, 18);
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, player.w, player.h);
  ctx.globalAlpha = 0.15;
  ctx.fillRect(x, y, player.w, player.h);
  ctx.globalAlpha = 1;

  const headR = 8;
  const headX = x + player.w / 2;
  const headY = y - 2;
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 2;
  if (character.accent === "antena") {
    ctx.beginPath();
    ctx.moveTo(headX, headY - headR);
    ctx.lineTo(headX, headY - headR - 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(headX, headY - headR - 12, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (character.accent === "banda") {
    ctx.beginPath();
    ctx.moveTo(headX - headR, headY - 2);
    ctx.lineTo(headX + headR, headY - 2);
    ctx.stroke();
  } else if (character.accent === "corona") {
    ctx.beginPath();
    ctx.moveTo(headX - 7, headY - headR);
    ctx.lineTo(headX - 3, headY - headR - 8);
    ctx.lineTo(headX, headY - headR - 2);
    ctx.lineTo(headX + 3, headY - headR - 8);
    ctx.lineTo(headX + 7, headY - headR);
    ctx.stroke();
  } else if (character.accent === "llama") {
    ctx.beginPath();
    ctx.moveTo(headX - 5, headY - headR);
    ctx.quadraticCurveTo(headX, headY - headR - 14, headX + 5, headY - headR);
    ctx.stroke();
  }

  const armY = y + player.h * 0.45;
  const dir = player.facing;
  const reach = player.attackAnim > 0 ? 26 : 14;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x + player.w / 2, armY);
  ctx.lineTo(x + player.w / 2 + dir * reach, armY + (player.attackAnim > 0 ? 0 : 4));
  ctx.stroke();

  if (player.hasWeapon) {
    const heavy = player.weaponPower === 2;
    ctx.strokeStyle = heavy ? COLORS.weaponHeavy : character.color;
    ctx.strokeRect(x + player.w / 2 + dir * reach - (dir > 0 ? 2 : heavy ? 22 : 16), armY - (heavy ? 4 : 3), heavy ? 24 : 18, heavy ? 8 : 6);
  }
}

function drawProjectile(ctx, p, camX) {
  const x = p.x - camX;
  const color =
    p.owner === "player"
      ? p.heavy
        ? COLORS.projectileHeavy
        : COLORS.projectilePlayer
      : p.owner === "boss"
        ? COLORS.bossRay
        : COLORS.projectileEnemy;
  setNeon(ctx, color, p.owner === "boss" || p.heavy ? 20 : 14);
  ctx.save();
  ctx.translate(x + p.w / 2, p.y + p.h / 2);
  if (p.owner === "boss") ctx.rotate(Math.atan2(p.vy || 0, p.vx));
  ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
  ctx.restore();
}

// Sierra: círculo + "dientes" que giran con el tiempo — cuanto más
// grande, más lento gira (transmite peso/amenaza).
function drawSaw(ctx, s, camX, t) {
  const x = s.x - camX;
  if (x + s.radius < 0 || x - s.radius > CANVAS_W) return;
  setNeon(ctx, COLORS.saw, 16);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, s.y, s.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.1;
  ctx.fill();
  ctx.globalAlpha = 1;

  const teeth = 8;
  const spin = t * (260 / Math.max(20, s.radius));
  for (let i = 0; i < teeth; i++) {
    const angle = spin + (i / teeth) * Math.PI * 2;
    const innerR = s.radius * 0.55;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * innerR, s.y + Math.sin(angle) * innerR);
    ctx.lineTo(x + Math.cos(angle) * s.radius, s.y + Math.sin(angle) * s.radius);
    ctx.stroke();
  }
}

function drawBird(ctx, bird, camX, t) {
  const x = bird.x - camX;
  if (x < -60 || x > CANVAS_W + 60) return;
  setNeon(ctx, COLORS.bird, 12);
  ctx.lineWidth = 2.5;
  const flap = Math.sin(t * 14) * 6;
  ctx.beginPath();
  ctx.moveTo(x - 14, bird.y - flap);
  ctx.lineTo(x, bird.y + 3);
  ctx.lineTo(x + 14, bird.y - flap);
  ctx.stroke();
}

function drawBomb(ctx, bomb, camX) {
  const x = bomb.x - camX;
  setNeon(ctx, COLORS.bomb, 16);
  ctx.beginPath();
  ctx.arc(x, bomb.y, bomb.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, bomb.y - bomb.r);
  ctx.lineTo(x + 4, bomb.y - bomb.r - 7);
  ctx.stroke();
}

// Jefe gigante + barra de vida flotando arriba de su cabeza — la
// única entidad del juego que necesita mostrar su vida explícitamente
// (los enemigos comunes mueren en 1-2 golpes, no hace falta barra).
function drawBoss(ctx, boss, camX) {
  if (!boss.alive) return;
  const x = boss.x - camX;
  if (x + boss.w < -50 || x > CANVAS_W + 50) return;
  const color = boss.hitFlash > 0 ? "#ffffff" : COLORS.boss;
  setNeon(ctx, color, 24);
  ctx.lineWidth = 4;
  ctx.strokeRect(x, boss.y, boss.w, boss.h);
  ctx.globalAlpha = 0.14;
  ctx.fillRect(x, boss.y, boss.w, boss.h);
  ctx.globalAlpha = 1;

  // un par de "ojos" grandes para que se lea como criatura, no como caja
  ctx.fillRect(x + boss.w * 0.28 - 6, boss.y + boss.h * 0.25, 12, 12);
  ctx.fillRect(x + boss.w * 0.72 - 6, boss.y + boss.h * 0.25, 12, 12);

  const barW = boss.w;
  const barX = x;
  const barY = boss.y - 18;
  ctx.shadowBlur = 0;
  ctx.strokeStyle = COLORS.textDim;
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barW, 8);
  const pct = Math.max(0, boss.health / boss.healthMax || 0);
  ctx.fillStyle = COLORS.boss;
  ctx.fillRect(barX, barY, barW * pct, 8);
}

function drawParticle(ctx, p, camX) {
  const x = p.x - camX;
  ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
  setNeon(ctx, p.color, 10);
  ctx.beginPath();
  ctx.arc(x, p.y, p.size, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawPortal(ctx, portal, active, camX, t) {
  const x = portal.x - camX;
  const color = active ? COLORS.portalActive : COLORS.portalLocked;
  const pulse = active ? 18 + Math.sin(t * 6) * 8 : 8;
  setNeon(ctx, color, pulse);
  ctx.lineWidth = 3;
  ctx.strokeRect(x, portal.y, portal.w, portal.h);
  ctx.globalAlpha = active ? 0.25 : 0.08;
  ctx.fillRect(x, portal.y, portal.w, portal.h);
  ctx.globalAlpha = 1;
}

function drawZaphitoIcon(ctx, cx, cy, color, filled) {
  setNeon(ctx, color, filled ? 12 : 4);
  ctx.globalAlpha = filled ? 1 : 0.35;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx + 7, cy);
  ctx.lineTo(cx, cy + 8);
  ctx.lineTo(cx - 7, cy);
  ctx.closePath();
  ctx.stroke();
  if (filled) ctx.fill();
  ctx.globalAlpha = 1;
}

function drawHud(ctx, world, hudInfo) {
  ctx.shadowBlur = 0;
  ctx.textBaseline = "top";
  ctx.font = "bold 15px 'Rajdhani', sans-serif";
  setNeon(ctx, COLORS.text, 6);
  ctx.fillText(`NIVEL ${hudInfo.levelNumber}/${hudInfo.totalLevels} · ${hudInfo.tierLabel}`, 16, 14);

  drawZaphitoIcon(ctx, 22, 46, COLORS.zaphitoAzul, world.zaphitos.azul);
  drawZaphitoIcon(ctx, 42, 46, COLORS.zaphitoRojo, world.zaphitos.rojo);
  drawZaphitoIcon(ctx, 62, 46, COLORS.zaphitoVerde, world.zaphitos.verde);

  if (world.player.hasWeapon) {
    const heavy = world.player.weaponPower === 2;
    setNeon(ctx, heavy ? COLORS.weaponHeavy : COLORS.weapon, heavy ? 14 : 10);
    ctx.save();
    ctx.translate(90, 46);
    ctx.rotate(-0.3);
    ctx.lineWidth = 2;
    ctx.strokeRect(heavy ? -15 : -12, heavy ? -4 : -3, heavy ? 30 : 24, heavy ? 8 : 6);
    ctx.restore();
  }

  ctx.font = "bold 15px 'Rajdhani', sans-serif";
  setNeon(ctx, COLORS.zaphitoDorado, 8);
  const goldLabel = `${hudInfo.gold}`;
  const textWidth = ctx.measureText(goldLabel).width;
  ctx.fillText(goldLabel, CANVAS_W - 16 - textWidth, 14);
  drawZaphitoIcon(ctx, CANVAS_W - 26 - textWidth, 18, COLORS.zaphitoDorado, true);
  ctx.shadowBlur = 0;
}

export function renderWorld(ctx, world, character, t, hudInfo) {
  const camX = world.cameraX;
  drawBackground(ctx, world);
  world.platforms.forEach((p) => drawPlatform(ctx, p, camX, t));
  drawPortal(ctx, world.portal, world.portalActive, camX, t);
  world.saws.forEach((s) => drawSaw(ctx, s, camX, t));
  world.collectibles.forEach((c) => drawCollectible(ctx, c, collectiblePosition(world, c), camX, t));
  world.enemies.forEach((e) => drawEnemy(ctx, e, camX));
  world.birds.forEach((b) => drawBird(ctx, b, camX, t));
  world.bombs.forEach((b) => drawBomb(ctx, b, camX));
  if (world.boss) drawBoss(ctx, world.boss, camX);
  world.projectiles.forEach((p) => drawProjectile(ctx, p, camX));
  world.particles.forEach((p) => drawParticle(ctx, p, camX));
  drawPlayer(ctx, world.player, character, camX);
  drawHud(ctx, world, hudInfo);
  ctx.shadowBlur = 0;
}
