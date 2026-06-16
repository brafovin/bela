// ===========================
//  CONSTANTS
// ===========================
const CW = 920;
const CH = 580;
const FX = 65;    // field left x
const FY = 45;    // field top y
const FW = 790;   // field width
const FH = 490;   // field height
const FCX = FX + FW / 2;   // center x = 460
const FCY = FY + FH / 2;   // center y = 290
const GOAL_H = 136;
const GOAL_DEPTH = 38;
const GOAL_TOP = FCY - GOAL_H / 2;
const GOAL_BOT = FCY + GOAL_H / 2;
const PR = 17;    // player radius
const BR = 10;    // ball radius
const GAME_SECS = 5 * 60;

// ===========================
//  STATE
// ===========================
let canvas, ctx;
let state = 'selection'; // selection | playing | goal | paused | gameover
let playerTeam = null;
let cpuTeam    = null;
let playerScore = 0;
let cpuScore    = 0;
let timeLeft    = GAME_SECS;
let lastTs      = null;
let rafId       = null;
let goalTimer   = 0;
let goalSide    = null; // 'player' | 'cpu'
let controlledP = null;
let lastScoredBy = null; // for kickoff direction

const keys = {};
const ball  = { x: FCX, y: FCY, vx: 0, vy: 0, spin: 0 };
let players = [];

// ===========================
//  PLAYER CLASS
// ===========================
class Player {
  constructor(x, y, team, role, teamData) {
    this.x  = x; this.startX = x;
    this.y  = y; this.startY = y;
    this.vx = 0; this.vy = 0;
    this.team = team;
    this.role = role;
    this.data = teamData;
    this.maxSpd = this._calcSpeed();
    this.aiTimer = Math.random() * 15;
  }

  _calcSpeed() {
    const base = 3.2 + (this.data.speed / 100) * 2.4;
    return base * ({ gk: 0.78, def: 0.88, mid: 0.97, att: 1.08 }[this.role] ?? 1);
  }
}

// ===========================
//  BOOT
// ===========================
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas.getContext('2d');
  canvas.width  = CW;
  canvas.height = CH;

  buildTeamGrid();
  setupInput();

  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('pause-btn').addEventListener('click', togglePause);
  document.getElementById('resume-btn').addEventListener('click', togglePause);
});

// ===========================
//  TEAM SELECTION
// ===========================
function buildTeamGrid() {
  const grid = document.getElementById('teams-grid');
  TEAMS.forEach(t => {
    const card = document.createElement('div');
    card.className = 'team-card';
    const light = isColorLight(t.primaryColor);
    const textCol = light ? '#111' : '#fff';
    card.innerHTML = `
      <div class="team-emblem" style="background:${t.primaryColor};color:${textCol};border:3px solid ${t.secondaryColor}">${t.shortName}</div>
      <div class="team-name">${t.name}</div>
      <div class="team-country">${t.country}</div>
      <div class="team-rating">★ ${t.rating}</div>
    `;
    card.addEventListener('click', () => {
      document.querySelectorAll('.team-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      playerTeam = t;
      const others = TEAMS.filter(o => o.id !== t.id);
      cpuTeam = others[Math.floor(Math.random() * others.length)];
      document.getElementById('selected-name').textContent = t.name;
      document.getElementById('selected-info').classList.remove('hidden');
    });
    grid.appendChild(card);
  });
}

function isColorLight(hex) {
  const v = parseInt(hex.replace('#',''), 16);
  return (0.299*((v>>16)&255) + 0.587*((v>>8)&255) + 0.114*(v&255)) > 170;
}

// ===========================
//  GAME START
// ===========================
function startGame() {
  if (!playerTeam) return;
  document.getElementById('selection-screen').classList.add('hidden');
  document.getElementById('game-screen').classList.remove('hidden');

  playerScore = 0; cpuScore = 0;
  timeLeft = GAME_SECS;
  state = 'playing';
  lastScoredBy = null;

  setupHUD();
  spawnPlayers();
  resetKickoff(null);
  updateHUD();

  if (rafId) cancelAnimationFrame(rafId);
  lastTs = null;
  rafId = requestAnimationFrame(loop);
}

function setupHUD() {
  const pLight = isColorLight(playerTeam.primaryColor);
  const cLight = isColorLight(cpuTeam.primaryColor);

  const pb = document.getElementById('player-badge');
  pb.textContent = playerTeam.shortName;
  pb.style.background = playerTeam.primaryColor;
  pb.style.color = pLight ? '#111' : '#fff';
  pb.style.border = `2px solid ${playerTeam.secondaryColor}`;

  const cb = document.getElementById('cpu-badge');
  cb.textContent = cpuTeam.shortName;
  cb.style.background = cpuTeam.primaryColor;
  cb.style.color = cLight ? '#111' : '#fff';
  cb.style.border = `2px solid ${cpuTeam.secondaryColor}`;

  document.getElementById('player-team-name').textContent = playerTeam.name;
  document.getElementById('cpu-team-name').textContent    = cpuTeam.name;
}

// ===========================
//  SPAWN PLAYERS
// ===========================
function spawnPlayers() {
  players = [];
  // Player team (left side → attacks right goal)
  players.push(new Player( 98, FCY,       'player', 'gk',  playerTeam));
  players.push(new Player(220, FCY - 55,  'player', 'def', playerTeam));
  players.push(new Player(220, FCY + 55,  'player', 'def', playerTeam));
  players.push(new Player(360, FCY,       'player', 'mid', playerTeam));
  players.push(new Player(440, FCY - 30,  'player', 'att', playerTeam));

  // CPU team (right side → attacks left goal)
  players.push(new Player(822, FCY,       'cpu', 'gk',  cpuTeam));
  players.push(new Player(700, FCY + 55,  'cpu', 'def', cpuTeam));
  players.push(new Player(700, FCY - 55,  'cpu', 'def', cpuTeam));
  players.push(new Player(560, FCY,       'cpu', 'mid', cpuTeam));
  players.push(new Player(480, FCY + 30,  'cpu', 'att', cpuTeam));
}

function resetKickoff(scorer) {
  players.forEach(p => { p.x = p.startX; p.y = p.startY; p.vx = 0; p.vy = 0; });
  ball.x = FCX; ball.y = FCY;
  ball.vx = scorer === 'player' ? -1.5 : 1.5; // loser kicks off
  ball.vy = 0;
  ball.spin = 0;
  controlledP = null;
}

// ===========================
//  INPUT
// ===========================
function setupInput() {
  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    keys[e.key]  = true;
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
    if (e.code === 'Space' && state === 'playing') shoot();
    if (e.code === 'Escape') togglePause();
  });
  window.addEventListener('keyup', e => {
    keys[e.code] = false;
    keys[e.key]  = false;
  });
}

function togglePause() {
  if (state === 'playing') {
    state = 'paused';
    document.getElementById('pause-screen').classList.remove('hidden');
  } else if (state === 'paused') {
    state = 'playing';
    document.getElementById('pause-screen').classList.add('hidden');
    lastTs = null;
  }
}

// ===========================
//  MAIN LOOP
// ===========================
function loop(ts) {
  rafId = requestAnimationFrame(loop);
  if (!lastTs) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;

  if (state === 'playing') { update(dt); }
  else if (state === 'goal') {
    goalTimer -= dt;
    if (goalTimer <= 0) {
      document.getElementById('goal-banner').classList.remove('show');
      state = 'playing';
      resetKickoff(goalSide);
    }
  }
  render();
}

// ===========================
//  UPDATE
// ===========================
function update(dt) {
  timeLeft -= dt;
  if (timeLeft <= 0) { timeLeft = 0; endGame(); return; }
  updateHUD();
  selectControlled();
  moveControlled();
  moveAI(dt);
  physBall();
  resolveAllCollisions();
  detectGoal();
}

// pick player-team outfield player closest to ball
function selectControlled() {
  let best = null, bestD = Infinity;
  players.forEach(p => {
    if (p.team !== 'player' || p.role === 'gk') return;
    const d = dist(p, ball);
    if (d < bestD) { bestD = d; best = p; }
  });
  controlledP = best;
}

function moveControlled() {
  const p = controlledP;
  if (!p) return;

  let dx = 0, dy = 0;
  if (keys['ArrowLeft']  || keys['KeyA']) dx -= 1;
  if (keys['ArrowRight'] || keys['KeyD']) dx += 1;
  if (keys['ArrowUp']    || keys['KeyW']) dy -= 1;
  if (keys['ArrowDown']  || keys['KeyS']) dy += 1;

  if (dx || dy) {
    const len = Math.hypot(dx, dy);
    p.vx = (dx/len) * p.maxSpd;
    p.vy = (dy/len) * p.maxSpd;
  } else {
    p.vx *= 0.75;
    p.vy *= 0.75;
  }

  p.x = clamp(p.x + p.vx, FX + PR, FX + FW - PR);
  p.y = clamp(p.y + p.vy, FY + PR, FY + FH - PR);
}

// ===========================
//  AI
// ===========================
function moveAI(dt) {
  players.forEach(p => {
    if (p === controlledP) return;

    let tx, ty;

    if (p.team === 'player' && p.role === 'gk') {
      tx = 98;
      ty = clamp(ball.y, GOAL_TOP + PR + 4, GOAL_BOT - PR - 4);
      if (ball.x < FCX * 0.55) { tx = Math.min(180, ball.x - 25); ty = ball.y; }
    }

    else if (p.team === 'player') {
      // Non-controlled outfield player: drift back to formation
      tx = p.startX;
      ty = p.startY + (ball.y - FCY) * 0.25;
    }

    else if (p.team === 'cpu') {
      const agg = 0.55 + (p.data.rating / 100) * 0.45;

      if (p.role === 'gk') {
        tx = 822;
        ty = clamp(ball.y, GOAL_TOP + PR + 4, GOAL_BOT - PR - 4);
        if (ball.x > FX + FW * 0.65) {
          const rush = dist(p, ball) < 120;
          tx = rush ? ball.x + 25 : 765;
          ty = ball.y;
        }
      }
      else if (p.role === 'def') {
        if (ball.x > FCX) {
          tx = 700 + (ball.x - FCX) * 0.15;
          ty = ball.y;
        } else {
          tx = p.startX;
          ty = p.startY + (ball.y - FCY) * 0.3;
        }
      }
      else if (p.role === 'mid') {
        tx = ball.x + 20;
        ty = ball.y;
      }
      else if (p.role === 'att') {
        if (ball.x > FCX - 80) {
          tx = ball.x;
          ty = ball.y;
        } else {
          tx = FX + FW * 0.36;
          ty = FCY + (ball.y - FCY) * agg;
        }
      }
    }

    if (tx !== undefined) {
      const dx = tx - p.x, dy = ty - p.y;
      const d  = Math.hypot(dx, dy);
      if (d > 3) {
        p.vx = (dx/d) * p.maxSpd;
        p.vy = (dy/d) * p.maxSpd;
      } else { p.vx = 0; p.vy = 0; }
      p.x = clamp(p.x + p.vx, FX + PR, FX + FW - PR);
      p.y = clamp(p.y + p.vy, FY + PR, FY + FH - PR);
    }
  });
}

// ===========================
//  BALL PHYSICS
// ===========================
function physBall() {
  ball.vx *= 0.982;
  ball.vy *= 0.982;
  ball.spin *= 0.97;
  if (Math.abs(ball.vx) < 0.04) ball.vx = 0;
  if (Math.abs(ball.vy) < 0.04) ball.vy = 0;

  ball.x += ball.vx;
  ball.y += ball.vy;

  const inGoalY = ball.y > GOAL_TOP - BR && ball.y < GOAL_BOT + BR;

  // top/bottom walls
  if (ball.y - BR < FY)      { ball.y = FY + BR;      ball.vy =  Math.abs(ball.vy) * 0.65; }
  if (ball.y + BR > FY + FH) { ball.y = FY + FH - BR; ball.vy = -Math.abs(ball.vy) * 0.65; }

  // left wall
  if (ball.x - BR < FX && !inGoalY) { ball.x = FX + BR; ball.vx =  Math.abs(ball.vx) * 0.65; }
  // right wall
  if (ball.x + BR > FX + FW && !inGoalY) { ball.x = FX + FW - BR; ball.vx = -Math.abs(ball.vx) * 0.65; }

  // goal back walls
  if (ball.x - BR < FX - GOAL_DEPTH) { ball.x = FX - GOAL_DEPTH + BR; ball.vx =  Math.abs(ball.vx) * 0.5; }
  if (ball.x + BR > FX + FW + GOAL_DEPTH) { ball.x = FX + FW + GOAL_DEPTH - BR; ball.vx = -Math.abs(ball.vx) * 0.5; }

  // goal top/bottom posts (Y clamp when in goal zone)
  if ((ball.x < FX + 5 || ball.x > FX + FW - 5) && ball.x > FX - GOAL_DEPTH && ball.x < FX + FW + GOAL_DEPTH) {
    if (ball.y - BR < GOAL_TOP) { ball.y = GOAL_TOP + BR; ball.vy = Math.abs(ball.vy) * 0.6; }
    if (ball.y + BR > GOAL_BOT) { ball.y = GOAL_BOT - BR; ball.vy = -Math.abs(ball.vy) * 0.6; }
  }
}

// ===========================
//  COLLISIONS
// ===========================
function resolveAllCollisions() {
  players.forEach(p => {
    const d = dist(p, ball);
    const min = PR + BR;
    if (d < min && d > 0.01) {
      const nx = (ball.x - p.x) / d;
      const ny = (ball.y - p.y) / d;

      // push ball out
      const overlap = min - d;
      ball.x += nx * overlap;
      ball.y += ny * overlap;

      const spd = Math.hypot(p.vx, p.vy);
      const kick = Math.max(6, spd * 1.6);

      // base impulse along normal
      ball.vx = nx * kick + p.vx * 0.4;
      ball.vy = ny * kick + p.vy * 0.4;
      ball.spin = (p.vx * ny - p.vy * nx) * 0.3;

      // add aimed direction for CPU outfield
      if (p.team === 'cpu' && p.role !== 'gk') {
        const acc = 0.35 + (p.data.attackRating / 100) * 0.4;
        const scatter = (1 - p.data.attackRating / 100) * GOAL_H * 0.7;
        const tx = FX - 10;
        const ty = FCY + (Math.random() - 0.5) * scatter;
        const tdx = tx - ball.x, tdy = ty - ball.y;
        const tl  = Math.hypot(tdx, tdy);
        ball.vx = lerp(ball.vx, (tdx/tl)*kick, acc);
        ball.vy = lerp(ball.vy, (tdy/tl)*kick, acc);
      }

      // GKs kick away from their goal
      if (p.role === 'gk') {
        if (p.team === 'cpu') {
          ball.vx = -Math.abs(ball.vx) * 1.4 - 4;
          ball.vy = (Math.random() - 0.5) * 9;
        } else {
          ball.vx =  Math.abs(ball.vx) * 1.4 + 4;
          ball.vy = (Math.random() - 0.5) * 9;
        }
      }
    }
  });

  // simple player-player separation
  for (let i = 0; i < players.length; i++) {
    for (let j = i+1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const d = dist(a, b);
      if (d < PR * 2 && d > 0.01) {
        const nx = (b.x - a.x) / d;
        const ny = (b.y - a.y) / d;
        const push = (PR * 2 - d) * 0.4;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }
}

// ===========================
//  SHOOT (Space key)
// ===========================
function shoot() {
  const p = controlledP;
  if (!p) return;
  const d = dist(p, ball);
  if (d > PR + BR + 28) return;

  const tx = FX + FW + GOAL_DEPTH;
  const scatter = (Math.random() - 0.5) * GOAL_H * 0.55;
  const ty = FCY + scatter;
  const dx = tx - ball.x, dy = ty - ball.y;
  const l  = Math.hypot(dx, dy);
  const pwr = 16 + Math.hypot(p.vx, p.vy) * 0.5;
  ball.vx = (dx/l) * pwr;
  ball.vy = (dy/l) * pwr;
}

// ===========================
//  GOAL DETECTION
// ===========================
function detectGoal() {
  const inGoalBand = ball.y >= GOAL_TOP && ball.y <= GOAL_BOT;

  // ball crosses left goal line → CPU scores
  if (ball.x < FX - 4 && inGoalBand) {
    cpuScore++;
    goalSide = 'cpu';
    showGoal();
    return;
  }
  // ball crosses right goal line → player scores
  if (ball.x > FX + FW + 4 && inGoalBand) {
    playerScore++;
    goalSide = 'player';
    showGoal();
  }
}

function showGoal() {
  state = 'goal';
  goalTimer = 2.8;
  updateHUD();

  const banner = document.getElementById('goal-banner');
  if (goalSide === 'player') {
    banner.textContent = '⚽  TOR!';
    banner.className = 'player-goal show';
  } else {
    banner.textContent = '💔  Gegentor!';
    banner.className = 'cpu-goal show';
  }
}

// ===========================
//  END GAME
// ===========================
function endGame() {
  state = 'gameover';
  cancelAnimationFrame(rafId);

  const pCol = playerTeam.primaryColor;
  const cCol = cpuTeam.primaryColor;
  document.getElementById('final-player-score').textContent = playerScore;
  document.getElementById('final-player-score').style.color = pCol;
  document.getElementById('final-cpu-score').textContent = cpuScore;
  document.getElementById('final-cpu-score').style.color = cCol;

  const title = document.getElementById('result-title');
  const text  = document.getElementById('result-text');

  if (playerScore > cpuScore) {
    title.textContent = '🏆 Sieg!';
    title.style.color = '#3fb950';
    text.textContent  = `${playerTeam.name} gewinnt das Spiel!`;
  } else if (cpuScore > playerScore) {
    title.textContent = '😔 Niederlage';
    title.style.color = '#f85149';
    text.textContent  = `${cpuTeam.name} gewinnt das Spiel.`;
  } else {
    title.textContent = '🤝 Unentschieden';
    title.style.color = '#f0c040';
    text.textContent  = 'Das Spiel endet remis!';
  }

  document.getElementById('gameover-screen').classList.remove('hidden');
  render();
}

// ===========================
//  HUD
// ===========================
function updateHUD() {
  document.getElementById('player-score').textContent = playerScore;
  document.getElementById('cpu-score').textContent    = cpuScore;

  const m = Math.floor(timeLeft / 60);
  const s = Math.floor(timeLeft % 60);
  const timerEl = document.getElementById('timer');
  timerEl.textContent = `${m}:${s.toString().padStart(2,'0')}`;
  timerEl.classList.toggle('urgent', timeLeft < 60);
}

// ===========================
//  RENDER
// ===========================
function render() {
  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, CW, CH);

  drawField();
  drawPlayers();
  drawBall();
}

// ===========================
//  DRAW FIELD
// ===========================
function drawField() {
  // grass stripes
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#1f6b1f' : '#22762e';
    ctx.fillRect(FX + i*(FW/10), FY, FW/10 + 1, FH);
  }

  // goal nets (textured background)
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(FX - GOAL_DEPTH, GOAL_TOP, GOAL_DEPTH, GOAL_H);
  ctx.fillRect(FX + FW,         GOAL_TOP, GOAL_DEPTH, GOAL_H);

  // net lines
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 0.8;
  for (let gx = 0; gx < GOAL_DEPTH; gx += 9) {
    ctx.beginPath();
    ctx.moveTo(FX - GOAL_DEPTH + gx, GOAL_TOP);
    ctx.lineTo(FX - GOAL_DEPTH + gx, GOAL_BOT);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(FX + FW + gx, GOAL_TOP);
    ctx.lineTo(FX + FW + gx, GOAL_BOT);
    ctx.stroke();
  }
  for (let gy = 0; gy < GOAL_H; gy += 9) {
    ctx.beginPath();
    ctx.moveTo(FX - GOAL_DEPTH, GOAL_TOP + gy);
    ctx.lineTo(FX,              GOAL_TOP + gy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(FX + FW,              GOAL_TOP + gy);
    ctx.lineTo(FX + FW + GOAL_DEPTH, GOAL_TOP + gy);
    ctx.stroke();
  }
  ctx.restore();

  // field border
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeRect(FX, FY, FW, FH);

  // center line
  ctx.beginPath(); ctx.moveTo(FCX, FY); ctx.lineTo(FCX, FY+FH); ctx.stroke();

  // center circle
  ctx.beginPath(); ctx.arc(FCX, FCY, 68, 0, Math.PI*2); ctx.stroke();

  // center dot
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(FCX, FCY, 5, 0, Math.PI*2); ctx.fill();

  // penalty areas
  const pa_w = 138, pa_h = 274;
  ctx.strokeRect(FX,            FCY - pa_h/2, pa_w, pa_h);
  ctx.strokeRect(FX+FW - pa_w,  FCY - pa_h/2, pa_w, pa_h);

  // goal areas
  const ga_w = 56, ga_h = 168;
  ctx.lineWidth = 2;
  ctx.strokeRect(FX,           FCY - ga_h/2, ga_w, ga_h);
  ctx.strokeRect(FX+FW - ga_w, FCY - ga_h/2, ga_w, ga_h);

  // penalty spots
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  [FX+104, FX+FW-104].forEach(px => {
    ctx.beginPath(); ctx.arc(px, FCY, 4, 0, Math.PI*2); ctx.fill();
  });

  // penalty arcs
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(FX+104,    FCY, 68, -Math.PI*0.62, Math.PI*0.62); ctx.stroke();
  ctx.beginPath(); ctx.arc(FX+FW-104, FCY, 68, Math.PI*0.38, Math.PI*1.62); ctx.stroke();

  // corner arcs
  const cr = 14;
  [[FX,FY,0,Math.PI/2],[FX+FW,FY,Math.PI/2,Math.PI],
   [FX,FY+FH,-Math.PI/2,0],[FX+FW,FY+FH,Math.PI,-Math.PI/2]].forEach(([cx,cy,a1,a2]) => {
    ctx.beginPath(); ctx.arc(cx, cy, cr, a1, a2); ctx.stroke();
  });

  // goal posts (thick white)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.strokeRect(FX - GOAL_DEPTH, GOAL_TOP, GOAL_DEPTH, GOAL_H);
  ctx.strokeRect(FX + FW,         GOAL_TOP, GOAL_DEPTH, GOAL_H);
}

// ===========================
//  DRAW PLAYERS
// ===========================
function drawPlayers() {
  players.forEach(p => {
    const isCtrl = p === controlledP;
    const col = p.data.primaryColor;
    const alt = p.data.secondaryColor;

    // selection ring
    if (isCtrl) {
      ctx.save();
      ctx.shadowBlur   = 18;
      ctx.shadowColor  = '#ffffff';
      ctx.strokeStyle  = '#ffffff';
      ctx.lineWidth    = 2.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, PR + 5, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }

    // body
    const g = ctx.createRadialGradient(p.x - 4, p.y - 4, 2, p.x, p.y, PR);
    g.addColorStop(0, lightenColor(col, 30));
    g.addColorStop(1, col);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, PR, 0, Math.PI*2); ctx.fill();

    // border
    ctx.strokeStyle = alt;
    ctx.lineWidth   = 2.5;
    ctx.stroke();

    // role letter
    const labels = { gk: 'T', def: 'V', mid: 'M', att: 'A' };
    const light  = isColorLight(col);
    ctx.fillStyle     = light ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
    ctx.font          = `bold ${Math.round(PR * 0.82)}px Arial, sans-serif`;
    ctx.textAlign     = 'center';
    ctx.textBaseline  = 'middle';
    ctx.fillText(labels[p.role] ?? '?', p.x, p.y);

    // arrow above controlled player
    if (isCtrl) {
      ctx.fillStyle    = '#ffffff';
      ctx.font         = 'bold 11px Arial';
      ctx.textBaseline = 'bottom';
      ctx.fillText('▼', p.x, p.y - PR - 4);
    }
  });
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ===========================
//  DRAW BALL
// ===========================
function drawBall() {
  // shadow
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(ball.x + 4, ball.y + 5, BR, BR * 0.55, 0, 0, Math.PI*2);
  ctx.fill();

  // ball gradient
  const g = ctx.createRadialGradient(ball.x - 3, ball.y - 3, 1, ball.x, ball.y, BR);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#eeeeee');
  g.addColorStop(1, '#aaaaaa');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(ball.x, ball.y, BR, 0, Math.PI*2); ctx.fill();

  // black patches
  ctx.fillStyle = '#1a1a1a';
  const pSize = BR * 0.38;
  // center
  pentagon(ball.x, ball.y, pSize);
  // surrounding (4 patches)
  const d1 = BR * 0.62;
  [[1,0],[0,1],[-1,0],[0,-1]].forEach(([ox,oy]) => {
    pentagon(ball.x + ox*d1, ball.y + oy*d1, pSize * 0.68);
  });
  ctx.restore();
}

function pentagon(cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const px = cx + r * Math.cos(a);
    const py = cy + r * Math.sin(a);
    i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

// ===========================
//  UTILITIES
// ===========================
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

function lightenColor(hex, amount) {
  const v = parseInt(hex.replace('#',''), 16);
  let r = (v>>16)&255, g = (v>>8)&255, b = v&255;
  r = Math.min(255, r + amount);
  g = Math.min(255, g + amount);
  b = Math.min(255, b + amount);
  return `rgb(${r},${g},${b})`;
}
