const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const miniMap = document.getElementById("miniMap");
const hud = document.getElementById("hud");
const menu = document.getElementById("menu");
const playBtn = document.getElementById("play");
const playerNameInput = document.getElementById("playerName");
const lengthEl = document.getElementById("length");
const scoreEl = document.getElementById("score");
const botsEl = document.getElementById("bots");
const soundToggle = document.getElementById("soundToggle");

const WORLD_SIZE = 4200;
const FOOD_COUNT = 800;
const BOT_COUNT = 18;
const BASE_SPEED = 120;
const BOOST_SPEED = 200;
const TURN_SPEED = 3.2;
const SEGMENT_SPACING = 6;
const START_LENGTH = 140;
const MIN_LENGTH = 60;
const FOOD_VALUE = 18;
const BOOST_DRAIN = 32;

const state = {
  running: false,
  lastTime: 0,
  player: null,
  snakes: [],
  foods: [],
  particles: [],
  pointer: { x: 0, y: 0, active: false, boosting: false },
  score: 0,
  audio: { enabled: true, ctx: null },
};

const skins = [
  "#ffd166",
  "#ef476f",
  "#06d6a0",
  "#118ab2",
  "#f78c6b",
  "#c77dff",
  "#80ed99",
  "#f9c74f",
  "#e07a5f",
  "#7bdff2",
];

function setupSkins() {
  const picker = document.getElementById("skinPicker");
  skins.forEach((color, index) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "skin";
    swatch.style.background = color;
    if (index === 0) swatch.classList.add("selected");
    swatch.addEventListener("click", () => {
      document.querySelectorAll(".skin").forEach((s) => s.classList.remove("selected"));
      swatch.classList.add("selected");
    });
    picker.appendChild(swatch);
  });
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  miniMap.innerHTML = "";
  const mapCanvas = document.createElement("canvas");
  mapCanvas.width = miniMap.clientWidth * dpr;
  mapCanvas.height = miniMap.clientHeight * dpr;
  mapCanvas.style.width = "100%";
  mapCanvas.style.height = "100%";
  mapCanvas.dataset.dpr = dpr;
  miniMap.appendChild(mapCanvas);
}

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function pickSelectedSkin() {
  const selected = document.querySelector(".skin.selected");
  return selected ? selected.style.background : skins[0];
}

function createSnake({ name, color, isBot }) {
  const angle = rand(0, Math.PI * 2);
  const x = rand(-WORLD_SIZE / 2, WORLD_SIZE / 2);
  const y = rand(-WORLD_SIZE / 2, WORLD_SIZE / 2);
  const segments = [];
  for (let i = 0; i < START_LENGTH; i += SEGMENT_SPACING) {
    segments.push({
      x: x - Math.cos(angle) * i,
      y: y - Math.sin(angle) * i,
    });
  }
  return {
    id: crypto.randomUUID(),
    name,
    color,
    isBot,
    segments,
    angle,
    targetAngle: angle,
    speed: BASE_SPEED,
    length: START_LENGTH,
    radius: 8,
    alive: true,
    boostCooldown: 0,
    ai: {
      goal: null,
      lastSwitch: 0,
      cautious: rand(0.2, 0.8),
    },
  };
}

function spawnFood(count) {
  for (let i = 0; i < count; i++) {
    state.foods.push({
      x: rand(-WORLD_SIZE / 2, WORLD_SIZE / 2),
      y: rand(-WORLD_SIZE / 2, WORLD_SIZE / 2),
      value: FOOD_VALUE,
      color: `hsl(${Math.floor(rand(0, 360))} 80% 60%)`,
    });
  }
}

function resetGame() {
  state.snakes = [];
  state.foods = [];
  state.particles = [];
  state.score = 0;

  const playerName = playerNameInput.value.trim() || "Player";
  const player = createSnake({
    name: playerName,
    color: pickSelectedSkin(),
    isBot: false,
  });
  state.player = player;
  state.snakes.push(player);

  for (let i = 0; i < BOT_COUNT; i++) {
    state.snakes.push(
      createSnake({
        name: `Bot ${i + 1}`,
        color: `hsl(${Math.floor(rand(0, 360))} 70% 55%)`,
        isBot: true,
      })
    );
  }

  spawnFood(FOOD_COUNT);
}

function toScreen(pos, camera) {
  return {
    x: pos.x - camera.x + canvas.clientWidth / 2,
    y: pos.y - camera.y + canvas.clientHeight / 2,
  };
}

function updatePlayerInput(e) {
  const rect = canvas.getBoundingClientRect();
  state.pointer.x = e.clientX - rect.left;
  state.pointer.y = e.clientY - rect.top;
  state.pointer.active = true;
}

function updateTouchInput(e) {
  const touch = e.touches[0];
  if (!touch) return;
  const rect = canvas.getBoundingClientRect();
  state.pointer.x = touch.clientX - rect.left;
  state.pointer.y = touch.clientY - rect.top;
  state.pointer.active = true;
}

function setBoosting(value) {
  state.pointer.boosting = value;
}

function aimTowardsPointer(player) {
  if (!state.pointer.active) return;
  const dx = state.pointer.x - canvas.clientWidth / 2;
  const dy = state.pointer.y - canvas.clientHeight / 2;
  player.targetAngle = Math.atan2(dy, dx);
}

function lerpAngle(a, b, t) {
  const diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return a + diff * t;
}

function updateSnake(snake, dt) {
  if (!snake.alive) return;
  const turnRate = TURN_SPEED * dt;
  snake.angle = lerpAngle(snake.angle, snake.targetAngle, turnRate);

  const boosting = snake === state.player ? state.pointer.boosting : snake.boostCooldown > 0;
  const speed = boosting ? BOOST_SPEED : BASE_SPEED;
  snake.speed = speed;

  const head = snake.segments[0];
  const nx = head.x + Math.cos(snake.angle) * speed * dt;
  const ny = head.y + Math.sin(snake.angle) * speed * dt;

  head.x = clamp(nx, -WORLD_SIZE / 2, WORLD_SIZE / 2);
  head.y = clamp(ny, -WORLD_SIZE / 2, WORLD_SIZE / 2);

  for (let i = 1; i < snake.segments.length; i++) {
    const prev = snake.segments[i - 1];
    const seg = snake.segments[i];
    const dx = seg.x - prev.x;
    const dy = seg.y - prev.y;
    const dist = Math.hypot(dx, dy) || 1;
    const target = SEGMENT_SPACING;
    seg.x = prev.x + (dx / dist) * target;
    seg.y = prev.y + (dy / dist) * target;
  }

  snake.segments[0] = { x: head.x, y: head.y };
  snake.segments = snake.segments.slice(0, Math.ceil(snake.length / SEGMENT_SPACING));

  if (boosting && snake.length > MIN_LENGTH) {
    snake.length -= BOOST_DRAIN * dt;
    if (Math.random() < dt * 2) {
      state.foods.push({
        x: head.x - Math.cos(snake.angle) * 12,
        y: head.y - Math.sin(snake.angle) * 12,
        value: FOOD_VALUE / 2,
        color: "#ffffff",
      });
    }
  }
}

function updateAI(snake, dt) {
  if (!snake.isBot || !snake.alive) return;
  snake.ai.lastSwitch += dt;

  if (!snake.ai.goal || snake.ai.lastSwitch > rand(2, 4)) {
    snake.ai.goal = pickFoodGoal(snake);
    snake.ai.lastSwitch = 0;
  }

  const danger = findNearestThreat(snake);
  if (danger) {
    const away = Math.atan2(snake.segments[0].y - danger.y, snake.segments[0].x - danger.x);
    snake.targetAngle = away + rand(-0.3, 0.3);
    snake.boostCooldown = rand(0.4, 1.1);
    return;
  }

  if (snake.ai.goal) {
    const dx = snake.ai.goal.x - snake.segments[0].x;
    const dy = snake.ai.goal.y - snake.segments[0].y;
    snake.targetAngle = Math.atan2(dy, dx);
  }

  if (snake.boostCooldown > 0) {
    snake.boostCooldown -= dt;
  }
}

function pickFoodGoal(snake) {
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < state.foods.length; i++) {
    const food = state.foods[i];
    const d = dist2(food, snake.segments[0]);
    if (d < bestDist) {
      bestDist = d;
      best = food;
    }
  }
  return best;
}

function findNearestThreat(snake) {
  let threat = null;
  let threatDist = Infinity;
  for (const other of state.snakes) {
    if (other === snake || !other.alive) continue;
    if (other.length < snake.length * 1.2) continue;
    const d = dist2(other.segments[0], snake.segments[0]);
    if (d < 220 * 220 && d < threatDist) {
      threatDist = d;
      threat = other.segments[0];
    }
  }
  return threat;
}

function consumeFood(snake) {
  const head = snake.segments[0];
  for (let i = state.foods.length - 1; i >= 0; i--) {
    const food = state.foods[i];
    if (dist2(food, head) < (snake.radius + 6) ** 2) {
      snake.length += food.value;
      if (snake === state.player) {
        state.score += Math.floor(food.value);
      }
      spawnParticles(food.x, food.y, food.color, 8);
      state.foods.splice(i, 1);
    }
  }
}

function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    state.particles.push({
      x,
      y,
      vx: rand(-60, 60),
      vy: rand(-60, 60),
      life: rand(0.3, 0.7),
      color,
    });
  }
}

function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;
    if (p.life <= 0) state.particles.splice(i, 1);
  }
}

function checkCollisions() {
  for (const snake of state.snakes) {
    if (!snake.alive) continue;
    const head = snake.segments[0];
    for (const other of state.snakes) {
      if (!other.alive) continue;
      if (other === snake) {
        continue;
      } else {
        for (let i = 0; i < other.segments.length; i++) {
          const seg = other.segments[i];
          if (dist2(head, seg) < (snake.radius + 4) ** 2) {
            killSnake(snake, other);
            break;
          }
        }
      }
      if (!snake.alive) break;
    }
  }

  for (let i = 0; i < state.snakes.length; i++) {
    const a = state.snakes[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < state.snakes.length; j++) {
      const b = state.snakes[j];
      if (!b.alive) continue;
      if (dist2(a.segments[0], b.segments[0]) < (a.radius + b.radius + 2) ** 2) {
        if (a.length > b.length * 1.05) {
          killSnake(b, a);
        } else if (b.length > a.length * 1.05) {
          killSnake(a, b);
        } else {
          killSnake(a, b);
          killSnake(b, a);
        }
      }
    }
  }
}

function killSnake(snake, killer) {
  if (!snake.alive) return;
  snake.alive = false;
  snake.segments.forEach((seg, idx) => {
    if (idx % 2 === 0) {
      state.foods.push({
        x: seg.x,
        y: seg.y,
        value: FOOD_VALUE,
        color: snake.color,
      });
    }
  });
  if (snake === state.player) {
    state.running = false;
    menu.classList.remove("hidden");
    hud.classList.add("hidden");
  } else if (killer === state.player) {
    state.score += Math.floor(snake.length / 3);
  }
}

function drawBackground(camera) {
  const gridSize = 60;
  ctx.save();
  ctx.translate(-camera.x + canvas.clientWidth / 2, -camera.y + canvas.clientHeight / 2);
  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  const startX = Math.floor((camera.x - canvas.clientWidth / 2) / gridSize) * gridSize;
  const startY = Math.floor((camera.y - canvas.clientHeight / 2) / gridSize) * gridSize;
  for (let x = startX; x < camera.x + canvas.clientWidth / 2 + gridSize; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, camera.y - canvas.clientHeight / 2 - gridSize);
    ctx.lineTo(x, camera.y + canvas.clientHeight / 2 + gridSize);
    ctx.stroke();
  }
  for (let y = startY; y < camera.y + canvas.clientHeight / 2 + gridSize; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(camera.x - canvas.clientWidth / 2 - gridSize, y);
    ctx.lineTo(camera.x + canvas.clientWidth / 2 + gridSize, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFood(camera) {
  for (const food of state.foods) {
    const p = toScreen(food, camera);
    ctx.beginPath();
    ctx.fillStyle = food.color;
    ctx.shadowBlur = 10;
    ctx.shadowColor = food.color;
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

function drawSnake(snake, camera) {
  if (!snake.alive) return;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = snake.color;
  ctx.shadowBlur = 18;
  ctx.shadowColor = snake.color;

  ctx.beginPath();
  snake.segments.forEach((seg, idx) => {
    const p = toScreen(seg, camera);
    if (idx === 0) {
      ctx.moveTo(p.x, p.y);
    } else {
      ctx.lineTo(p.x, p.y);
    }
  });
  ctx.lineWidth = snake.radius * 1.6;
  ctx.stroke();
  ctx.shadowBlur = 0;

  const head = toScreen(snake.segments[0], camera);
  ctx.fillStyle = "#0f0f0f";
  ctx.beginPath();
  ctx.arc(head.x - 4, head.y - 3, 2, 0, Math.PI * 2);
  ctx.arc(head.x + 4, head.y - 3, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "12px 'IBM Plex Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(snake.name, head.x, head.y - 16);
  ctx.restore();
}

function drawParticles(camera) {
  for (const p of state.particles) {
    const pos = toScreen(p, camera);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(p.life, 0);
    ctx.fillRect(pos.x, pos.y, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawMiniMap() {
  const mapCanvas = miniMap.querySelector("canvas");
  if (!mapCanvas) return;
  const mctx = mapCanvas.getContext("2d");
  const dpr = Number(mapCanvas.dataset.dpr || 1);
  const w = mapCanvas.width / dpr;
  const h = mapCanvas.height / dpr;
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mctx.clearRect(0, 0, w, h);
  mctx.fillStyle = "rgba(255,255,255,0.06)";
  mctx.fillRect(0, 0, w, h);
  const scale = w / WORLD_SIZE;
  for (const snake of state.snakes) {
    if (!snake.alive) continue;
    const head = snake.segments[0];
    mctx.fillStyle = snake === state.player ? "#ffffff" : snake.color;
    mctx.beginPath();
    mctx.arc(
      (head.x + WORLD_SIZE / 2) * scale,
      (head.y + WORLD_SIZE / 2) * scale,
      3,
      0,
      Math.PI * 2
    );
    mctx.fill();
  }
}

function updateHUD() {
  lengthEl.textContent = Math.floor(state.player?.length || 0);
  scoreEl.textContent = state.score;
  botsEl.textContent = state.snakes.filter((s) => s.isBot && s.alive).length;
}

function playTone(freq, duration = 0.12) {
  if (!state.audio.enabled) return;
  if (!state.audio.ctx) {
    state.audio.ctx = new AudioContext();
  }
  const ctxAudio = state.audio.ctx;
  const osc = ctxAudio.createOscillator();
  const gain = ctxAudio.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.value = 0.08;
  osc.connect(gain).connect(ctxAudio.destination);
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.0001, ctxAudio.currentTime + duration);
  osc.stop(ctxAudio.currentTime + duration);
}

function gameLoop(timestamp) {
  if (!state.running) return;
  const dt = Math.min((timestamp - state.lastTime) / 1000, 0.032);
  state.lastTime = timestamp;

  aimTowardsPointer(state.player);

  for (const snake of state.snakes) {
    updateAI(snake, dt);
    updateSnake(snake, dt);
    consumeFood(snake);
  }

  checkCollisions();
  updateParticles(dt);

  if (state.foods.length < FOOD_COUNT) {
    spawnFood(FOOD_COUNT - state.foods.length);
  }

  const camera = state.player ? state.player.segments[0] : { x: 0, y: 0 };
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  drawBackground(camera);
  drawFood(camera);
  for (const snake of state.snakes) {
    drawSnake(snake, camera);
  }
  drawParticles(camera);
  drawMiniMap();
  updateHUD();

  requestAnimationFrame(gameLoop);
}

function startGame() {
  resetGame();
  state.running = true;
  state.lastTime = performance.now();
  menu.classList.add("hidden");
  hud.classList.remove("hidden");
  playTone(440, 0.2);
  requestAnimationFrame(gameLoop);
}

playBtn.addEventListener("click", () => {
  if (!state.running) {
    startGame();
  }
});

soundToggle.addEventListener("click", () => {
  state.audio.enabled = !state.audio.enabled;
  soundToggle.textContent = `Sound: ${state.audio.enabled ? "On" : "Off"}`;
  if (state.audio.enabled) playTone(520, 0.1);
});

canvas.addEventListener("mousemove", updatePlayerInput);
canvas.addEventListener("touchmove", (e) => {
  updateTouchInput(e);
  e.preventDefault();
}, { passive: false });

window.addEventListener("mousedown", () => setBoosting(true));
window.addEventListener("mouseup", () => setBoosting(false));
window.addEventListener("touchstart", () => setBoosting(true));
window.addEventListener("touchend", () => setBoosting(false));
window.addEventListener("resize", resize);

setupSkins();
resize();
