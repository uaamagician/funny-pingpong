import * as THREE from 'three';
import { buildCharacter, randomConfig, stretchArm, DEFAULT_CONFIG } from './character.js';
import { TABLE, BALL_R, NET_TOP, makeBall, stepBall, bounceOnTable, solveShot } from './physics.js';
import { sfx, unlockAudio } from './audio.js';

// ───────────────────────── 基本設定 ─────────────────────────
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);

const WIN_SCORE = 11;
const PLAYER_Z = 3.0;
const AI_Z = -2.6;
const DIFFS = {
  easy:   { miss: 0.28, err: 0.55, react: 0.7 },
  normal: { miss: 0.14, err: 0.35, react: 0.85 },
  hard:   { miss: 0.05, err: 0.18, react: 1.0 },
};
let diff = DIFFS.normal;

// ───────────────────────── 場景 ─────────────────────────
const app = $('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = false;
app.insertBefore(renderer.domElement, app.firstChild);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1033);
scene.fog = new THREE.Fog(0x1b1033, 9, 22);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 60);
const CAM_BASE = new THREE.Vector3(0, 3.5, 5.6);
camera.position.copy(CAM_BASE);
camera.lookAt(0, 0.4, -0.3);

scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x2a1450, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(3, 6, 4);
scene.add(sun);
const rim = new THREE.PointLight(0xff4f8b, 25, 14);
rim.position.set(-3, 3, -3);
scene.add(rim);

// 地板與背景
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(14, 48),
  new THREE.MeshStandardMaterial({ color: 0x2c1a55, roughness: 0.9 }),
);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);
const ring = new THREE.Mesh(
  new THREE.RingGeometry(5.2, 5.4, 64),
  new THREE.MeshBasicMaterial({ color: 0xff4f8b, side: THREE.DoubleSide }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.01;
scene.add(ring);
for (let i = 0; i < 9; i++) {
  const a = (i / 9) * Math.PI - Math.PI; // 背景一排發光方塊
  const h = rnd(2, 5);
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, h, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x120a28, emissive: new THREE.Color().setHSL(i / 9, 0.8, 0.25) }),
  );
  box.position.set(Math.cos(a) * 9, h / 2, Math.sin(a) * 9 - 1);
  box.lookAt(0, h / 2, 0);
  scene.add(box);
}

// 球桌
const tableMat = new THREE.MeshStandardMaterial({ color: 0x1f5fb8, roughness: 0.5 });
const tableTop = new THREE.Mesh(new THREE.BoxGeometry(TABLE.halfW * 2, 0.04, TABLE.halfL * 2), tableMat);
tableTop.position.y = TABLE.top - 0.02;
scene.add(tableTop);
const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const lineMid = new THREE.Mesh(new THREE.PlaneGeometry(0.012, TABLE.halfL * 2), whiteMat);
lineMid.rotation.x = -Math.PI / 2;
lineMid.position.y = TABLE.top + 0.001;
scene.add(lineMid);
for (const s of [-1, 1]) {
  const side = new THREE.Mesh(new THREE.PlaneGeometry(0.02, TABLE.halfL * 2), whiteMat);
  side.rotation.x = -Math.PI / 2;
  side.position.set(s * (TABLE.halfW - 0.01), TABLE.top + 0.001, 0);
  scene.add(side);
  const end = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.halfW * 2, 0.02), whiteMat);
  end.rotation.x = -Math.PI / 2;
  end.position.set(0, TABLE.top + 0.001, s * (TABLE.halfL - 0.01));
  scene.add(end);
  for (const t of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, TABLE.top, 0.07), new THREE.MeshStandardMaterial({ color: 0x222233 }));
    leg.position.set(s * (TABLE.halfW - 0.1), TABLE.top / 2, t * (TABLE.halfL - 0.2));
    scene.add(leg);
  }
}
// 球網
const net = new THREE.Mesh(
  new THREE.PlaneGeometry(TABLE.halfW * 2 + 0.3, TABLE.netH),
  new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
);
net.position.set(0, TABLE.top + TABLE.netH / 2, 0);
scene.add(net);
for (const s of [-1, 1]) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, TABLE.netH + 0.04, 8), new THREE.MeshStandardMaterial({ color: 0x999999 }));
  post.position.set(s * (TABLE.halfW + 0.15), TABLE.top + TABLE.netH / 2, 0);
  scene.add(post);
}

// 球、影子、殘影
const ball = makeBall();
const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_R, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xffaa33, emissiveIntensity: 0.55 }),
);
scene.add(ballMesh);
const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.06, 16),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 }),
);
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);
const trail = [];
for (let i = 0; i < 10; i++) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc766, transparent: true, opacity: 0 }));
  scene.add(m);
  trail.push(m);
}

// 角色：玩家（背對鏡頭）與對手（正對鏡頭）
function makeActor(cfg, isPlayer) {
  const c = buildCharacter(cfg);
  c.group.position.set(0, 0, isPlayer ? PLAYER_Z : AI_Z);
  if (isPlayer) c.group.rotation.y = Math.PI;
  scene.add(c.group);
  scene.add(c.paddle);
  scene.add(c.arm);
  c.isPlayer = isPlayer;
  c.x = 0;
  c.swing = null;
  c.baseZ = isPlayer ? PLAYER_Z : AI_Z;
  return c;
}
const player = makeActor(DEFAULT_CONFIG, true);
const ai = makeActor(randomConfig(), false);
// 玩家的大頭擋住視線，所以讓它半透明（從背後看不到臉，不影響造型）
player.head.traverse((o) => {
  if (o.material) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.35; o.material.depthWrite = false; }
});

function swingActor(c, toPos, dirX = 0, dur = 0.3) {
  c.swing = { t: 0, to: toPos.clone(), dirX, dur };
}

const _v = new THREE.Vector3();
function updateActor(c, dt, time) {
  const g = c.group;
  g.position.x = c.x;
  c.body.position.y = Math.abs(Math.sin(time * 5 + (c.isPlayer ? 0 : 1))) * 0.035;
  c.head.rotation.z = Math.sin(time * 3 + (c.isPlayer ? 0 : 2)) * 0.07;

  const fwd = c.isPlayer ? -1 : 1; // 面向球網的方向
  const rest = new THREE.Vector3(c.x + (c.isPlayer ? 0.5 : 0.5), 1.0, c.baseZ + fwd * 0.55);
  const pos = rest.clone();
  let tilt = 0;
  if (c.swing) {
    const s = c.swing;
    s.t += dt / s.dur;
    if (s.t >= 1) {
      c.swing = null;
    } else {
      const k = s.t < 0.35 ? 1 - Math.pow(1 - s.t / 0.35, 3) : 1 - Math.pow((s.t - 0.35) / 0.65, 2);
      pos.lerpVectors(rest, s.to, k);
      tilt = s.dirX * k;
    }
  }
  c.paddle.position.copy(pos);
  c.paddle.rotation.set(-0.25 * fwd, 0, -tilt * 0.6);
  g.updateMatrixWorld(true);
  c.shoulder.getWorldPosition(_v);
  stretchArm(c.arm, _v.clone(), pos.clone().add(new THREE.Vector3(0, -0.08, 0)));
}

// ───────────────────────── 比賽狀態 ─────────────────────────
let state = 'menu'; // menu | serve | rally | point | over
let score = { player: 0, ai: 0 };
let server = 'player';
let firstServer = 'player';
let lastHitter = 'player';
let bounce = { player: 0, ai: 0 };
let rally = 0;
let pointTimer = 0;
let serveTimer = 0;
let aiTried = false;
let lastShotWasSmash = false;
let shake = 0;
const other = (w) => (w === 'player' ? 'ai' : 'player');

function setHint(t) { $('hint').textContent = t; }
function pop(text, color) {
  const el = $('pop');
  el.textContent = text;
  el.style.color = color || '';
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}
function updateScoreUI() {
  $('sP').textContent = score.player;
  $('sA').textContent = score.ai;
  $('dotP').classList.toggle('on', server === 'player');
  $('dotA').classList.toggle('on', server === 'ai');
  $('rally').textContent = rally > 1 ? `連續對打 ${rally}` : '';
}

function currentServer() {
  const total = score.player + score.ai;
  if (score.player >= 10 && score.ai >= 10) return total % 2 === 0 ? firstServer : other(firstServer);
  return Math.floor(total / 2) % 2 === 0 ? firstServer : other(firstServer);
}

function startPoint() {
  server = currentServer();
  state = 'serve';
  bounce = { player: 0, ai: 0 };
  rally = 0;
  aiTried = false;
  lastShotWasSmash = false;
  ball.spin = { top: 0, side: 0 };
  ball.vel = { x: 0, y: 0, z: 0 };
  if (server === 'player') {
    ball.pos = { x: player.x, y: 1.05, z: PLAYER_Z - 0.35 };
    lastHitter = 'player';
    setHint('向上滑動發球（往左或往右滑決定方向）');
  } else {
    ball.pos = { x: ai.x, y: 1.05, z: AI_Z + 0.35 };
    lastHitter = 'ai';
    serveTimer = 1.1;
    setHint('對手發球，準備接球！');
  }
  updateScoreUI();
}

function award(winner, why) {
  if (state === 'point' || state === 'over') return;
  score[winner]++;
  state = 'point';
  pointTimer = 1.5;
  rally = 0;
  if (winner === 'player') { sfx.point(); pop(why || '得分！', '#7dff9a'); }
  else { sfx.lose(); pop(why || '失分…', '#ff7d7d'); }
  updateScoreUI();
  const a = score.player, b = score.ai;
  if ((a >= WIN_SCORE || b >= WIN_SCORE) && Math.abs(a - b) >= 2) {
    state = 'over';
    setTimeout(() => {
      $('overTitle').textContent = a > b ? '你贏了！' : '你輸了…';
      $('overScore').textContent = `${a} : ${b}`;
      $('over').classList.remove('hidden');
    }, 1400);
  }
}

// ───────────────────────── 擊球 ─────────────────────────
function launch(shot, hitter) {
  ball.vel = { ...shot.vel };
  ball.spin = { ...shot.spin };
  lastHitter = hitter;
  bounce = { player: 0, ai: 0 };
  rally++;
  aiTried = false;
  updateScoreUI();
}

function analyzeSwipe(pts) {
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const dur = Math.max(40, b.t - a.t);
  let signed = 0;
  for (const p of pts) {
    const cross = ((p.x - a.x) * dy - (p.y - a.y) * dx) / (len || 1);
    if (Math.abs(cross) > Math.abs(signed)) signed = cross;
  }
  return { dx, dy, len, dur, speed: len / dur, curve: signed / (len || 1) };
}

// 把一次滑動轉成一記球（目標點、飛行時間、旋轉）
function makeShot(s, p0, isServe, quality) {
  const fwd = -s.dy;
  let p = clamp((s.speed - 0.35) / 1.7, 0, 1);
  if (isServe) p = Math.min(p, 0.55);
  let label = '';
  let top = 0.15 + 0.5 * p;
  let side = 0;
  let T = 0.9 - 0.45 * p;
  let tz = -(0.55 + 0.7 * p);
  let smash = false;

  if (Math.abs(s.curve) > 0.13) {
    side = clamp(-s.curve * 3.2, -1, 1);
    label = side > 0 ? '右旋 ↷' : '左旋 ↶';
  }
  const ang = fwd > 0 ? Math.atan2(s.dx, fwd) : Math.sign(s.dx || 1) * 0.6;
  let tx = clamp(ang / 0.9, -1, 1) * 0.62;

  if (!isServe && s.dy > 25 && fwd <= 0) {
    top = -0.9; T = 0.95; tz = -rnd(0.6, 1.0); p = Math.min(p, 0.4); label = '切球';
    tx = clamp(s.dx / 150, -1, 1) * 0.55;
  } else if (!isServe && p < 0.22) {
    top = -0.5; T = 0.95; tz = -rnd(0.35, 0.55); label = '吊球';
  } else if (!isServe && p > 0.78 && p0.y > 0.95) {
    smash = true; T = 0.33; tz = -1.25; top = 0.2; label = '殺球！';
  } else if (!label && top > 0.45) {
    label = '上旋';
  }

  if (!isServe) {
    const err = (1 - quality) * 0.5;
    tx += rnd(-err, err);
    T += (1 - quality) * 0.12;
    if (quality > 0.85 && !smash) label = label ? `完美 ${label}` : '完美！';
  }
  tx = clamp(tx, -0.74, 0.74);
  return {
    target: { x: tx, y: TABLE.top + BALL_R, z: tz },
    T, spin: { top, side }, label, smash,
  };
}

function playerServe(s) {
  if (-s.dy < 25) return;
  const p0 = { ...ball.pos };
  const m = makeShot(s, p0, true, 1);
  const sol = solveShot(p0, m.target, m.T, m.spin);
  launch({ vel: sol.vel, spin: m.spin }, 'player');
  state = 'rally';
  swingActor(player, new THREE.Vector3(p0.x, p0.y, p0.z), clamp(s.dx / 120, -1, 1));
  sfx.hit();
  setHint('');
}

function inHitWindow() {
  return lastHitter === 'ai' && bounce.player >= 1 && ball.vel.z > 0
    && ball.pos.z > 0.5 && ball.pos.z < 2.6 && ball.pos.y > 0.45;
}

function playerSwipe(s) {
  if (state === 'serve' && server === 'player') { playerServe(s); return; }
  if (state !== 'rally') return;
  const dirX = clamp(s.dx / 120, -1, 1);
  if (!inHitWindow()) {
    sfx.whoosh();
    swingActor(player, new THREE.Vector3(player.x + dirX * 0.3, 1.1, PLAYER_Z - 1.0), dirX);
    if (lastHitter === 'ai' && ball.vel.z > 0) {
      if (bounce.player === 0) pop('太早了！', '#ffd23f');
      else if (ball.pos.z >= 2.6) pop('太晚了！', '#ffd23f');
    }
    return;
  }
  const p0 = { ...ball.pos };
  const quality = clamp(1 - Math.abs(p0.z - 1.4) / 1.1, 0, 1);
  const m = makeShot(s, p0, false, quality);
  const sol = solveShot(p0, m.target, m.T, m.spin, m.smash ? 0.02 : 0.05);
  launch({ vel: sol.vel, spin: m.spin }, 'player');
  lastShotWasSmash = m.smash;
  swingActor(player, new THREE.Vector3(p0.x, p0.y, p0.z), dirX);
  if (m.smash) { sfx.smash(); shake = 0.35; } else sfx.hit();
  if (m.label) pop(m.label, m.smash ? '#ff6b3d' : quality > 0.85 ? '#7dff9a' : '#ffd23f');
}

function aiServe() {
  const p0 = { ...ball.pos };
  const target = { x: rnd(-0.6, 0.6), y: TABLE.top + BALL_R, z: rnd(0.45, 1.15) };
  const spin = { top: rnd(0, 0.4), side: Math.random() < 0.3 ? rnd(-0.7, 0.7) : 0 };
  const sol = solveShot(p0, target, rnd(0.75, 0.95), spin);
  launch({ vel: sol.vel, spin }, 'ai');
  state = 'rally';
  swingActor(ai, new THREE.Vector3(p0.x, p0.y, p0.z), 0);
  sfx.hit();
  setHint('球彈起來後，往前滑動擊球');
}

function aiReturn() {
  const p0 = { ...ball.pos };
  let missP = diff.miss;
  if (lastShotWasSmash) missP += 0.3;
  if (Math.abs(ball.spin.side) > 0.4) missP += 0.08;
  // 球太遠也接不到
  if (Math.abs(ball.pos.x - ai.x) > 0.5 * diff.react + 0.35) missP += 0.4;
  if (Math.random() < missP) {
    swingActor(ai, new THREE.Vector3(p0.x + rnd(-0.5, 0.5), p0.y, p0.z - 0.1), 0.5, 0.35);
    return;
  }
  const e = diff.err;
  const target = { x: clamp(rnd(-0.62, 0.62) + rnd(-e, e) * 0.5, -0.72, 0.72), y: TABLE.top + BALL_R, z: rnd(0.35, 1.25) };
  const r = Math.random();
  const spin = r < 0.3 ? { top: rnd(-0.6, -0.2), side: 0 } : { top: rnd(0.1, 0.6), side: Math.random() < 0.35 ? rnd(-0.8, 0.8) : 0 };
  const T = r < 0.15 ? rnd(1.0, 1.15) : rnd(0.55, 0.9);
  const sol = solveShot(p0, target, T, spin);
  launch({ vel: sol.vel, spin }, 'ai');
  lastShotWasSmash = false;
  swingActor(ai, new THREE.Vector3(p0.x, p0.y, p0.z), clamp(target.x, -1, 1));
  sfx.hit();
}

// ───────────────────────── 每步更新 ─────────────────────────
function stepRally(dt) {
  const prevZ = ball.pos.z;
  stepBall(ball, dt);

  // 過網判定
  if ((prevZ > 0) !== (ball.pos.z > 0) && state === 'rally') {
    if (ball.pos.y < NET_TOP + BALL_R * 0.3 && Math.abs(ball.pos.x) < TABLE.halfW + 0.15) {
      ball.vel.z *= -0.12;
      ball.vel.x *= 0.3;
      sfx.net();
      award(other(lastHitter), lastHitter === 'player' ? '掛網…' : '對手掛網！');
      return;
    }
  }

  // 球桌彈跳
  if (ball.vel.y < 0 && ball.pos.y <= TABLE.top + BALL_R && ball.pos.y > TABLE.top - 0.12
    && Math.abs(ball.pos.x) <= TABLE.halfW + BALL_R && Math.abs(ball.pos.z) <= TABLE.halfL + BALL_R) {
    bounceOnTable(ball);
    sfx.bounce();
    const side = ball.pos.z > 0 ? 'player' : 'ai';
    if (side === lastHitter) {
      award(other(lastHitter), lastHitter === 'player' ? '先打到自己這邊…' : '對手失誤！');
      return;
    }
    bounce[side]++;
    if (bounce[side] >= 2) {
      award(lastHitter, lastHitter === 'player' ? '漂亮！' : '對手得分');
      return;
    }
  }

  // 對手回擊
  if (lastHitter === 'player' && bounce.ai >= 1 && ball.vel.z < 0 && ball.pos.z <= -1.2 && !aiTried && ball.pos.y > 0.4) {
    aiTried = true;
    aiReturn();
  }

  // 落地 / 出界
  if ((ball.pos.y <= BALL_R + 0.005 && ball.vel.y < 0) || Math.abs(ball.pos.x) > 6 || Math.abs(ball.pos.z) > 7) {
    const recv = other(lastHitter);
    const good = bounce[recv] >= 1;
    if (good) award(lastHitter, lastHitter === 'player' ? '得分！' : '對手得分');
    else award(other(lastHitter), lastHitter === 'player' ? '出界…' : '對手出界！');
  }
}

function stepAfterPoint(dt) {
  stepBall(ball, dt);
  if (ball.pos.y <= BALL_R && ball.vel.y < 0) { ball.pos.y = BALL_R; ball.vel.y *= -0.45; ball.vel.x *= 0.8; ball.vel.z *= 0.8; }
  else if (ball.vel.y < 0 && ball.pos.y <= TABLE.top + BALL_R && ball.pos.y > TABLE.top - 0.1
    && Math.abs(ball.pos.x) <= TABLE.halfW && Math.abs(ball.pos.z) <= TABLE.halfL) { bounceOnTable(ball); }
}

// ───────────────────────── 輸入 ─────────────────────────
let pts = null;
const cv = renderer.domElement;
cv.addEventListener('pointerdown', (e) => {
  unlockAudio();
  pts = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
  cv.setPointerCapture?.(e.pointerId);
});
cv.addEventListener('pointermove', (e) => {
  if (pts) pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
});
function endSwipe(e) {
  if (!pts) return;
  pts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  const s = analyzeSwipe(pts);
  pts = null;
  if (s.len < 12) s.len = 12; // 輕點也算一次很輕的推擊
  if (state === 'menu' || state === 'over') return;
  playerSwipe(s);
}
cv.addEventListener('pointerup', endSwipe);
cv.addEventListener('pointercancel', () => { pts = null; });
// 桌機測試：空白鍵 = 一般擊球；方向鍵微調
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { unlockAudio(); playerSwipe({ dx: 0, dy: -150, len: 150, dur: 150, speed: 1.0, curve: 0 }); }
});

// ───────────────────────── 選單 ─────────────────────────
document.querySelectorAll('#diff button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#diff button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    diff = DIFFS[b.dataset.d];
  });
});
function newMatch() {
  unlockAudio();
  score = { player: 0, ai: 0 };
  firstServer = Math.random() < 0.5 ? 'player' : 'ai';
  Object.assign(ai.cfg, {}); // 之後可在這裡換對手造型
  $('menu').classList.add('hidden');
  $('over').classList.add('hidden');
  startPoint();
}
$('startBtn').addEventListener('click', newMatch);
$('againBtn').addEventListener('click', newMatch);

// ───────────────────────── 主迴圈 ─────────────────────────
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 直向螢幕拉高視角，確保桌子兩端都在畫面內
  camera.fov = w / h < 0.8 ? 66 : 52;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let time = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  const sub = 4;
  for (let i = 0; i < sub; i++) {
    const h = dt / sub;
    if (state === 'rally') stepRally(h);
    else if (state === 'point' || state === 'over') stepAfterPoint(h);
  }
  if (state === 'serve') {
    if (server === 'player') ball.pos.x = player.x;
    else { ball.pos.x = ai.x; serveTimer -= dt; if (serveTimer <= 0) aiServe(); }
  }
  if (state === 'point') {
    pointTimer -= dt;
    if (pointTimer <= 0) startPoint();
  }

  // 玩家左右跟著來球移動；對手預判落點
  let ptx = 0;
  if (state === 'rally' && lastHitter === 'ai') ptx = clamp(ball.pos.x + ball.vel.x * 0.25, -1.2, 1.2);
  player.x = lerp(player.x, ptx, 1 - Math.exp(-7 * dt));
  let atx = 0;
  if (state === 'rally' && lastHitter === 'player') atx = clamp(ball.pos.x + ball.vel.x * 0.3, -1.2, 1.2) * diff.react;
  ai.x = lerp(ai.x, atx, 1 - Math.exp(-6 * dt * diff.react));
  updateActor(player, dt, time);
  updateActor(ai, dt, time);

  // 球與影子、殘影
  ballMesh.position.set(ball.pos.x, ball.pos.y, ball.pos.z);
  const overTable = Math.abs(ball.pos.x) <= TABLE.halfW && Math.abs(ball.pos.z) <= TABLE.halfL && ball.pos.y > TABLE.top - 0.05;
  const baseY = overTable ? TABLE.top + 0.003 : 0.012;
  const hgt = Math.max(0, ball.pos.y - baseY);
  shadow.position.set(ball.pos.x, baseY, ball.pos.z);
  shadow.scale.setScalar(clamp(1.3 - hgt * 0.5, 0.35, 1.3));
  shadow.material.opacity = clamp(0.5 - hgt * 0.15, 0.12, 0.5);
  const speed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);
  for (let i = trail.length - 1; i > 0; i--) {
    trail[i].position.copy(trail[i - 1].position);
    trail[i].material.opacity = trail[i - 1].material.opacity * 0.82;
    trail[i].scale.setScalar(trail[i - 1].scale.x * 0.93);
  }
  trail[0].position.copy(ballMesh.position);
  trail[0].material.opacity = state === 'rally' ? clamp((speed - 3) / 12, 0, 0.45) : 0;
  trail[0].scale.setScalar(0.9);

  // 鏡頭：輕微跟隨球 + 殺球震動
  shake = Math.max(0, shake - dt);
  camera.position.set(
    CAM_BASE.x + ball.pos.x * 0.12 + (Math.random() - 0.5) * shake * 0.12,
    CAM_BASE.y + (Math.random() - 0.5) * shake * 0.12,
    CAM_BASE.z,
  );
  camera.lookAt(ball.pos.x * 0.25, 0.4, -0.3);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 提供除錯用的小接口（瀏覽器 console 可用 __game 檢視狀態）
window.__game = { get state() { return state; }, get server() { return server; }, get lastHitter() { return lastHitter; }, get bounce() { return bounce; }, get rally() { return rally; }, ball, score: () => ({ ...score }), player, ai, startPoint, newMatch };
void NET_TOP;
