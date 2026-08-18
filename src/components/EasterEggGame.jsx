import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { CANVAS_H, CANVAS_W, CHARACTERS, SAVE_KEY, TOTAL_LEVELS, tierForLevel } from "../game/constants";
import { generateLevel } from "../game/levels";
import { createWorldFromLevel, stepPhysics } from "../game/engine";
import { renderWorld } from "../game/render";

const FIXED_DT = 1 / 60;
const MAX_SUBSTEPS_PER_FRAME = 5;

const TIER_LABELS = { facil: "Fácil", intermedio: "Intermedio", extremo: "Extremo" };

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) throw new Error("sin guardado previo");
    const parsed = JSON.parse(raw);
    return {
      gold: Number.isFinite(parsed.gold) ? parsed.gold : 0,
      unlocked: Array.isArray(parsed.unlocked) && parsed.unlocked.length ? parsed.unlocked : ["clasico"],
      selected: typeof parsed.selected === "string" ? parsed.selected : "clasico",
      furthestLevel: Number.isFinite(parsed.furthestLevel) ? parsed.furthestLevel : 0,
    };
  } catch {
    return { gold: 0, unlocked: ["clasico"], selected: "clasico", furthestLevel: 0 };
  }
}

function persistSave(save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // localStorage puede fallar (modo privado, cuota llena) — el
    // juego sigue funcionando esta sesión, solo no queda guardado.
  }
}

/* Joystick virtual: círculo base fijo + "nub" que sigue el dedo,
   clampado a un radio. Solo reporta el eje horizontal (-1..1) — es un
   plataformero, no hace falta el eje vertical. */
function VirtualJoystick({ onChange }) {
  const baseRef = useRef(null);
  const originRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const [nub, setNub] = useState({ x: 0, y: 0 });
  const RADIUS = 42;

  const handlePointerDown = (e) => {
    draggingRef.current = true;
    const rect = baseRef.current.getBoundingClientRect();
    originRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    e.target.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e) => {
    if (!draggingRef.current) return;
    let dx = e.clientX - originRef.current.x;
    let dy = e.clientY - originRef.current.y;
    const dist = Math.hypot(dx, dy);
    if (dist > RADIUS) {
      dx = (dx / dist) * RADIUS;
      dy = (dy / dist) * RADIUS;
    }
    setNub({ x: dx, y: dy });
    onChange(dx / RADIUS);
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
    setNub({ x: 0, y: 0 });
    onChange(0);
  };

  return (
    <div
      ref={baseRef}
      className="tz-eg-joystick"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <div className="tz-eg-joystick-nub" style={{ transform: `translate(${nub.x}px, ${nub.y}px)` }} />
    </div>
  );
}

function CharacterSelectScreen({ save, onSelect, onUnlock, onPlay }) {
  return (
    <div className="tz-eg-select">
      <h1 className="tz-eg-title">⚡ TONAZO ARCADE ⚡</h1>
      <p className="tz-eg-gold">🟡 Zapitos Dorados: {save.gold}</p>

      <div className="tz-eg-char-grid">
        {CHARACTERS.map((c) => {
          const unlocked = save.unlocked.includes(c.id);
          const selected = save.selected === c.id;
          return (
            <div key={c.id} className={`tz-eg-char-card ${selected ? "tz-eg-char-card-selected" : ""}`}>
              <div className="tz-eg-char-avatar" style={{ borderColor: c.color, boxShadow: `0 0 18px ${c.color}` }}>
                <span className="tz-eg-char-avatar-dot" style={{ background: c.color, boxShadow: `0 0 10px ${c.color}` }} />
              </div>
              <span className="tz-eg-char-name">{c.name}</span>
              {unlocked ? (
                <button type="button" className="tz-eg-char-btn" onClick={() => onSelect(c.id)} disabled={selected}>
                  {selected ? "Seleccionado" : "Elegir"}
                </button>
              ) : (
                <button
                  type="button"
                  className="tz-eg-char-btn tz-eg-char-btn-locked"
                  onClick={() => onUnlock(c.id, c.cost)}
                  disabled={save.gold < c.cost}
                >
                  🔒 {c.cost}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button type="button" className="tz-eg-play-btn" onClick={onPlay}>
        ▶ JUGAR — Nivel {Math.min(save.furthestLevel + 1, TOTAL_LEVELS)}
      </button>
      <p className="tz-eg-controls-hint">
        Teclado: A/D o ←/→ mover · Espacio/W saltar · F golpear o disparar
        <br />
        Táctil: joystick a la izquierda, botones a la derecha
      </p>
    </div>
  );
}

export default function EasterEggGame({ onClose }) {
  const [save, setSave] = useState(loadSave);
  const [screen, setScreen] = useState("select"); // 'select' | 'playing' | 'cleared' | 'victory'
  const [levelIndex, setLevelIndex] = useState(0);
  const [levelMsg, setLevelMsg] = useState("");
  const [weaponPowerUI, setWeaponPowerUI] = useState(0); // 0 = sin arma, 1 = normal, 2 = pesada

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const worldRef = useRef(null);
  const levelIndexRef = useRef(0);
  const weaponPowerRef = useRef(0);
  const rafRef = useRef(null);
  const accumulatorRef = useRef(0);
  const lastTimeRef = useRef(0);
  const inputRef = useRef({ moveAxis: 0, wantJump: false, wantAttack: false });
  const keysDownRef = useRef(new Set());
  const joystickRef = useRef({ dx: 0 });
  const saveRef = useRef(save);
  const characterRef = useRef(CHARACTERS[0]);

  useEffect(() => {
    saveRef.current = save;
    characterRef.current = CHARACTERS.find((c) => c.id === save.selected) || CHARACTERS[0];
  }, [save]);

  useEffect(() => {
    persistSave(save);
  }, [save]);

  // ---- pantalla completa + orientación horizontal al abrir ----
  useEffect(() => {
    const el = containerRef.current;
    el?.requestFullscreen?.().catch(() => {});
    try {
      window.screen?.orientation?.lock?.("landscape").catch(() => {});
    } catch {
      // No soportado (ej. iOS Safari) — el aviso de "gira tu
      // dispositivo" en CSS cubre este caso sin depender del API.
    }
    return () => {
      try {
        window.screen?.orientation?.unlock?.();
      } catch {
        // ignorar
      }
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
    };
  }, []);

  // ---- teclado ----
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
        e.preventDefault();
      }
      keysDownRef.current.add(e.code);
      if (e.code === "Space" || e.code === "KeyW" || e.code === "ArrowUp") {
        inputRef.current.wantJump = true;
      }
      if (e.code === "KeyF" || e.code === "KeyJ") {
        inputRef.current.wantAttack = true;
      }
      if (e.code === "Escape") onClose();
    };
    const handleKeyUp = (e) => {
      keysDownRef.current.delete(e.code);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [onClose]);

  const startLevel = useCallback((idx) => {
    levelIndexRef.current = idx;
    setLevelIndex(idx);
    worldRef.current = createWorldFromLevel(generateLevel(idx));
    weaponPowerRef.current = 0;
    setWeaponPowerUI(0);
    lastTimeRef.current = 0;
    accumulatorRef.current = 0;
    setScreen("playing");
  }, []);

  // ---- loop principal: paso de física FIJO (60Hz) vía acumulador,
  // desacoplado del refresh rate real de la pantalla — estable sin
  // importar si el dispositivo corre a 60/90/120Hz. Todo lo que lee
  // (mundo, teclas, joystick) vive en refs, así que este callback se
  // crea UNA sola vez y nunca queda con closures viejas. ----
  const loop = useCallback((timeMs) => {
    rafRef.current = requestAnimationFrame(loop);
    const world = worldRef.current;
    if (!world) return;

    if (lastTimeRef.current === 0) lastTimeRef.current = timeMs;
    let frameDt = (timeMs - lastTimeRef.current) / 1000;
    lastTimeRef.current = timeMs;
    frameDt = Math.min(frameDt, 0.25); // evita saltos grandes si la pestaña estuvo en segundo plano

    accumulatorRef.current += frameDt;

    const keys = keysDownRef.current;
    let axis = joystickRef.current.dx || 0;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) axis = -1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) axis = 1;
    inputRef.current.moveAxis = axis;

    let goldGained = 0;
    let cleared = false;
    let failed = false;
    let steps = 0;
    while (accumulatorRef.current >= FIXED_DT && steps < MAX_SUBSTEPS_PER_FRAME) {
      const events = stepPhysics(world, FIXED_DT, inputRef.current);
      goldGained += events.goldGained;
      cleared = cleared || events.cleared;
      failed = failed || events.failed;
      accumulatorRef.current -= FIXED_DT;
      steps++;
    }
    inputRef.current.wantJump = false;
    inputRef.current.wantAttack = false;

    if (goldGained > 0) {
      setSave((prev) => ({ ...prev, gold: prev.gold + goldGained }));
    }
    const currentPower = world.player.hasWeapon ? world.player.weaponPower : 0;
    if (currentPower !== weaponPowerRef.current) {
      weaponPowerRef.current = currentPower;
      setWeaponPowerUI(currentPower);
    }

    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) {
      renderWorld(ctx, world, characterRef.current, timeMs / 1000, {
        levelNumber: levelIndexRef.current + 1,
        totalLevels: TOTAL_LEVELS,
        tierLabel: TIER_LABELS[tierForLevel(levelIndexRef.current)],
        gold: saveRef.current.gold,
      });
    }

    if (cleared) {
      const next = levelIndexRef.current + 1;
      setSave((prev) => ({ ...prev, furthestLevel: Math.max(prev.furthestLevel, next) }));
      if (next >= TOTAL_LEVELS) {
        setScreen("victory");
      } else {
        setLevelMsg(`¡Nivel ${levelIndexRef.current + 1} superado!`);
        setScreen("cleared");
      }
    } else if (failed) {
      // "reinician el nivel" — no la partida completa: se regenera el
      // MISMO nivel (misma semilla) y se sigue jugando sin salir de
      // 'playing', sin interrumpir con una pantalla intermedia.
      worldRef.current = createWorldFromLevel(generateLevel(levelIndexRef.current));
      weaponPowerRef.current = 0;
      setWeaponPowerUI(0);
    }
  }, []);

  useEffect(() => {
    if (screen !== "playing") return undefined;
    lastTimeRef.current = 0;
    accumulatorRef.current = 0;
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [screen, loop]);

  const handleSelectCharacter = (id) => {
    setSave((prev) => ({ ...prev, selected: id }));
  };

  const handleUnlockCharacter = (id, cost) => {
    setSave((prev) => {
      if (prev.unlocked.includes(id) || prev.gold < cost) return prev;
      return { ...prev, gold: prev.gold - cost, unlocked: [...prev.unlocked, id] };
    });
  };

  const handlePlay = () => {
    startLevel(Math.min(save.furthestLevel, TOTAL_LEVELS - 1));
  };

  return (
    <div className="tz-eg-overlay" ref={containerRef}>
      <button type="button" className="tz-eg-close" onClick={onClose} aria-label="Cerrar juego">
        <X size={22} />
      </button>

      {screen === "select" && (
        <CharacterSelectScreen
          save={save}
          onSelect={handleSelectCharacter}
          onUnlock={handleUnlockCharacter}
          onPlay={handlePlay}
        />
      )}

      {(screen === "playing" || screen === "cleared" || screen === "victory") && (
        <div className="tz-eg-game-area">
          <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} className="tz-eg-canvas" />

          {screen === "playing" && (
            <>
              <VirtualJoystick
                onChange={(dx) => {
                  joystickRef.current.dx = dx;
                }}
              />
              <button
                type="button"
                className="tz-eg-btn tz-eg-btn-jump"
                onPointerDown={(e) => {
                  e.preventDefault();
                  inputRef.current.wantJump = true;
                }}
              >
                SALTAR
              </button>
              <button
                type="button"
                className="tz-eg-btn tz-eg-btn-action"
                onPointerDown={(e) => {
                  e.preventDefault();
                  inputRef.current.wantAttack = true;
                }}
              >
                {weaponPowerUI === 2 ? "CAÑÓN" : weaponPowerUI === 1 ? "DISPARAR" : "GOLPE"}
              </button>
            </>
          )}

          {screen === "cleared" && (
            <div className="tz-eg-overlay-msg">
              <h2>{levelMsg}</h2>
              <button type="button" className="tz-eg-continue-btn" onClick={() => startLevel(levelIndex + 1)}>
                Siguiente Nivel →
              </button>
            </div>
          )}

          {screen === "victory" && (
            <div className="tz-eg-overlay-msg">
              <h2>🏆 ¡Completaste los {TOTAL_LEVELS} niveles!</h2>
              <p>Zapitos Dorados totales: {save.gold}</p>
              <button type="button" className="tz-eg-continue-btn" onClick={() => setScreen("select")}>
                Volver al menú
              </button>
            </div>
          )}
        </div>
      )}

      <div className="tz-eg-rotate-hint">
        <p>🔄 Gira tu dispositivo para jugar</p>
      </div>
    </div>
  );
}
