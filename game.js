// ===========================
//  CONSTANTS
// ===========================
const CW = 920;
const CH = 580;
const FX = 65;
const FY = 45;
const FW = 790;
const FH = 490;
const FCX = FX + FW / 2;
const FCY = FY + FH / 2;
const GOAL_H = 136;
const GOAL_DEPTH = 38;
const GOAL_TOP = FCY - GOAL_H / 2;
const GOAL_BOT = FCY + GOAL_H / 2;
const PR = 21;       // player radius (increased for visibility)
const BR = 10;
const GAME_SECS = 5 * 60;

// ===========================
//  STATE
// ===========================
let canvas, ctx;
let state = 'selection';
let playerTeam = null;
let cpuTeam    = null;
let playerScore = 0;
let cpuScore    = 0;
let timeLeft    = GAME_SECS;
let lastTs      = null;
let rafId       = null;
let goalTimer   = 0;
let goalSide    = null;
let controlledP = null;

const keys = {};
const ball  = { x: FCX, y: FCY, vx: 0, vy: 0 };
let players = [];

// ===========================
//  PLAYER CLASS
// ===========================
class Player {
  constructor(x, y, team, role, teamData, number) {
    this.x  = x; this.startX = x;
    this.y  = y; this.startY = y;
    this.vx = 0; this.vy = 0;
    this.team   = team;
    this.role   = role;
    this.data   = teamData;
    this.number = number;
    this.maxSpd = this._calcSpeed();
  }

  _calcSpeed() {
    const base     = 3.2 + (this.data.speed / 100) * 2.4;
    const roleMult = { gk: 0.78, def: 0.88, mid: 0.97, att: 1.08 }[this.role] ?? 1;
    const teamMult = this.team === 'cpu' ? 0.78 : 1.0; // CPU is noticeably slower
    return base * roleMult * teamMult;
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
    const textCol = isColorLight(t.primaryColor) ? '#111' : '#fff';
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
  return (0.299*((v>>16)&255) + 0.587*((v>>8)&255) + 0.114*(v&255)) > 160;
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
  // Player team (left side, attacks right)
  players.push(new Player( 98, FCY,      'player', 'gk',  playerTeam,  1));
  players.push(new Player(215, FCY - 65, 'player', 'def', playerTeam,  5));
  players.push(new Player(215, FCY + 65, 'player', 'def', playerTeam,  6));
  players.push(new Player(360, FCY,      'player', 'mid', playerTeam,  8));
  players.push(new Player(445, FCY - 35, 'player', 'att', playerTeam,  9));

  // CPU team (right side, attacks left)
  players.push(new Player(822, FCY,      'cpu', 'gk',  cpuTeam,  1));
  players.push(new Player(705, FCY + 65, 'cpu', 'def', cpuTeam,  3));
  players.push(new Player(705, FCY - 65, 'cpu', 'def', cpuTeam,  4));
  players.push(new Player(560, FCY,      'cpu', 'mid', cpuTeam,  7));
  players.push(new Player(475, FCY + 35, 'cpu', 'att', cpuTeam, 11));
}

function resetKickoff(scorer) {
  players.forEach(p => { p.x = p.startX; p.y = p.startY; p.vx = 0; p.vy = 0; });
  ball.x = FCX; ball.y = FCY;
  ball.vx = scorer === 'player' ? -1.2 : 1.2;
  ball.vy = 0;
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

  if (state === 'playing') {
    update(dt);
  } else if (state === 'goal') {
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
  moveAI();
  physBall();
  resolveAllCollisions();
  detectGoal();
}

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
//  AI (improved)
// ===========================
function moveAI() {
  players.forEach(p => {
    if (p === controlledP) return;

    let tx, ty;

    // ---- PLAYER TEAM (AI-controlled: GK + formation) ----
    if (p.team === 'player') {

      if (p.role === 'gk') {
        // Goalkeeper: guard line, rush if ball is near
        const inDanger = ball.x < FX + 200 && ball.y > GOAL_TOP - 70 && ball.y < GOAL_BOT + 70;
        const inArea   = ball.x < FX + 140;

        if (inArea) {
          // Rush to intercept
          tx = Math.max(FX + 22, ball.x - 12);
          ty = ball.y;
        } else if (inDanger) {
          // Come off line to cut angle
          const pct = (ball.x - FX) / 200;
          tx = FX + 22 + pct * 70;
          ty = clamp(ball.y, GOAL_TOP + PR, GOAL_BOT - PR);
        } else {
          // Track ball horizontally up to a limit, vertically along goal
          tx = FX + 22 + Math.max(0, (ball.x - FCX) * 0.04);
          ty = clamp(ball.y, GOAL_TOP + PR + 5, GOAL_BOT - PR - 5);
        }
      }

      else if (p.role === 'def') {
        if (ball.x < FCX) {
          // Ball in our half: intercept between ball and goal
          tx = clamp((FX + ball.x) * 0.5 + 50, FX + PR + 5, FCX - 20);
          ty = clamp(ball.y, FY + PR, FY + FH - PR);
        } else {
          // Ball in CPU half: hold defensive shape
          tx = p.startX;
          ty = p.startY + (ball.y - FCY) * 0.22;
        }
      }

      else if (p.role === 'mid') {
        // Support: stay between start and ball
        const mx = clamp(ball.x * 0.45 + p.startX * 0.55, p.startX - 40, FCX + 30);
        const my = p.startY + (ball.y - FCY) * 0.35;
        tx = mx; ty = clamp(my, FY + PR, FY + FH - PR);
      }

      else if (p.role === 'att') {
        // Make runs into space ahead of ball
        tx = clamp(ball.x + 60, p.startX - 30, FX + FW - PR - 10);
        ty = p.startY + (ball.y - FCY) * 0.4;
        ty = clamp(ty, FY + PR, FY + FH - PR);
      }
    }

    // ---- CPU TEAM (AI-controlled, intentionally limited) ----
    else if (p.team === 'cpu') {

      if (p.role === 'gk') {
        // CPU GK: stay close to goal, track ball on Y
        const cpuInDanger = ball.x > FX + FW - 200 && ball.y > GOAL_TOP - 60 && ball.y < GOAL_BOT + 60;
        if (cpuInDanger) {
          tx = Math.min(FX + FW - 20, ball.x + 12);
          ty = ball.y;
        } else {
          tx = FX + FW - 22;
          ty = clamp(ball.y, GOAL_TOP + PR + 5, GOAL_BOT - PR - 5);
        }
      }

      else if (p.role === 'def') {
        // CPU defenders: conservative, mostly stay in their half
        if (ball.x > FX + FW * 0.72) {
          // Ball near CPU goal - can press ball
          tx = ball.x - 45;
          ty = ball.y;
        } else {
          // Ball elsewhere - hold defensive shape
          tx = p.startX;
          ty = p.startY + (ball.y - FCY) * 0.25;
        }
      }

      else if (p.role === 'mid') {
        // CPU mid: chase ball but only in own half
        if (ball.x > FCX - 60) {
          tx = ball.x + 18;
          ty = ball.y;
        } else {
          // Ball in player half - hold midfield position
          tx = FCX + 30;
          ty = FCY + (ball.y - FCY) * 0.4;
        }
      }

      else if (p.role === 'att') {
        // CPU attacker: lurk rather than over-chase
        if (ball.x > FCX + 30) {
          // Ball in CPU half - close in
          tx = ball.x;
          ty = ball.y;
        } else if (ball.x > FCX - 100) {
          // Ball near center - attack position
          tx = FCX + 35;
          ty = ball.y;
        } else {
          // Ball deep in player half - don't rush in, hold at midfield
          tx = FCX + 10;
          ty = p.startY + (ball.y - FCY) * 0.3;
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
  if (Math.abs(ball.vx) < 0.04) ball.vx = 0;
  if (Math.abs(ball.vy) < 0.04) ball.vy = 0;

  ball.x += ball.vx;
  ball.y += ball.vy;

  const inGoalY = ball.y > GOAL_TOP - BR && ball.y < GOAL_BOT + BR;

  if (ball.y - BR < FY)      { ball.y = FY + BR;      ball.vy =  Math.abs(ball.vy) * 0.65; }
  if (ball.y + BR > FY + FH) { ball.y = FY + FH - BR; ball.vy = -Math.abs(ball.vy) * 0.65; }

  if (ball.x - BR < FX && !inGoalY) { ball.x = FX + BR; ball.vx =  Math.abs(ball.vx) * 0.65; }
  if (ball.x + BR > FX + FW && !inGoalY) { ball.x = FX + FW - BR; ball.vx = -Math.abs(ball.vx) * 0.65; }

  if (ball.x - BR < FX - GOAL_DEPTH) { ball.x = FX - GOAL_DEPTH + BR; ball.vx =  Math.abs(ball.vx) * 0.5; }
  if (ball.x + BR > FX + FW + GOAL_DEPTH) { ball.x = FX + FW + GOAL_DEPTH - BR; ball.vx = -Math.abs(ball.vx) * 0.5; }

  // Goal post crossbar
  const inGoalZone = ball.x < FX + 5 || ball.x > FX + FW - 5;
  if (inGoalZone && ball.x > FX - GOAL_DEPTH && ball.x < FX + FW + GOAL_DEPTH) {
    if (ball.y - BR < GOAL_TOP) { ball.y = GOAL_TOP + BR; ball.vy =  Math.abs(ball.vy) * 0.6; }
    if (ball.y + BR > GOAL_BOT) { ball.y = GOAL_BOT - BR; ball.vy = -Math.abs(ball.vy) * 0.6; }
  }
}

// ===========================
//  COLLISIONS
// ===========================
function resolveAllCollisions() {
  players.forEach(p => {
    const d = dist(p, ball);
    const minD = PR + BR;
    if (d < minD && d > 0.01) {
      const nx = (ball.x - p.x) / d;
      const ny = (ball.y - p.y) / d;

      // Push ball out of overlap
      ball.x += nx * (minD - d);
      ball.y += ny * (minD - d);

      const spd  = Math.hypot(p.vx, p.vy);
      const kick = Math.max(5, spd * 1.5);

      ball.vx = nx * kick + p.vx * 0.45;
      ball.vy = ny * kick + p.vy * 0.45;

      // CPU outfield: aim toward player goal but with lots of inaccuracy
      if (p.team === 'cpu' && p.role !== 'gk') {
        const distToGoal = Math.hypot(ball.x - FX, ball.y - FCY);
        // Less accurate the farther from goal; max aim blend is low
        const closeBonus = Math.max(0, 1 - distToGoal / (FW * 0.55));
        const acc     = 0.07 + closeBonus * 0.14; // max ~21% aim at close range
        const scatter = GOAL_H * 1.4 + (1 - p.data.attackRating / 100) * GOAL_H;
        const ty = FCY + (Math.random() - 0.5) * scatter;
        const tdx = FX - 10 - ball.x, tdy = ty - ball.y;
        const tl  = Math.hypot(tdx, tdy);
        if (tl > 0) {
          ball.vx = lerp(ball.vx, (tdx/tl) * kick, acc);
          ball.vy = lerp(ball.vy, (tdy/tl) * kick, acc);
        }
      }

      // GKs punt ball away from their goal
      if (p.role === 'gk') {
        if (p.team === 'cpu') {
          ball.vx = -Math.abs(ball.vx) * 1.5 - 5;
          ball.vy = (Math.random() - 0.5) * 8;
        } else {
          ball.vx =  Math.abs(ball.vx) * 1.5 + 5;
          ball.vy = (Math.random() - 0.5) * 8;
        }
      }
    }
  });

  // Separate overlapping players
  for (let i = 0; i < players.length; i++) {
    for (let j = i+1; j < players.length; j++) {
      const a = players[i], b = players[j];
      const d = dist(a, b);
      if (d < PR * 2 && d > 0.01) {
        const nx = (b.x - a.x) / d;
        const ny = (b.y - a.y) / d;
        const push = (PR * 2 - d) * 0.42;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        a.x = clamp(a.x, FX+PR, FX+FW-PR); a.y = clamp(a.y, FY+PR, FY+FH-PR);
        b.x = clamp(b.x, FX+PR, FX+FW-PR); b.y = clamp(b.y, FY+PR, FY+FH-PR);
      }
    }
  }
}

// ===========================
//  SHOOT (Space)
// ===========================
function shoot() {
  const p = controlledP;
  if (!p) return;
  if (dist(p, ball) > PR + BR + 30) return;

  const scatter = (Math.random() - 0.5) * GOAL_H * 0.55;
  const ty = FCY + scatter;
  const tx = FX + FW + GOAL_DEPTH;
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
  const inBand = ball.y >= GOAL_TOP && ball.y <= GOAL_BOT;
  if (ball.x < FX - 4 && inBand)       { cpuScore++;    goalSide = 'cpu';    showGoal(); }
  else if (ball.x > FX + FW + 4 && inBand) { playerScore++; goalSide = 'player'; showGoal(); }
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

  document.getElementById('final-player-score').textContent = playerScore;
  document.getElementById('final-player-score').style.color = playerTeam.primaryColor;
  document.getElementById('final-cpu-score').textContent = cpuScore;
  document.getElementById('final-cpu-score').style.color = cpuTeam.primaryColor;

  const title = document.getElementById('result-title');
  const text  = document.getElementById('result-text');

  if (playerScore > cpuScore) {
    title.textContent = '🏆 Sieg!'; title.style.color = '#3fb950';
    text.textContent  = `${playerTeam.name} gewinnt das Spiel!`;
  } else if (cpuScore > playerScore) {
    title.textContent = '😔 Niederlage'; title.style.color = '#f85149';
    text.textContent  = `${cpuTeam.name} gewinnt das Spiel.`;
  } else {
    title.textContent = '🤝 Unentschieden'; title.style.color = '#f0c040';
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
  const el = document.getElementById('timer');
  el.textContent = `${m}:${s.toString().padStart(2,'0')}`;
  el.classList.toggle('urgent', timeLeft < 60);
}

// ===========================
//  RENDER
// ===========================
function render() {
  ctx.clearRect(0, 0, CW, CH);
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, CW, CH);
  drawField();
  drawPlayerShadows();
  drawPlayers();
  drawBall();
  drawTeamLabels();
}

// ===========================
//  DRAW FIELD
// ===========================
function drawField() {
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#1e6b1e' : '#227026';
    ctx.fillRect(FX + i*(FW/10), FY, FW/10 + 1, FH);
  }

  // Goal nets
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(FX - GOAL_DEPTH, GOAL_TOP, GOAL_DEPTH, GOAL_H);
  ctx.fillRect(FX + FW,         GOAL_TOP, GOAL_DEPTH, GOAL_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 0.8;
  for (let gx = 0; gx < GOAL_DEPTH; gx += 9) {
    ctx.beginPath(); ctx.moveTo(FX-GOAL_DEPTH+gx, GOAL_TOP); ctx.lineTo(FX-GOAL_DEPTH+gx, GOAL_BOT); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(FX+FW+gx, GOAL_TOP);         ctx.lineTo(FX+FW+gx, GOAL_BOT);         ctx.stroke();
  }
  for (let gy = 0; gy < GOAL_H; gy += 9) {
    ctx.beginPath(); ctx.moveTo(FX-GOAL_DEPTH, GOAL_TOP+gy); ctx.lineTo(FX, GOAL_TOP+gy);             ctx.stroke();
    ctx.beginPath(); ctx.moveTo(FX+FW, GOAL_TOP+gy);         ctx.lineTo(FX+FW+GOAL_DEPTH, GOAL_TOP+gy); ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeRect(FX, FY, FW, FH);

  ctx.beginPath(); ctx.moveTo(FCX, FY); ctx.lineTo(FCX, FY+FH); ctx.stroke();
  ctx.beginPath(); ctx.arc(FCX, FCY, 68, 0, Math.PI*2); ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(FCX, FCY, 5, 0, Math.PI*2); ctx.fill();

  const pa_w = 138, pa_h = 274;
  ctx.strokeRect(FX,           FCY-pa_h/2, pa_w, pa_h);
  ctx.strokeRect(FX+FW-pa_w,   FCY-pa_h/2, pa_w, pa_h);

  const ga_w = 56, ga_h = 168;
  ctx.lineWidth = 2;
  ctx.strokeRect(FX,           FCY-ga_h/2, ga_w, ga_h);
  ctx.strokeRect(FX+FW-ga_w,   FCY-ga_h/2, ga_w, ga_h);

  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  [FX+104, FX+FW-104].forEach(px => { ctx.beginPath(); ctx.arc(px, FCY, 4, 0, Math.PI*2); ctx.fill(); });

  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(FX+104,    FCY, 68, -0.62*Math.PI, 0.62*Math.PI);  ctx.stroke();
  ctx.beginPath(); ctx.arc(FX+FW-104, FCY, 68, 0.38*Math.PI, 1.62*Math.PI);  ctx.stroke();

  const cr = 14;
  [[FX,FY,0,Math.PI/2],[FX+FW,FY,Math.PI/2,Math.PI],
   [FX,FY+FH,-Math.PI/2,0],[FX+FW,FY+FH,Math.PI,3*Math.PI/2]].forEach(([cx,cy,a1,a2]) => {
    ctx.beginPath(); ctx.arc(cx, cy, cr, a1, a2); ctx.stroke();
  });

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 5;
  ctx.strokeRect(FX-GOAL_DEPTH, GOAL_TOP, GOAL_DEPTH, GOAL_H);
  ctx.strokeRect(FX+FW,         GOAL_TOP, GOAL_DEPTH, GOAL_H);
}

// Draw shadows separately so they appear under all players
function drawPlayerShadows() {
  players.forEach(p => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(p.x + 4, p.y + 6, PR * 0.85, PR * 0.52, 0, 0, Math.PI*2);
    ctx.fill();
  });
}

// ===========================
//  DRAW PLAYERS (jersey style)
// ===========================
function drawPlayers() {
  players.forEach(p => drawJerseyPlayer(p, p === controlledP));
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function drawJerseyPlayer(p, isCtrl) {
  const col = p.data.primaryColor;
  const alt = p.data.secondaryColor;
  const R   = PR;

  ctx.save();

  // ── Jersey body (clipped circle) ──
  ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI*2); ctx.clip();

  // Base primary color fill
  ctx.fillStyle = col;
  ctx.fillRect(p.x - R, p.y - R, R*2, R*2);

  // Secondary color horizontal chest stripe
  ctx.fillStyle = alt;
  ctx.fillRect(p.x - R, p.y - R*0.32, R*2, R*0.64);

  // Top highlight sheen
  const sheen = ctx.createLinearGradient(p.x - R, p.y - R, p.x - R, p.y);
  sheen.addColorStop(0, 'rgba(255,255,255,0.28)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(p.x - R, p.y - R, R*2, R);

  ctx.restore();

  // ── Outline ──
  ctx.strokeStyle = isCtrl ? '#f5e642' : 'rgba(0,0,0,0.55)';
  ctx.lineWidth   = isCtrl ? 3.5 : 2.5;
  ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI*2); ctx.stroke();

  // ── Jersey number ──
  const numCol = isColorLight(alt) ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.95)';
  ctx.fillStyle    = numCol;
  ctx.font         = `bold ${Math.floor(R * 0.72)}px Arial, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(p.number, p.x, p.y);

  // ── GK crown indicator ──
  if (p.role === 'gk') {
    ctx.fillStyle    = 'rgba(255,215,0,0.9)';
    ctx.font         = '8px Arial';
    ctx.textBaseline = 'top';
    ctx.fillText('GK', p.x, p.y + R + 3);
  }

  // ── Selection glow ring ──
  if (isCtrl) {
    ctx.save();
    ctx.shadowBlur  = 26;
    ctx.shadowColor = '#f5e642';
    ctx.strokeStyle = '#f5e642';
    ctx.lineWidth   = 2.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, R + 8, 0, Math.PI*2); ctx.stroke();
    ctx.restore();

    // arrow above
    ctx.fillStyle    = '#f5e642';
    ctx.font         = 'bold 14px Arial';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('▼', p.x, p.y - R - 4);
  }
}

// ===========================
//  TEAM LABELS
// ===========================
function drawTeamLabels() {
  // Left team label (player)
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = 'bold 11px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(playerTeam.shortName, FCX - FW/4, FY - 6);
  ctx.fillText('CPU: ' + cpuTeam.shortName, FCX + FW/4, FY - 6);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

// ===========================
//  DRAW BALL
// ===========================
function drawBall() {
  ctx.save();

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(ball.x+4, ball.y+5, BR, BR*0.55, 0, 0, Math.PI*2); ctx.fill();

  // Gradient sphere
  const g = ctx.createRadialGradient(ball.x-3, ball.y-3, 1, ball.x, ball.y, BR);
  g.addColorStop(0,    '#ffffff');
  g.addColorStop(0.45, '#eeeeee');
  g.addColorStop(1,    '#aaaaaa');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(ball.x, ball.y, BR, 0, Math.PI*2); ctx.fill();

  // Black patches
  ctx.fillStyle = '#1a1a1a';
  pentagon(ball.x, ball.y, BR * 0.38);
  const d1 = BR * 0.62;
  [[1,0],[0,1],[-1,0],[0,-1]].forEach(([ox,oy]) => pentagon(ball.x+ox*d1, ball.y+oy*d1, BR*0.26));

  ctx.restore();
}

function pentagon(cx, cy, r) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i/5)*Math.PI*2 - Math.PI/2;
    i === 0 ? ctx.moveTo(cx+r*Math.cos(a), cy+r*Math.sin(a))
            : ctx.lineTo(cx+r*Math.cos(a), cy+r*Math.sin(a));
  }
  ctx.closePath(); ctx.fill();
}

// ===========================
//  UTILITIES
// ===========================
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }

function lightenColor(hex, amt) {
  const v = parseInt(hex.replace('#',''), 16);
  let r=(v>>16)&255, g=(v>>8)&255, b=v&255;
  return `rgb(${Math.min(255,r+amt)},${Math.min(255,g+amt)},${Math.min(255,b+amt)})`;
}
