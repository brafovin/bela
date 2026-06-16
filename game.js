// ============================================================
//  F1 RENNSPIEL  –  game.js
// ============================================================

const CW = 920, CH = 580;
const NUM_LAPS  = 5;
const CAR_L = 30, CAR_W = 13;   // car size px

// ── state ──────────────────────────────────────────────────
let canvas, ctx;
let state = 'team';              // team | driver | countdown | race | result | podium | champion
let playerTeam   = null;
let playerDriver = null;
let trackIdx     = 0;            // 0-2
let track        = null;
let cars         = [];
let playerCar    = null;
let raceTime     = 0;
let countdownVal = 3;
let countdownTimer = 0;
let lastTs       = null;
let rafId        = null;
let raceFinished = false;
let fans = [];
let fanGroups = {};
let stars = [];

const keys = {};

// ── boot ───────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas.getContext('2d');
  canvas.width  = CW;
  canvas.height = CH;

  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });

  // Pre-generate stars (fixed positions, varying size/brightness)
  for (let i = 0; i < 260; i++) {
    const rng = Math.random();
    stars.push({
      x: Math.random() * CW,
      y: Math.random() * CH,
      r:     rng < 0.6 ? 0.5 : rng < 0.9 ? 1.2 : 2.3,
      alpha: 0.3 + Math.random() * 0.7,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 2.2,
    });
  }

  buildTeamGrid();
});

// ── SELECTION ───────────────────────────────────────────────
function showTeamSelect() {
  showOnly('screen-team');
}

function buildTeamGrid() {
  const grid = document.getElementById('team-grid');
  F1_TEAMS.forEach(t => {
    const card = document.createElement('div');
    card.className = 'team-card';
    const light = isLight(t.color1);
    card.innerHTML = `
      <div class="team-logo" style="background:${t.color1};color:${light?'#000':'#fff'};border:3px solid ${t.color2}">${t.short}</div>
      <div class="t-name">${t.name}</div>
      <div class="t-speed">Stärke: ${'★'.repeat(Math.round(t.speed/10)-7)}</div>
    `;
    card.addEventListener('click', () => openDriverSelect(t));
    grid.appendChild(card);
  });
}

function openDriverSelect(team) {
  playerTeam = team;
  document.getElementById('driver-team-title').textContent = team.name;
  document.getElementById('driver-team-title').style.color = team.color1;
  const cards = document.getElementById('driver-cards');
  cards.innerHTML = '';
  team.drivers.forEach(d => {
    const card = document.createElement('div');
    card.className = 'driver-card';
    card.innerHTML = `
      <div class="driver-num" style="color:${team.color1}">#${d.num}</div>
      <div class="driver-name">${d.name}</div>
      <div class="driver-team-sub">${team.name}</div>
    `;
    card.addEventListener('click', () => { playerDriver = d; startRaceFromTrack(0); });
    cards.appendChild(card);
  });
  showOnly('screen-driver');
}

function startRaceFromTrack(idx) {
  trackIdx = idx;
  track    = TRACKS[idx];
  buildRace();
  startCountdown();
}

// ── BUILD RACE ──────────────────────────────────────────────
function buildRace() {
  cars = [];
  const wp = track.waypoints;
  const n  = wp.length;

  // direction at start
  const p0 = wp[0], p1 = wp[1];
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  const tx = dx/len, ty = dy/len;   // tangent
  const px = -ty,    py = tx;       // perpendicular

  // Build grid of all 20 drivers  ─── player + all others
  const allDrivers = [];
  F1_TEAMS.forEach(t => {
    t.drivers.forEach(d => {
      const isPlayer = (t.id === playerTeam.id && d.num === playerDriver.num);
      allDrivers.push({ team: t, driver: d, isPlayer, speed: t.speed });
    });
  });

  // Sort by speed (descending) → pole for fastest, but add some noise
  allDrivers.sort((a, b) => (b.speed + Math.random()*8) - (a.speed + Math.random()*8));

  // Player always gets grid position based on their team speed
  const pIdx = allDrivers.findIndex(d => d.isPlayer);
  // Keep player roughly in their merit position (±3)
  const targetPos = Math.max(0, Math.min(19, allDrivers.length - 1 - Math.round((playerTeam.speed - 78) / (98-78) * 18)));
  if (pIdx !== targetPos) {
    const [pl] = allDrivers.splice(pIdx, 1);
    allDrivers.splice(targetPos, 0, pl);
  }

  allDrivers.forEach((entry, gridPos) => {
    const row = Math.floor(gridPos / 2);
    const col = (gridPos % 2 === 0) ? -1 : 1;

    const gx = p0.x - tx * (row * 42 + 22) + px * col * 17;
    const gy = p0.y - ty * (row * 42 + 22) + py * col * 17;
    const angle = Math.atan2(ty, tx);

    const maxSpd = (120 + (entry.speed - 78) * 4.5) + (entry.isPlayer ? 0 : (Math.random()-0.5)*20);

    const car = {
      x: gx, y: gy, angle,
      speed: 0, velX: 0, velY: 0,
      maxSpeed: maxSpd,
      team: entry.team, driver: entry.driver,
      isPlayer: entry.isPlayer,
      laps: 0,
      wpIdx: 0,        // current target waypoint
      cpPassed: [],    // checkpoints passed this lap
      lapCooldown: 0,
      finished: false,
      finishTime: 0,
      lapTime: 0, bestLap: Infinity,
      gridPos
    };
    cars.push(car);
    if (entry.isPlayer) playerCar = car;
  });

  raceTime     = 0;
  raceFinished = false;
  document.getElementById('hud-track').textContent = track.name;
  document.getElementById('hud-driver').textContent = `${playerDriver.name}`;
  buildFans();
}

// ── FANS / CROWD ────────────────────────────────────────────
function buildFans() {
  fans = [];
  fanGroups = {};
  const wp   = track.waypoints;
  const n    = wp.length;
  const palette = [
    '#00e5ff','#00e5ff',   // cyan
    '#bb44ff','#9900dd',   // purple
    '#ffffff','#ddeeff',   // white / pale blue
    '#ffcc00','#ff9900',   // gold / amber
    '#ff44aa','#4488ff',   // pink / blue
  ];

  for (let i = 0; i < n; i += 6) {
    const cur  = wp[i];
    const fwd  = wp[(i + 3) % n];
    const dx   = fwd.x - cur.x, dy = fwd.y - cur.y;
    const len  = Math.hypot(dx, dy);
    if (len < 0.001) continue;
    const nx = -dy/len, ny = dx/len;  // perpendicular
    const tx =  dx/len, ty = dy/len;  // along-track

    for (const side of [-1, 1]) {
      for (let row = 0; row < 4; row++) {
        const d = track.width/2 + 14 + row * 5.5;
        for (let s = -4; s <= 4; s++) {
          const fx = cur.x + nx*side*d + tx*s*3 + (Math.random()-0.5)*2;
          const fy = cur.y + ny*side*d + ty*s*3 + (Math.random()-0.5)*2;
          if (fx < 8 || fx > CW-8 || fy < 8 || fy > CH-8) continue;
          fans.push({
            x: fx, y: fy,
            color: palette[Math.floor(Math.random() * palette.length)],
            phase: Math.random() * Math.PI * 2,
            size: 1.7 + Math.random() * 1.3,
          });
        }
      }
    }
  }

  // Pre-group by colour so drawFans only changes fillStyle once per colour
  fans.forEach(f => {
    if (!fanGroups[f.color]) fanGroups[f.color] = [];
    fanGroups[f.color].push(f);
  });
}

// ── COUNTDOWN ───────────────────────────────────────────────
function startCountdown() {
  showOnly('screen-race');
  const cd = document.getElementById('countdown');
  countdownVal   = 3;
  countdownTimer = 0;
  state = 'countdown';
  lastTs = null;

  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
}

// ── GAME LOOP ────────────────────────────────────────────────
function loop(ts) {
  rafId = requestAnimationFrame(loop);
  if (!lastTs) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;

  if (state === 'countdown') {
    // Just render track and grid, count down
    render();
    countdownTimer -= dt;
    if (countdownTimer <= 0) {
      countdownVal--;
      countdownTimer = 1;
      const cd = document.getElementById('countdown');
      if (countdownVal > 0) {
        cd.textContent = countdownVal;
        cd.classList.remove('hidden');
        void cd.offsetWidth; // restart animation
        cd.classList.remove('hidden');
      } else if (countdownVal === 0) {
        cd.textContent = 'START!';
        cd.style.color = '#3fb950';
      } else {
        cd.classList.add('hidden');
        state = 'race';
      }
    }
  } else if (state === 'race') {
    update(dt);
    render();
  } else if (state === 'result') {
    render();
  }
}

// ── UPDATE ──────────────────────────────────────────────────
function update(dt) {
  raceTime += dt;

  cars.forEach(car => {
    if (car.finished) return;
    car.lapTime += dt;
    if (car.lapCooldown > 0) car.lapCooldown -= dt;
    if (car.isPlayer) { updatePlayer(car, dt); advanceWaypoint(car); }
    else              updateAI(car, dt);
    applyPhysics(car, dt);
    checkWaypoints(car);
  });

  updateHUD();
  checkRaceEnd();
}

// ── PLAYER PHYSICS ───────────────────────────────────────────
function updatePlayer(car, dt) {
  const throttle = keys['KeyW'] || keys['ArrowUp']   ? 1 : 0;
  const brake    = keys['KeyS'] || keys['ArrowDown']  ? 1 : 0;
  const steerL   = keys['KeyA'] || keys['ArrowLeft']  ? 1 : 0;
  const steerR   = keys['KeyD'] || keys['ArrowRight'] ? 1 : 0;

  const accel = 320 * dt;
  const brkF  = 500 * dt;
  const steer = 2.8 * dt * Math.min(1, car.speed / (car.maxSpeed * 0.4));

  car.speed += (throttle * accel) - (brake * brkF);
  car.speed  = Math.max(0, Math.min(car.maxSpeed, car.speed));
  car.angle += (steerR - steerL) * steer;
}

// ── PLAYER WAYPOINT TRACKING ─────────────────────────────────
function advanceWaypoint(car) {
  const wp = track.waypoints;
  const n  = track.numWP;
  // Advance past any waypoint the car has physically passed, using the
  // track tangent as the reference direction (dot-product sign test).
  for (let i = 0; i < 20; i++) {
    const cur  = car.wpIdx % n;
    const next = (cur + 1) % n;
    const tx = wp[next].x - wp[cur].x;   // tangent at current WP
    const ty = wp[next].y - wp[cur].y;
    const cx = car.x - wp[cur].x;        // car relative to WP
    const cy = car.y - wp[cur].y;
    if (cx * tx + cy * ty > 0) {         // car is ahead of this WP
      car.wpIdx = next;
    } else break;
  }
}

// ── AI PHYSICS ───────────────────────────────────────────────
function updateAI(car, dt) {
  const wp = track.waypoints;
  const target = wp[car.wpIdx];
  const dx = target.x - car.x, dy = target.y - car.y;
  const distToWP = Math.hypot(dx, dy);

  // Angle to target
  const targetAngle = Math.atan2(dy, dx);
  let angleDiff = targetAngle - car.angle;
  while (angleDiff >  Math.PI) angleDiff -= 2*Math.PI;
  while (angleDiff < -Math.PI) angleDiff += 2*Math.PI;

  // Speed: slow down for tight corners
  const cornerFactor = Math.max(0.45, 1 - Math.abs(angleDiff) * 0.6);
  const targetSpeed = car.maxSpeed * cornerFactor;

  // Gradually match speed
  const accel = targetSpeed > car.speed ? 260 * dt : -400 * dt;
  car.speed = Math.max(0, Math.min(car.maxSpeed, car.speed + accel));

  // Steer
  const steerRate = 3.0 * dt;
  car.angle += Math.max(-steerRate, Math.min(steerRate, angleDiff * 3 * dt));

  // Advance waypoint
  if (distToWP < 28) {
    car.wpIdx = (car.wpIdx + 1) % track.numWP;
  }
}

// ── PHYSICS / MOVEMENT ───────────────────────────────────────
function applyPhysics(car, dt) {
  const onTrack = isOnTrack(car);
  const drag = onTrack ? 0.018 : 0.055;
  car.speed = Math.max(0, car.speed * (1 - drag));

  car.x += Math.cos(car.angle) * car.speed * dt;
  car.y += Math.sin(car.angle) * car.speed * dt;
}

// ── TRACK DETECTION ──────────────────────────────────────────
function isOnTrack(car) {
  return distFromCenterline(car.x, car.y) <= track.width / 2 + 4;
}

function distFromCenterline(x, y) {
  const wp = track.waypoints;
  const n  = wp.length;
  let min  = Infinity;
  for (let i = 0; i < n; i++) {
    const a = wp[i], b = wp[(i+1)%n];
    const ax = b.x-a.x, ay = b.y-a.y;
    const lenSq = ax*ax+ay*ay;
    if (lenSq < 0.001) continue;
    const t = Math.max(0, Math.min(1, ((x-a.x)*ax+(y-a.y)*ay)/lenSq));
    const d = Math.hypot(x-(a.x+ax*t), y-(a.y+ay*t));
    if (d < min) min = d;
  }
  return min;
}

// ── LAP / CHECKPOINT ─────────────────────────────────────────
function checkWaypoints(car) {
  const wp  = track.waypoints;
  const n   = wp.length;
  const cps = track.checkpoints;

  // Check checkpoints
  cps.forEach((cpWp, i) => {
    if (car.cpPassed.includes(i)) return;
    const d = Math.hypot(car.x - wp[cpWp].x, car.y - wp[cpWp].y);
    if (d < track.width) car.cpPassed.push(i);
  });

  // Check lap completion (near waypoint 0 = start/finish)
  const d0 = Math.hypot(car.x - wp[0].x, car.y - wp[0].y);
  if (d0 < track.width && car.cpPassed.length >= Math.floor(cps.length * 0.6) && car.lapCooldown <= 0) {
    car.laps++;
    if (car.lapTime < car.bestLap) car.bestLap = car.lapTime;
    car.lapTime    = 0;
    car.cpPassed   = [];
    car.lapCooldown = 5;

    if (car.laps >= NUM_LAPS) {
      car.finished   = true;
      car.finishTime = raceTime;
    }
  }
}

// ── RACE POSITION ────────────────────────────────────────────
function getPositions() {
  return [...cars].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    const progA = a.laps * track.numWP + a.wpIdx;
    const progB = b.laps * track.numWP + b.wpIdx;
    return progB - progA;
  });
}

function getPlayerPos() {
  return getPositions().findIndex(c => c.isPlayer) + 1;
}

// ── HUD ──────────────────────────────────────────────────────
function updateHUD() {
  const pos = getPlayerPos();
  document.getElementById('hud-pos').textContent = `P${pos}`;
  document.getElementById('hud-lap').textContent = `Runde ${Math.min(playerCar.laps+1, NUM_LAPS)} / ${NUM_LAPS}`;
  document.getElementById('hud-speed').textContent = `${Math.round(playerCar.speed * 3.6)} km/h`;
  const m = Math.floor(raceTime/60), s = (raceTime%60).toFixed(3);
  document.getElementById('hud-timer').textContent = `${m}:${parseFloat(s)<10?'0':''}${s}`;
}

// ── RACE END ─────────────────────────────────────────────────
function checkRaceEnd() {
  if (raceFinished) return;
  const allDone = cars.filter(c => c.finished).length >= 1;
  // End when player finishes or all top cars finish
  const anyTop3Done = getPositions().slice(0,3).some(c => c.finished);
  if (!anyTop3Done) return;
  if (!playerCar.finished) {
    // Give player a bit more time after leaders finish
    const leadersFinished = cars.filter(c => c.finished);
    if (leadersFinished.length > 0 && (raceTime - Math.min(...leadersFinished.map(c => c.finishTime))) > 30) {
      playerCar.finished = true;
      playerCar.finishTime = raceTime;
    } else if (playerCar.finished) { /* already done */ }
    else return;
  }
  raceFinished = true;
  state = 'result';
  setTimeout(showResults, 800);
}

// ── SHOW RESULTS ────────────────────────────────────────────
function showResults() {
  cancelAnimationFrame(rafId);
  const positions = getPositions();
  const playerPos = positions.findIndex(c => c.isPlayer) + 1;

  const title = document.getElementById('result-title');
  if (playerPos === 1) { title.textContent = '🏆 1. Platz!'; title.style.color='#FFD700'; }
  else if (playerPos <= 3) { title.textContent = `🥈 ${playerPos}. Platz!`; title.style.color='#C0C0C0'; }
  else { title.textContent = `${playerPos}. Platz`; title.style.color='#e10600'; }

  const list = document.getElementById('result-list');
  list.innerHTML = '';
  positions.slice(0, 10).forEach((car, i) => {
    const row = document.createElement('div');
    row.className = 'result-row' + (car.isPlayer ? ' player-row' : '');
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
    const ft = car.finishTime ? fmtTime(car.finishTime) : `+${Math.round(positions[0].laps * 60 - car.laps * 60)}s`;
    row.innerHTML = `
      <span class="result-pos">${medal}</span>
      <span class="result-car" style="background:${car.team.color1};border:2px solid ${car.team.color2}"></span>
      <span class="result-name">${car.driver.name}</span>
      <span class="result-time">${ft}</span>
    `;
    list.appendChild(row);
  });

  const btnNext  = document.getElementById('btn-next');
  const btnRetry = document.getElementById('btn-retry');

  if (playerPos <= 3) {
    if (trackIdx < 2) {
      btnNext.classList.remove('hidden');
      btnNext.textContent = `Nächstes Rennen: ${TRACKS[trackIdx+1].name} →`;
      btnNext.onclick = () => showPodium(playerPos, positions);
    } else {
      btnNext.classList.remove('hidden');
      btnNext.textContent = '🏆 Meister-Zeremonie →';
      btnNext.onclick = () => showPodium(playerPos, positions);
    }
    btnRetry.classList.add('hidden');
  } else {
    btnRetry.classList.remove('hidden');
    btnRetry.onclick = () => startRaceFromTrack(trackIdx);
    btnNext.classList.add('hidden');
  }

  showOnly('screen-result');
}

function fmtTime(t) {
  const m = Math.floor(t/60), s = (t%60).toFixed(3);
  return `${m}:${parseFloat(s)<10?'0':''}${s}`;
}

// ── PODIUM ANIMATION ─────────────────────────────────────────
function showPodium(playerPos, positions) {
  showOnly('screen-podium');

  const pc = document.getElementById('podium-canvas');
  const ptx = pc.getContext('2d');
  pc.width  = 520;
  pc.height = 340;

  document.getElementById('podium-pos').textContent = playerPos === 1 ? '🥇 1. Platz' : playerPos === 2 ? '🥈 2. Platz' : '🥉 3. Platz';
  document.getElementById('podium-name').textContent = playerDriver.name;

  let frame = 0;
  const confetti = Array.from({length:80}, () => ({
    x: Math.random()*520, y: -10, vy: 80+Math.random()*120,
    vx: (Math.random()-.5)*60, color: ['#FFD700','#e10600','#00D2BE','#FF8000','#3fb950'][Math.floor(Math.random()*5)],
    w: 6+Math.random()*6, h: 4+Math.random()*4, rot: Math.random()*360, rotV: (Math.random()-.5)*360
  }));

  const podiumAnim = (ts) => {
    frame++;
    ptx.clearRect(0,0,520,340);

    // Background
    ptx.fillStyle = '#0a0a0f';
    ptx.fillRect(0,0,520,340);

    const t = Math.min(1, frame/80); // 0→1 over 80 frames

    // Podium blocks
    const blocks = [
      {x:200,y:340,w:120,h:130,col:'#FFD700',lbl:'1'},
      {x:80, y:340,w:120,h:100,col:'#C0C0C0',lbl:'2'},
      {x:320,y:340,w:120,h:80, col:'#CD7F32',lbl:'3'},
    ];
    blocks.forEach(b => {
      const h = b.h * t;
      ptx.fillStyle = b.col;
      ptx.fillRect(b.x, b.y - h, b.w, h);
      ptx.fillStyle = 'rgba(0,0,0,.3)';
      ptx.fillRect(b.x, b.y - h, b.w, 3);
      if (t > 0.7) {
        ptx.fillStyle = '#000';
        ptx.font = `bold ${20*t}px Arial`;
        ptx.textAlign = 'center';
        ptx.textBaseline = 'bottom';
        ptx.fillText(b.lbl, b.x + b.w/2, b.y - h + 28*t);
      }
    });

    // Player car on 1st place podium
    if (t > 0.6) {
      const carT = Math.min(1,(t-0.6)/0.4);
      ptx.save();
      ptx.translate(260, 340 - 130*t - 20*carT);
      ptx.rotate(Math.PI/2);
      drawCarShape(ptx, playerTeam, 0, 0, 30, 14);
      ptx.restore();
    }

    // Trophy rising
    if (t > 0.75) {
      const tT = (t - 0.75) / 0.25;
      ptx.font = `${50*tT}px serif`;
      ptx.textAlign = 'center';
      ptx.textBaseline = 'bottom';
      ptx.fillText('🏆', 260, 340 - 130 - 60*tT);
    }

    // Confetti
    if (t > 0.8) {
      confetti.forEach(c => {
        c.x += c.vx * 0.016;
        c.y += c.vy * 0.016;
        c.rot += c.rotV * 0.016;
        if (c.y > 350) { c.y = -10; c.x = Math.random()*520; }
        ptx.save();
        ptx.translate(c.x, c.y);
        ptx.rotate(c.rot * Math.PI/180);
        ptx.fillStyle = c.color;
        ptx.fillRect(-c.w/2,-c.h/2,c.w,c.h);
        ptx.restore();
      });
    }

    if (frame < 300) requestAnimationFrame(podiumAnim);
  };
  requestAnimationFrame(podiumAnim);

  const btnNext = document.getElementById('btn-podium-next');
  if (trackIdx < 2) {
    btnNext.textContent = `Nächstes Rennen →`;
    btnNext.onclick = () => startRaceFromTrack(trackIdx + 1);
  } else {
    btnNext.textContent = '🏆 Ich bin Weltmeister!';
    btnNext.onclick = () => showChampion();
  }
}

function showChampion() {
  document.getElementById('champ-driver-name').textContent = playerDriver.name + ' – ' + playerTeam.name;
  showOnly('screen-champion');
}

// ── RENDER ───────────────────────────────────────────────────
function render() {
  // ── Deep space background ─────────────────────────────────
  ctx.fillStyle = '#03030a';
  ctx.fillRect(0, 0, CW, CH);

  // Nebula glow patches
  [
    [170, 210, 150, 120, 60, 255, 0.07],
    [700, 130, 175, 255, 40,  60, 0.06],
    [540, 440, 130,  40, 120,255, 0.05],
    [380, 270,  95, 255, 190, 40, 0.04],
  ].forEach(([nx, ny, nr, r, g, b, a]) => {
    const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr);
    ng.addColorStop(0, `rgba(${r},${g},${b},${a})`);
    ng.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ng;
    ctx.fillRect(0, 0, CW, CH);
  });

  // Stars (twinkle using real time so they animate even after race ends)
  const st = performance.now() / 1000;
  stars.forEach(s => {
    ctx.globalAlpha = s.alpha * (0.72 + 0.28 * Math.sin(s.phase + st * s.speed));
    if (s.r < 1) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x, s.y, 1, 1);
    } else {
      if (s.r > 2) { ctx.shadowBlur = 5; ctx.shadowColor = '#aaddff'; }
      ctx.fillStyle = s.r > 1.5 ? '#ddeeff' : '#ffffff';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  });
  ctx.globalAlpha = 1;

  // Planet (top-right corner, partially behind HUD)
  const pg = ctx.createRadialGradient(876, 48, 4, 876, 48, 68);
  pg.addColorStop(0,    '#c070ff');
  pg.addColorStop(0.45, '#6022cc');
  pg.addColorStop(1,    '#180042');
  ctx.fillStyle = pg;
  ctx.beginPath(); ctx.arc(876, 48, 68, 0, Math.PI*2); ctx.fill();
  // Atmospheric glow ring
  const pa = ctx.createRadialGradient(876, 48, 52, 876, 48, 84);
  pa.addColorStop(0, 'rgba(150,70,255,0)');
  pa.addColorStop(1, 'rgba(150,70,255,0.14)');
  ctx.fillStyle = pa;
  ctx.beginPath(); ctx.arc(876, 48, 84, 0, Math.PI*2); ctx.fill();
  // Planetary rings
  ctx.save();
  ctx.translate(876, 48); ctx.scale(1, 0.26);
  ctx.strokeStyle = 'rgba(190,130,255,0.38)'; ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(0, 0, 95, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle = 'rgba(210,170,255,0.16)'; ctx.lineWidth = 15;
  ctx.beginPath(); ctx.arc(0, 0, 114, 0, Math.PI*2); ctx.stroke();
  ctx.restore();

  drawFans();
  drawTrack();
  drawStartFinish();
  drawCars();
}

function drawFans() {
  const t = raceTime || 0;
  for (const [color, group] of Object.entries(fanGroups)) {
    ctx.fillStyle = color;
    group.forEach(f => {
      const wave = Math.sin(f.phase + t * 3.5) * 1.4;
      const s = f.size;
      ctx.fillRect(f.x - s, f.y - s + wave, s * 2, s * 2);
    });
  }
}

function drawTrack() {
  const wp = track.waypoints;
  const n  = wp.length;
  ctx.lineCap  = 'round';
  ctx.lineJoin = 'round';

  const path = () => {
    ctx.beginPath();
    ctx.moveTo(wp[0].x, wp[0].y);
    for (let i = 1; i < n; i++) ctx.lineTo(wp[i].x, wp[i].y);
    ctx.closePath();
  };

  // Drop shadow beneath the track
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth   = track.width + 20;
  path(); ctx.stroke();

  // Kerb — solid red base
  ctx.strokeStyle = '#be0000';
  ctx.lineWidth   = track.width + 10;
  ctx.setLineDash([]);
  path(); ctx.stroke();

  // Kerb — white alternating stripes overlaid on red
  ctx.strokeStyle = '#f0f0f0';
  ctx.lineWidth   = track.width + 10;
  ctx.setLineDash([15, 15]);
  ctx.lineDashOffset = 15;
  path(); ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;

  // Asphalt surface (space-blue tinted dark)
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth   = track.width;
  path(); ctx.stroke();

  // Lighter worn racing-line band through the center
  ctx.strokeStyle = '#22223a';
  ctx.lineWidth   = track.width * 0.5;
  path(); ctx.stroke();

  // White center dashed line
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([18, 10]);
  path(); ctx.stroke();
  ctx.setLineDash([]);
}

function drawStartFinish() {
  const wp = track.waypoints;
  const p0 = wp[0], p1 = wp[1];
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  const ttx = dx/len, tty = dy/len;
  const nnx = -tty, nny = ttx;
  const hw  = track.width / 2 + 2;

  // Checkered flag tiles
  const tW = 8, tH = 7, cols = Math.ceil(hw * 2 / tW), rows = 3;
  ctx.save();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const bx = p0.x + nnx * (-hw + (c+0.5)*tW) + ttx * (r - rows/2 + 0.5)*tH;
      const by = p0.y + nny * (-hw + (c+0.5)*tW) + tty * (r - rows/2 + 0.5)*tH;
      ctx.fillStyle = (r + c) % 2 === 0 ? '#fff' : '#111';
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(Math.atan2(tty, ttx));
      ctx.fillRect(-tW/2, -tH/2, tW, tH);
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawCars() {
  const sorted = [...cars].filter(c => !c.isPlayer);
  sorted.push(playerCar);

  sorted.forEach(car => {
    // Motion blur trail for fast cars
    if (car.speed > 40) {
      const t = Math.min(1, (car.speed - 40) / 80);
      for (let b = 3; b >= 1; b--) {
        ctx.save();
        ctx.globalAlpha = t * 0.09 / b;
        ctx.translate(car.x - Math.cos(car.angle)*b*5, car.y - Math.sin(car.angle)*b*5);
        ctx.rotate(car.angle);
        drawCarShape(ctx, car.team, 0, 0, CAR_L, CAR_W);
        ctx.restore();
      }
    }

    // Car ground shadow
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.36)';
    ctx.beginPath();
    ctx.ellipse(car.x+2, car.y+3, CAR_L*0.52, CAR_W*0.65, car.angle, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // Exhaust / engine glow at high speed
    if (car.speed > 45) {
      const intens = Math.min(0.88, (car.speed - 45) / 65);
      const rx = car.x - Math.cos(car.angle) * (CAR_L/2 + 4);
      const ry = car.y - Math.sin(car.angle) * (CAR_L/2 + 4);
      const eg = ctx.createRadialGradient(rx, ry, 0, rx, ry, 13);
      eg.addColorStop(0,    `rgba(255,210,80,${intens})`);
      eg.addColorStop(0.4,  `rgba(255,100,20,${intens*0.55})`);
      eg.addColorStop(1,    'rgba(255,80,0,0)');
      ctx.fillStyle = eg;
      ctx.beginPath(); ctx.arc(rx, ry, 13, 0, Math.PI*2); ctx.fill();
    }

    // Car body
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    drawCarShape(ctx, car.team, 0, 0, CAR_L, CAR_W);

    // Driver number
    ctx.fillStyle = isLight(car.team.color1) ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.92)';
    ctx.font = `bold ${Math.round(CAR_W*0.62)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(car.driver.num, 0, 0);
    ctx.restore();

    // Player glow ring
    if (car.isPlayer) {
      ctx.save();
      ctx.shadowBlur  = 18;
      ctx.shadowColor = '#ffffff';
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.ellipse(car.x, car.y, CAR_L*0.7, CAR_W*1.18, car.angle, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
  });

  drawMiniStandings();
}

function drawCarShape(c, team, x, y, l, w) {
  const hl = l/2, hw = w/2;

  // Reusable body outline (pointed nose → wide rear)
  const body = () => {
    c.beginPath();
    c.moveTo(x + hl + 4,  y);
    c.lineTo(x + hl*0.32, y - hw*0.92);
    c.lineTo(x - hl*0.38, y - hw);
    c.lineTo(x - hl,      y - hw*0.68);
    c.lineTo(x - hl,      y + hw*0.68);
    c.lineTo(x - hl*0.38, y + hw);
    c.lineTo(x + hl*0.32, y + hw*0.92);
    c.closePath();
  };

  // ── Solid body fill ───────────────────────────────────────
  c.fillStyle = team.color1;
  body(); c.fill();

  // ── Livery sidepod stripes ────────────────────────────────
  c.fillStyle = team.color2;
  c.beginPath();
  c.moveTo(x + hl*0.22, y - hw*0.92);
  c.lineTo(x - hl*0.32, y - hw);
  c.lineTo(x - hl*0.44, y - hw*0.48);
  c.lineTo(x + hl*0.08, y - hw*0.48);
  c.closePath(); c.fill();
  c.beginPath();
  c.moveTo(x + hl*0.22, y + hw*0.92);
  c.lineTo(x - hl*0.32, y + hw);
  c.lineTo(x - hl*0.44, y + hw*0.48);
  c.lineTo(x + hl*0.08, y + hw*0.48);
  c.closePath(); c.fill();

  // ── 3D lighting gradient (bright top → dark bottom) ──────
  const lgrad = c.createLinearGradient(x, y - hw, x, y + hw);
  lgrad.addColorStop(0,    'rgba(255,255,255,0.28)');
  lgrad.addColorStop(0.38, 'rgba(255,255,255,0.05)');
  lgrad.addColorStop(0.62, 'rgba(0,0,0,0.03)');
  lgrad.addColorStop(1,    'rgba(0,0,0,0.32)');
  c.fillStyle = lgrad;
  body(); c.fill();

  // ── Engine cover specular shine ───────────────────────────
  c.fillStyle = 'rgba(255,255,255,0.1)';
  c.beginPath();
  c.ellipse(x - hl*0.06, y - hw*0.24, hl*0.45, hw*0.19, 0, 0, Math.PI*2);
  c.fill();

  // ── Cockpit: dark interior + blue visor glass ─────────────
  c.fillStyle = '#050510';
  c.beginPath();
  c.ellipse(x + hl*0.12, y, hl*0.19, hw*0.46, 0, 0, Math.PI*2);
  c.fill();
  c.fillStyle = 'rgba(60,150,255,0.28)';
  c.beginPath();
  c.ellipse(x + hl*0.17, y - hw*0.12, hl*0.1, hw*0.22, 0, 0, Math.PI*2);
  c.fill();

  // ── Halo safety frame ─────────────────────────────────────
  const haloCol = (team.color2 === '#000000' || team.color2 === '#080000') ? '#999' : team.color2;
  c.strokeStyle = haloCol;
  c.lineWidth   = 1.8;
  c.beginPath();
  c.roundRect(x, y - hw*0.5, hl*0.38, hw, 2);
  c.stroke();

  // ── Side mirrors ──────────────────────────────────────────
  c.fillStyle = team.color2;
  c.fillRect(x + hl*0.06, y - hw - 2, 5, 2);
  c.fillRect(x + hl*0.06, y + hw,     5, 2);

  // ── Rear wing with DRS gap and endplate caps ──────────────
  c.fillStyle = team.color2;
  c.fillRect(x - hl - 6, y - hw*1.48, 9, w*1.48*2);
  c.fillStyle = team.color1;
  c.fillRect(x - hl - 7, y - hw*1.48,     4, 3);
  c.fillRect(x - hl - 7, y + hw*1.48 - 3, 4, 3);
  c.fillStyle = 'rgba(0,0,0,0.5)';
  c.fillRect(x - hl - 6, y - 1, 9, 2);

  // ── Front wing with endplates ─────────────────────────────
  c.fillStyle = team.color1;
  c.fillRect(x + hl + 2, y - hw*1.3, 7, w*1.3*2);
  c.fillStyle = team.color2;
  c.fillRect(x + hl + 8, y - hw*1.3,     2, 4);
  c.fillRect(x + hl + 8, y + hw*1.3 - 4, 2, 4);

  // ── Headlights at nose tip ────────────────────────────────
  c.shadowBlur = 5; c.shadowColor = '#ffffaa';
  c.fillStyle  = '#ffffcc';
  c.beginPath(); c.arc(x + hl + 1, y - hw*0.3, 1.5, 0, Math.PI*2); c.fill();
  c.beginPath(); c.arc(x + hl + 1, y + hw*0.3, 1.5, 0, Math.PI*2); c.fill();
  c.shadowBlur = 0;

  // ── Wheels: tyre + silver rim + hub + shine ───────────────
  const wx1 = x + hl*0.4, wx2 = x - hl*0.4, wy = hw + 2;
  [[wx1,-wy,3,4.2],[wx1,wy,3,4.2],[wx2,-wy-0.5,3.8,5.2],[wx2,wy+0.5,3.8,5.2]]
    .forEach(([ex, ey, rx, ry]) => {
      c.fillStyle = '#141414';
      c.beginPath(); c.ellipse(ex,ey,rx,ry,0,0,Math.PI*2); c.fill();
      c.fillStyle = '#888';
      c.beginPath(); c.ellipse(ex,ey,rx*0.52,ry*0.48,0,0,Math.PI*2); c.fill();
      c.fillStyle = '#555';
      c.beginPath(); c.ellipse(ex,ey,rx*0.22,ry*0.2,0,0,Math.PI*2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.22)';
      c.beginPath(); c.ellipse(ex-rx*0.28,ey-ry*0.28,rx*0.38,ry*0.32,0,0,Math.PI*2); c.fill();
    });
}

function drawMiniStandings() {
  const positions = getPositions().slice(0, 8);
  const pW = 162, rH = 22, pH = positions.length*rH + 18;
  const px = CW - pW - 8, py = 8;

  // Gradient panel
  const g = ctx.createLinearGradient(px, py, px, py+pH);
  g.addColorStop(0, 'rgba(8,8,18,0.9)');
  g.addColorStop(1, 'rgba(18,18,32,0.85)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(px, py, pW, pH, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1; ctx.stroke();

  positions.forEach((car, i) => {
    const isP = car.isPlayer;
    const ry  = py + 9 + i*rH;

    // Player row tint
    if (isP) {
      ctx.fillStyle = 'rgba(225,6,0,0.22)';
      ctx.beginPath(); ctx.roundRect(px+3, ry-1, pW-6, rH-2, 5); ctx.fill();
    }

    // Position number (gold/silver/bronze for top 3)
    ctx.fillStyle = i===0 ? '#FFD700' : i===1 ? '#C0C0C0' : i===2 ? '#CD7F32' : isP ? '#FFD700' : '#666';
    ctx.font = 'bold 10px Arial';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(i+1, px+20, ry+8);

    // Team colour dot (outer = primary, inner = secondary)
    ctx.fillStyle = car.team.color1;
    ctx.beginPath(); ctx.arc(px+28, ry+8, 4.5, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = car.team.color2;
    ctx.beginPath(); ctx.arc(px+28, ry+8, 2,   0, Math.PI*2); ctx.fill();

    // Driver last name
    ctx.fillStyle = isP ? '#FFD700' : '#d0d0d0';
    ctx.font = isP ? 'bold 11px Arial' : '10px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(car.driver.name.split(' ').pop(), px+37, ry+8);
  });
}

// ── UTILS ────────────────────────────────────────────────────
function isLight(hex) {
  const v = parseInt(hex.replace('#',''),16);
  return (0.299*((v>>16)&255)+0.587*((v>>8)&255)+0.114*(v&255)) > 155;
}

function showOnly(id) {
  ['screen-team','screen-driver','screen-race','screen-result','screen-podium','screen-champion'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}
