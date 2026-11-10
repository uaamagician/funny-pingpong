import '@fontsource/iansui/index.css'; // 正體手寫字體（芫荽），打包進網站，不從外部載入
import * as THREE from 'three';
import { buildCharacter, randomConfig, stretchArm, DEFAULT_CONFIG } from './character.js';
import { TABLE, BALL_R, NET_TOP, makeBall, stepBall, bounceOnTable } from './physics.js';
import { sfx, unlockAudio } from './audio.js';
import { createEditor } from './editor.js';
import { loadConfig, saveConfig, loadPref, savePref } from './storage.js';
import { ARENAS, DEFAULT_ARENA } from './arenas.js';
import { TUNE } from './tuning.js';
import { getProfile, providerLabel } from './auth.js';
import { CHARACTERS, RACKETS, BALLS, STAT_KEYS, STAT_NAME, ARENA_FX, DEFAULT_CHARACTER, DEFAULT_RACKET, DEFAULT_BALL, charById, racketById, ballById, baseMods, finalStats } from './characters.js';
import { hostRoom, joinRoom, explainError } from './net.js';
import { analyzeSwipe, handOf, timingInfo, buildPlayerShot, buildAiShot, pickAiKind, finalizeShot, describeFlight, solveServe, SWEET } from './shots.js';

// ───────────────────────── 基本設定 ─────────────────────────
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);

const WIN_SCORE = 11;
const PLAYER_Z = 3.5;
const AI_Z = -2.6;
const DIFFS = {
  // sigO / sigT：AI 擊球點與時機的偏差（越大越容易掛網、出界）；miss：AI 根本來不及接的機率
  easy:   { miss: 0.2, sigO: 0.45, sigT: 0.35, react: 0.7, hitR: 72, aggr: 0.3 },
  normal: { miss: 0.1, sigO: 0.3, sigT: 0.22, react: 0.85, hitR: 58, aggr: 0.55 },
  hard:   { miss: 0.04, sigO: 0.2, sigT: 0.14, react: 1.0, hitR: 46, aggr: 0.9 },
};
let diff = DIFFS.normal;

// ───────────────────────── 場景 ─────────────────────────
const app = $('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.insertBefore(renderer.domElement, app.firstChild);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1033);
scene.fog = new THREE.Fog(0x1b1033, 9, 22);

const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 60);
// 視角距離：近／中／遠（玩家可在比賽畫面右上角切換，會記住）
const CAM_LEVELS = { near: { y: 3.1, z: 4.5, label: '近' }, mid: { y: 3.6, z: 5.3, label: '中' }, far: { y: 4.5, z: 6.8, label: '遠' } };
const CAM_ORDER = ['near', 'mid', 'far'];
let camLevel = CAM_LEVELS[loadPref('cam2', 'near')] ? loadPref('cam2', 'near') : 'near'; // 預設「近」
const CAM_BASE = new THREE.Vector3(0, CAM_LEVELS[camLevel].y, CAM_LEVELS[camLevel].z);
let baseFov = 66;
// 鏡頭導演：慢動作、頓幀、視角衝擊、傾斜、靠近來球
let camFollowW = 0; // 鏡頭跟球的程度 0–1
let timeScale = 1, slowT = 0, hitStop = 0, fovKick = 0, camRoll = 0, camRollTarget = 0, camApproach = 0, pointDolly = 0;
camera.position.copy(CAM_BASE);
camera.lookAt(0, 0.3, -0.5);

const hemi = new THREE.HemisphereLight(0xcfd8ff, 0x2a1450, 1.1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(3, 6, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 18 });
sun.shadow.bias = -0.0005;
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
floor.receiveShadow = true;
scene.add(floor);
// 比賽場地地墊與聚光燈光束
const court = new THREE.Mesh(
  new THREE.PlaneGeometry(4.6, 8.4),
  new THREE.MeshStandardMaterial({ color: 0x4a2f8f, roughness: 0.95 }),
);
court.rotation.x = -Math.PI / 2;
court.position.y = 0.004;
court.receiveShadow = true;
scene.add(court);
// 場地白線（淡淡的邊界，讓場面有秩序）
const courtLines = [];
for (const [w, d, x, z] of [[4.3, 0.04, 0, -3.95], [4.3, 0.04, 0, 3.95], [0.04, 7.94, -2.15, 0], [0.04, 7.94, 2.15, 0]]) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.006, z);
  scene.add(m);
  courtLines.push(m);
}
const beams = [];
for (const [x, c] of [[-2.6, 0xff4f8b], [2.6, 0x4cc9f0], [-1.1, 0xffd23f], [1.1, 0x9b5de5]]) {
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(1.1, 7, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.set(x, 3.5, -3.5);
  beam.rotation.z = x * -0.05;
  scene.add(beam);
  beams.push(beam);
}
const ring = new THREE.Mesh(
  new THREE.RingGeometry(5.2, 5.4, 64),
  new THREE.MeshBasicMaterial({ color: 0xff4f8b, side: THREE.DoubleSide }),
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.01;
scene.add(ring);
const pillars = [];
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
  pillars.push(box);
}
// 太空場地用的星星
const stars = new THREE.Points(
  new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(
    Array.from({ length: 600 }, (_, i) => (i % 3 === 1 ? rnd(1, 14) : rnd(-18, 18))), 3)),
  new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, fog: false }),
);
stars.position.z = -10;
stars.visible = false;
scene.add(stars);

// 球桌：微光澤的桌面、深色厚桌邊與桌底板、白色邊線與中線、金屬桌腳與橫撐、有網格的球網與網柱
function tableSheen() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#e9e9e9'); grad.addColorStop(0.5, '#ffffff'); grad.addColorStop(1, '#e4e4e4');
  g.fillStyle = grad; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 900; i++) { // 很細的顆粒，看起來像桌面塗層
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.035})`;
    g.fillRect(Math.random() * 128, Math.random() * 256, 1, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const tableMat = new THREE.MeshStandardMaterial({ color: 0x1b4f8f, roughness: 0.36, metalness: 0.03, map: tableSheen() });
const tableEdgeMat = new THREE.MeshStandardMaterial({ color: 0x0f2f55, roughness: 0.6 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0x39414d, roughness: 0.45, metalness: 0.5 });
const TOP_T = 0.035;
const tableTop = new THREE.Mesh(
  new THREE.BoxGeometry(TABLE.halfW * 2, TOP_T, TABLE.halfL * 2),
  [tableEdgeMat, tableEdgeMat, tableMat, tableEdgeMat, tableEdgeMat, tableEdgeMat],
);
tableTop.position.y = TABLE.top - TOP_T / 2;
tableTop.castShadow = true;
tableTop.receiveShadow = true;
scene.add(tableTop);
const apron = new THREE.Mesh(new THREE.BoxGeometry(TABLE.halfW * 2 - 0.16, 0.07, TABLE.halfL * 2 - 0.28), new THREE.MeshStandardMaterial({ color: 0x1d232c, roughness: 0.7 }));
apron.position.y = TABLE.top - TOP_T - 0.035;
apron.castShadow = true;
scene.add(apron);
const lineMat = new THREE.MeshBasicMaterial({ color: 0xf4f6f8 });
const flat = (w, d, x, z) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, TABLE.top + 0.0012, z);
  scene.add(m);
};
flat(0.01, TABLE.halfL * 2 - 0.04, 0, 0); // 中線
for (const s of [-1, 1]) {
  flat(0.02, TABLE.halfL * 2, s * (TABLE.halfW - 0.01), 0);   // 邊線
  flat(TABLE.halfW * 2, 0.02, 0, s * (TABLE.halfL - 0.01));   // 底線
}
// 桌腳（金屬）+ 長邊橫撐 + 腳墊
const legH = TABLE.top - TOP_T - 0.07;
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, legH, 12), metalMat);
    leg.position.set(sx * (TABLE.halfW - 0.13), legH / 2 + 0.02, sz * (TABLE.halfL - 0.26));
    leg.castShadow = true;
    scene.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 14), new THREE.MeshStandardMaterial({ color: 0x15191f, roughness: 0.8 }));
    foot.position.set(leg.position.x, 0.01, leg.position.z);
    scene.add(foot);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, (TABLE.halfL - 0.26) * 2), metalMat);
  rail.position.set(sx * (TABLE.halfW - 0.13), 0.28, 0);
  scene.add(rail);
}
// 球網：有網格紋路的半透明網、白色上緣、網柱與夾具
function netTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineWidth = 1;
  for (let x = 0; x <= 256; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 32); g.stroke(); }
  for (let y = 0; y <= 32; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const NET_W = TABLE.halfW * 2 + 0.3;
const net = new THREE.Mesh(
  new THREE.PlaneGeometry(NET_W, TABLE.netH - 0.012),
  new THREE.MeshBasicMaterial({ map: netTexture(), transparent: true, alphaTest: 0.05, side: THREE.DoubleSide, depthWrite: false }),
);
net.position.set(0, TABLE.top + (TABLE.netH - 0.012) / 2, 0);
scene.add(net);
const netBand = new THREE.Mesh(new THREE.BoxGeometry(NET_W, 0.016, 0.01), new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.5 }));
netBand.position.set(0, TABLE.top + TABLE.netH - 0.006, 0);
scene.add(netBand);
for (const s of [-1, 1]) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, TABLE.netH + 0.05, 10), metalMat);
  post.position.set(s * (TABLE.halfW + 0.15), TABLE.top + (TABLE.netH + 0.05) / 2 - 0.01, 0);
  scene.add(post);
  const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), metalMat);
  clamp.position.set(s * (TABLE.halfW + 0.15), TABLE.top - 0.02, 0);
  scene.add(clamp);
}

// 落點標記（對手來球預告彈起位置）與落桌漣漪
const landingMark = new THREE.Mesh(
  new THREE.RingGeometry(0.07, 0.1, 28),
  new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
);
landingMark.rotation.x = -Math.PI / 2;
landingMark.visible = false;
scene.add(landingMark);
function setLanding(x, z) {
  landingMark.position.set(x, TABLE.top + 0.006, z);
  landingOn = true;
}
const rippleMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
const ripples = Array.from({ length: 8 }, () => {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.085, 28), rippleMat());
  m.rotation.x = -Math.PI / 2;
  m.visible = false;
  scene.add(m);
  return { m, life: 0, max: 1, big: 1 };
});
let rippleI = 0;
function spawnRipple(x, z, color = 0xffffff, big = 1) {
  const r = ripples[rippleI++ % ripples.length];
  r.m.position.set(x, TABLE.top + 0.008, z);
  r.m.material.color.set(color);
  r.life = r.max = 0.7 + big * 0.3;
  r.big = big;
  r.m.visible = true;
}
function updateRipples(dt) {
  for (const r of ripples) {
    if (r.life <= 0) { r.m.visible = false; continue; }
    r.life -= dt;
    const k = 1 - Math.max(0, r.life) / r.max;
    r.m.scale.setScalar(1 + k * 2.4 * r.big);
    r.m.material.opacity = (1 - k) * 0.85;
  }
}

// 擊球範圍圈：滑動路徑要經過球（圈內）才算打到
const hitR = () => diff.hitR * clamp(Math.min(window.innerWidth, window.innerHeight * 0.56) / 375, 0.85, 1.5) * curMods().reach;
const _bs = new THREE.Vector3();
function ballScreen() {
  _bs.copy(ballMesh.position).project(camera);
  return { x: (_bs.x * 0.5 + 0.5) * window.innerWidth, y: (-_bs.y * 0.5 + 0.5) * window.innerHeight };
}
function canHitNow() {
  return (state === 'serve' && server === 'player')
    || (state === 'toss' && ball.vel.y < 0 && ball.pos.y > 0.85 && ball.pos.y < 1.45) // 拋球後，球落下到適合高度時才能打
    || (state === 'rally' && lastHitter === 'ai' && bounce.player >= 1 && ball.vel.z > 0
      && ball.pos.z > 0.95 && ball.pos.z < 2.5 && ball.pos.y > 0.45); // 太早（球還在桌面附近）的揮拍不算，空揮沒有任何後果
}
function updateHitRing() {
  const el = $('hitRing');
  if (!canHitNow()) { el.style.display = 'none'; $('timeRing').style.display = 'none'; return; }
  const p = ballScreen();
  const R = hitR();
  el.style.display = 'block';
  el.style.width = el.style.height = `${R * 2}px`;
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  const serving = state === 'serve' || state === 'toss';
  const tq = serving ? 1 : clamp(1 - Math.abs(ball.pos.z - 1.4) / 1.1, 0, 1);
  el.classList.toggle('gold', tq > 0.8);
  el.dataset.hand = serving ? '發球' : '';
  // 時機圈：外圈縮到跟綠圈一樣大的那一刻就是最佳擊球時機
  const tr = $('timeRing');
  if (state === 'rally') {
    const t = timingInfo(ball.pos.z);
    tr.style.display = 'block';
    tr.style.width = tr.style.height = `${R * 2 * (1 + 1.3 * Math.abs(t.off))}px`;
    tr.style.left = `${p.x}px`;
    tr.style.top = `${p.y}px`;
    tr.classList.toggle('perfect', Math.abs(t.off) < 0.2);
    tr.dataset.t = t.name;
  } else tr.style.display = 'none';
}

// 得分回放：把最後一球的軌跡用慢動作放大重播
function startReplay() {
  if (mode !== 'match' || online.role || rec.length < 8) return 0; // 連線對戰先不放回放
  const end = rec[rec.length - 1].t;
  const from = Math.max(rec[0].t, end - 1.5);
  const samples = rec.filter((r) => r.t >= from);
  if (samples.length < 6) return 0;
  const speed = 0.55;
  const dur = (samples[samples.length - 1].t - samples[0].t) / speed;
  const evs = recEvents.filter((e) => e.t >= from);
  const fo = evs.length ? evs[evs.length - 1] : samples[samples.length - 1];
  replayFocus.set(fo.x, TABLE.top + 0.2, fo.z);
  replay = {
    samples,
    events: recEvents.filter((e) => e.t >= from).map((e) => ({ ...e, fired: false })),
    t0: samples[0].t,
    head: 0,
    speed,
    span: samples[samples.length - 1].t - samples[0].t,
    hold: 0.7,
  };
  return dur + replay.hold;
}
function stepReplay(rawDt) {
  const r = replay;
  r.head += rawDt * r.speed;
  const h = Math.min(r.head, r.span);
  let i = 0;
  while (i < r.samples.length - 2 && r.samples[i + 1].t - r.t0 < h) i++;
  const a = r.samples[i], b = r.samples[Math.min(i + 1, r.samples.length - 1)];
  const k = b.t > a.t ? clamp((h + r.t0 - a.t) / (b.t - a.t), 0, 1) : 0;
  ball.pos.x = lerp(a.x, b.x, k); ball.pos.y = lerp(a.y, b.y, k); ball.pos.z = lerp(a.z, b.z, k);
  ball.spin = { top: lerp(a.top, b.top, k), side: lerp(a.side, b.side, k) };
  ball.vel = { x: (b.x - a.x) * 20, y: (b.y - a.y) * 20, z: (b.z - a.z) * 20 };
  for (const e of r.events) {
    if (!e.fired && e.t - r.t0 <= h) { e.fired = true; spawnRipple(e.x, e.z, 0xffd23f, 1.8); sfx.bounce(); }
  }
  if (r.head >= r.span + r.hold) replay = null;
}

let currentArena = DEFAULT_ARENA;
function applyArena(id) {
  const a = ARENAS[id] || ARENAS[DEFAULT_ARENA];
  currentArena = ARENAS[id] ? id : DEFAULT_ARENA;
  scene.background.set(a.bg);
  scene.fog.color.set(a.bg);
  scene.fog.near = a.fog[0];
  scene.fog.far = a.fog[1];
  hemi.color.set(a.hemi[0]);
  hemi.groundColor.set(a.hemi[1]);
  sun.color.set(a.sun);
  rim.color.set(a.rim);
  floor.material.color.set(a.floor);
  court.material.color.set(a.court);
  tableMat.color.set(a.table);
  tableEdgeMat.color.copy(tableMat.color).multiplyScalar(0.5);
  ring.material.color.set(a.ring);
  beams.forEach((b, i) => b.material.color.set(a.beams[i % a.beams.length]));
  pillars.forEach((p, i) => {
    p.material.color.set(a.pillar);
    p.material.emissive.setHSL(a.hue[0] + (a.hue[1] - a.hue[0]) * (i / (pillars.length - 1)), a.sat, a.light);
  });
  stars.visible = a.stars;
  // 裝飾：簡潔的場地不放霓虹柱、光束、發光圈
  const d = a.decor || {};
  pillars.forEach((p) => { p.visible = !!d.pillars; });
  beams.forEach((b) => { b.visible = !!d.beams; });
  ring.visible = !!d.ring;
}
applyArena(loadPref('arena2', DEFAULT_ARENA));

// 球、影子、殘影
const ball = makeBall();
// 球的外觀（造型）：每種球有自己的花紋，球旋轉時看得出來。花紋用程式畫成貼圖。
const _ballTex = {};
function ballTexture(id) {
  if (_ballTex[id]) return _ballTex[id];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const W = 256, H = 128;
  const stripes = (col, n, w) => { g.fillStyle = col; for (let i = 0; i < n; i++) g.fillRect((i * W) / n + 6, 0, w, H); };
  if (id === 'lead') {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#b7c0cc'); gr.addColorStop(1, '#6f7886');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = '#3b424d';
    for (let y = 14; y < H; y += 28) for (let x = 14 + ((y / 28) % 2) * 14; x < W; x += 28) { g.beginPath(); g.arc(x, y, 3.2, 0, 7); g.fill(); }
  } else if (id === 'bubble') {
    const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#a6e3ff'); gr.addColorStop(1, '#eaf9ff');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 3;
    for (const [x, y, r] of [[40, 40, 16], [110, 80, 22], [180, 36, 14], [225, 95, 18], [70, 100, 10]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); }
  } else if (id === 'spring') {
    g.fillStyle = '#7bd389'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#fff3a8'; g.lineWidth = 8; g.lineJoin = 'round';
    for (const y of [26, 64, 102]) { g.beginPath(); for (let x = 0; x <= W; x += 16) g.lineTo(x, y + (x / 16 % 2 ? 10 : -10)); g.stroke(); }
  } else if (id === 'fire') {
    const gr = g.createLinearGradient(0, H, 0, 0); gr.addColorStop(0, '#ff3d00'); gr.addColorStop(1, '#ffb300');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(120,10,0,.55)';
    for (let x = 0; x < W; x += 32) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 16, 30 + (x % 64 ? 24 : 0)); g.lineTo(x + 32, H); g.fill(); }
  } else if (id === 'melon') {
    g.fillStyle = '#5dbb63'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#1f6b34';
    for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(i * 43, 0); g.quadraticCurveTo(i * 43 + 16, H / 2, i * 43, H); g.lineTo(i * 43 + 12, H); g.quadraticCurveTo(i * 43 + 28, H / 2, i * 43 + 12, 0); g.fill(); }
  } else if (id === 'ghost') {
    g.fillStyle = '#eef1ff'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#a79bff'; g.lineWidth = 7;
    for (let r = 14; r < 120; r += 26) { g.beginPath(); g.arc(W / 2, H / 2, r, 0.3, 4.4); g.stroke(); }
  } else { // 標準球：奶油色 + 橘色條紋
    g.fillStyle = '#fff6dc'; g.fillRect(0, 0, W, H);
    stripes('#ff7a1a', 4, 28);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _ballTex[id] = t;
  return t;
}
const ballTex = ballTexture('std');
const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_R * 1.3, 20, 14),
  new THREE.MeshStandardMaterial({ map: ballTex, emissive: 0xffaa33, emissiveIntensity: 0.35 }),
);
scene.add(ballMesh);
const shadow = new THREE.Mesh(
  new THREE.CircleGeometry(0.06, 16),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 }),
);
shadow.rotation.x = -Math.PI / 2;
scene.add(shadow);
const trail = [];
for (let i = 0; i < 16; i++) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc766, transparent: true, opacity: 0 }));
  scene.add(m);
  trail.push(m);
}

// 旋轉種類 → 名稱、顏色、箭頭（軌跡與提示都用同一套顏色）
function spinInfo(sp) {
  if (Math.abs(sp.side) >= 0.3) return sp.side > 0
    ? { name: '右旋', arrow: '↷', css: '#4cc9f0' }
    : { name: '左旋', arrow: '↶', css: '#ff4fd8' };
  if (sp.top >= 0.4) return { name: '上旋', arrow: '⤵', css: '#ffa31a' };
  if (sp.top <= -0.3) return { name: '下旋', arrow: '⤴', css: '#7d9bff' };
  return null;
}

// 飛行軌跡：沿著球走過的路留下一串發光小點，旋球的弧線一目了然
const PATH_MAX = 220;
const pathMesh = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.011, 6, 5),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
  PATH_MAX,
);
pathMesh.count = 0;
pathMesh.frustumCulled = false;
scene.add(pathMesh);
let pathN = 0;
const pathLast = new THREE.Vector3();
const _m4 = new THREE.Matrix4();
function resetPath() {
  pathN = 0;
  pathMesh.count = 0;
  pathLast.set(ball.pos.x, ball.pos.y, ball.pos.z);
  const info = spinInfo(ball.spin);
  pathMesh.material.color.set(info ? info.css : '#ffffff');
  pathMesh.material.opacity = 0.7;
}
function growPath() {
  const cur = new THREE.Vector3(ball.pos.x, ball.pos.y, ball.pos.z);
  const d = cur.distanceTo(pathLast);
  const steps = Math.min(8, Math.floor(d / 0.065));
  for (let i = 1; i <= steps && pathN < PATH_MAX; i++) {
    const q = pathLast.clone().lerp(cur, i / steps);
    _m4.makeTranslation(q.x, q.y, q.z);
    pathMesh.setMatrixAt(pathN++, _m4);
  }
  if (steps > 0) { pathLast.copy(cur); pathMesh.count = pathN; pathMesh.instanceMatrix.needsUpdate = true; }
}

// 飛行中跟著球的旋轉提示文字
const _sp = new THREE.Vector3();
function updateSpinTag() {
  const el = $('spinTag');
  const info = state === 'rally' ? spinInfo(ball.spin) : null;
  if (!info) { el.style.display = 'none'; return; }
  _sp.copy(ballMesh.position).project(camera);
  el.style.display = 'block';
  el.textContent = `${info.arrow} ${info.name}`;
  el.style.color = info.css;
  el.style.left = `${(_sp.x * 0.5 + 0.5) * window.innerWidth}px`;
  el.style.top = `${(-_sp.y * 0.5 + 0.5) * window.innerHeight - 34}px`;
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
  c.react = 0;
  c.reactKind = 'win';
  c.baseZ = isPlayer ? PLAYER_Z : AI_Z;
  return c;
}
// ───────────────────────── 角色、球拍、球（出賽準備）─────────────────────────
const loadout = { char: loadPref('char', DEFAULT_CHARACTER), racket: loadPref('racket', DEFAULT_RACKET), ball: loadPref('ball', DEFAULT_BALL) };
let myChar = charById(loadout.char);
let myRacket = racketById(loadout.racket);
let myBall = ballById(loadout.ball);
let base = baseMods(myChar, myRacket, myBall);   // 整場不變的修正
let aiChar = charById('whirl');
let aiBase = baseMods(aiChar, racketById('std'), ballById('std'));
const skill = { gauge: 0, until: 0, armed: false };   // 技能槽、持續中的技能、待發動的下一球技能
let pendingAiMiss = 0;                                // 技能讓對手下一次回球更容易失誤
const lookWithRacket = (cfg) => ({ ...cfg, racket: myRacket.id, paddleColor: myRacket.color || cfg.paddleColor });
let playerCfg = loadConfig(myChar.id, myChar.look);
let player = makeActor(lookWithRacket(playerCfg), true);
let ai = makeActor(aiChar.look, false);

// 比賽時玩家的大頭會擋住視線，所以讓它半透明；編輯造型時要完全不透明
function setPlayerGhost(c, ghost) {
  c.headBase = ghost ? 0.62 : 1; // 比賽時把玩家的頭縮小（只是視覺）
  const inHead = (o) => { for (let p = o; p; p = p.parent) if (p === c.head) return true; return false; };
  c.group.traverse((o) => {
    if (o.userData.outline) { o.visible = !ghost; return; } // 透明時不要黑色描邊（描邊材質是各角色共用的，不能改它）
    if (!o.material) return;
    o.material.transparent = ghost;
    o.material.opacity = ghost ? (inHead(o) ? 0.12 : 0.4) : 1; // 頭最透明，身體次之，才不會擋到球桌
    o.material.depthWrite = !ghost;
    o.material.needsUpdate = true;
  });
}
function disposeActor(c) {
  for (const o of [c.group, c.paddle, c.arm]) {
    scene.remove(o);
    o.traverse((m) => { m.geometry?.dispose(); m.material?.dispose?.(); });
  }
}
function rebuildPlayer(cfg) {
  const x = player.x;
  disposeActor(player);
  player = makeActor(lookWithRacket(cfg), true);
  player.x = x;
  if (state === 'editor' || state === 'loadout') player.group.rotation.y = 0;
  else setPlayerGhost(player, true);
  window.__game && (window.__game.player = player);
}
setPlayerGhost(player, true);
function rebuildAi(look) {
  const x = ai.x;
  disposeActor(ai);
  ai = makeActor(look, false);
  ai.x = x;
  window.__game && (window.__game.ai = ai);
}

function swingActor(c, toPos, dirX = 0, dur = 0.3, bh = false) {
  c.swing = { t: 0, to: toPos.clone(), dirX, dur, bh };
}


// ───────────────────────── 擊球修正（fx）與技能 ─────────────────────────
const timedActive = () => skill.until > clockT;
function curMods() {
  const m = { push: base.push, spin: base.spin, err: base.err, free: base.free, reach: base.reach,
    sideSpin: base.sideSpin, smashPush: base.smashPush, chopSpin: base.chopSpin, dropDepth: base.dropDepth };
  if (myChar.id === 'mochi') m.free += 0.04 * Math.min(perfectChain, 3); // Q彈：連續完美，時機更寬
  if (timedActive()) {
    switch (myChar.skill.id) {
      case 'laser': m.err = 0; break;
      case 'bounce': m.reach *= 1.6; m.free *= 1.8; break;
      case 'rage': m.push *= 1.15; m.spin *= 1.4; m.err *= 2; break;
      case 'eightArms': m.reach *= 2; break;
      default: break;
    }
  }
  if (skill.armed) {
    switch (myChar.skill.id) {
      case 'tornado': m.sideMin = 0.7; m.sideSpin = (m.sideSpin ?? 1) * 1.6; m.kickMul = 2; break;
      case 'roar': m.kind = 'smash'; break;
      case 'fancyDrop': m.kind = 'drop'; m.sideMin = 0.7; m.kickMul = -1.6; break;
      case 'invisible': m.hidden = true; break;
      default: break;
    }
  }
  return m;
}
function addGauge(v) { skill.gauge = Math.min(1, skill.gauge + v); updateSkillUI(); }
function activateSkill() {
  if (skill.gauge < 1 || !(state === 'serve' || state === 'toss' || state === 'rally')) return;
  const sk = myChar.skill;
  skill.gauge = 0;
  if (sk.kind === 'timed') skill.until = clockT + sk.secs; else skill.armed = true;
  pop(sk.name, '#f2b134');
  sfx.point();
  buzz(20);
  updateSkillUI();
}
// 下一球技能：打出去之後才消耗，並讓對手的下一次回球更容易失誤
function consumeSkillOnShot() {
  if (!skill.armed) return;
  skill.armed = false;
  if (myChar.skill.id === 'smoke') pendingAiMiss += 0.35;
  if (myChar.skill.id === 'invisible') pendingAiMiss += 0.35;
}
function updateSkillUI() {
  const b = $('skillBtn');
  if (!b) return;
  const sk = myChar.skill;
  const active = timedActive() || skill.armed;
  const left = timedActive() ? (skill.until - clockT) / sk.secs : 0;
  b.style.setProperty('--p', `${Math.round((active ? (timedActive() ? left : 1) : skill.gauge) * 100)}%`);
  b.classList.toggle('ready', skill.gauge >= 1 && !active);
  b.classList.toggle('active', active);
  b.querySelector('b').textContent = active ? `${sk.name}${skill.armed ? '（下一球）' : ''}` : skill.gauge >= 1 ? `技能：${sk.name}` : sk.name;
}
// 對手角色：AI 也用同一套數值（只套用基礎數值與被動，不放技能）
function aiSkill() { return { sigO: diff.sigO * aiBase.err, sigT: diff.sigT * (0.3 / aiBase.free) }; }
function aiMods() { return { push: aiBase.push, spin: aiBase.spin }; }
function pickAiCharacter() {
  const pool = CHARACTERS.filter((c) => c.id !== myChar.id);
  aiChar = pool[Math.floor(Math.random() * pool.length)];
  aiBase = baseMods(aiChar, racketById('std'), ballById('std'));
  rebuildAi(aiChar.look);
  $('nameA').textContent = aiChar.name;
}
// 球與場地的物理效果（重力、彈性、滑行）
function applyPhysicsFx() {
  const a = ARENA_FX[currentArena] || {};
  TUNE.gravity = base.gravity * (a.gravity ?? 1);
  TUNE.restitution = base.rest;
  TUNE.slide = base.slide * (a.slide ?? 1);
  ballMesh.scale.setScalar(myBall.scale);
  ballMesh.material.map = ballTexture(myBall.id);
  ballMesh.material.color.set('#ffffff'); // 顏色來自貼圖
  ballMesh.material.needsUpdate = true;
}
function applyLoadout() {
  myChar = charById(loadout.char);
  myRacket = racketById(loadout.racket);
  myBall = ballById(loadout.ball);
  base = baseMods(myChar, myRacket, myBall);
  playerCfg = loadConfig(myChar.id, myChar.look);
  rebuildPlayer(playerCfg);
  applyPhysicsFx();
  updateSkillUI();
}

const _v = new THREE.Vector3();

// ───────────────────────── 連線對戰（房主 host ＋ 訪客 guest）─────────────────────────
// 房主的電腦／手機負責「真正的比賽」（物理、規則、計分）；訪客只傳「我揮了一拍」，並接收畫面所需的快照。
// 訪客的畫面把座標轉 180°（x、z 取負），所以雙方都看到自己在近端、對手在遠端。
const online = { role: null, link: null, code: '', opp: null, myReady: false, oppReady: false, started: false,
  guestToss: false, hitLock: 0, snapT: 0, posT: 0, remoteX: 0, lastRecv: 0, pendingOver: null };
const mPos = (p) => ({ x: -p.x, y: p.y, z: -p.z });
const mSpin = (sp) => ({ top: sp.top, side: -sp.side });
const swapSide = (s) => (s === 'player' ? 'ai' : 'player');
const netSend = (o) => { online.link?.send(o); };
let toastTimer = 0;
function toast(msg, ms = 3200) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
function myHello() {
  return { t: 'hello', name: profile.name, char: myChar.id, racket: myRacket.id, ball: myBall.id, look: playerCfg };
}
function setOnlineScreen(which) { // home / host / join
  for (const id of ['onlineHome', 'onlineHost', 'onlineJoin']) $(id).classList.toggle('hidden', id !== which);
}
function openOnline() {
  unlockAudio();
  setOnlineScreen('onlineHome');
  $('onlineSub').textContent = '兩台裝置輸入同一個房號，就能對戰';
  showScreen('online');
}
function resetOnline() {
  try { online.link?.close(); } catch { /* 略過 */ }
  Object.assign(online, { role: null, link: null, code: '', opp: null, myReady: false, oppReady: false, started: false, guestToss: false, hitLock: 0, remoteX: 0, pendingOver: null });
  TUNE.windX = 0;
}
function leaveOnline(msg) {
  const wasPlaying = online.started;
  resetOnline();
  closeLoadout?.();
  if (state !== 'menu') {
    state = 'menu';
    setHud(false);
    $('goBtn').disabled = false;
    $('goBtn').textContent = '開始';
    showScreen('menu');
  }
  applyLoadout();
  if (msg) toast(msg);
  else if (wasPlaying) toast('已離開連線對戰');
}
const netCallbacks = () => ({
  onCode: (code) => { online.code = code; $('roomCode').textContent = code; $('hostStatus').textContent = '把房號告訴朋友，等他加入…'; },
  onOpen: () => onNetOpen(),
  onMessage: (m) => onNetMessage(m),
  onClose: () => { if (online.role) leaveOnline('對手已離線'); showScreen(state === 'menu' ? 'menu' : null); },
  onError: (e) => {
    const msg = explainError(e);
    if (online.role === 'guest' && !online.link?.state?.open) { $('joinStatus').textContent = msg; return; }
    if (online.role === 'host' && !online.code) { $('hostStatus').textContent = msg; return; }
    if (online.role) leaveOnline(msg);
  },
});
function startHost() {
  resetOnline();
  online.role = 'host';
  setOnlineScreen('onlineHost');
  $('roomCode').textContent = '----';
  $('hostStatus').textContent = '正在建立房間…';
  online.link = hostRoom(netCallbacks());
}
function startJoin(code) {
  if (!/^\d{4}$/.test(code)) { $('joinStatus').textContent = '請輸入 4 位數房號'; return; }
  resetOnline();
  online.role = 'guest';
  $('joinStatus').textContent = '連線中…';
  online.link = joinRoom(code, netCallbacks());
  online.code = code;
}
function onNetOpen() {
  netSend(myHello());
  toast('已連線，請選擇角色後按「準備」', 2800);
  $('goBtn').textContent = '準備';
  $('goBtn').disabled = false;
  openLoadout('online');
}
function onlineReady() {
  online.myReady = true;
  $('goBtn').disabled = true;
  $('goBtn').textContent = '等待對手…';
  netSend({ t: 'ready', hello: myHello() });
  hostTryStart();
}
function hostTryStart() {
  if (online.role !== 'host' || !online.myReady || !online.oppReady || !online.opp) return;
  closeLoadout();
  online.started = true;
  startGame('match');
  netSend({
    t: 'start', arena: currentArena, ball: myBall.id, first: firstServer === 'player' ? 'host' : 'guest',
    phys: { g: TUNE.gravity, r: TUNE.restitution, s: TUNE.slide },
    host: { name: profile.name, char: myChar.id, racket: myRacket.id, look: playerCfg },
  });
}
// 對手角色：用對方傳來的外觀與角色數值
function setupOpponent(o) {
  aiChar = charById(o.char);
  aiBase = baseMods(aiChar, racketById(o.racket), ballById('std'));
  rebuildAi({ ...(o.look || aiChar.look), racket: o.racket });
  $('nameA').textContent = o.name || aiChar.name;
}
function guestStart(m) {
  closeLoadout();
  online.started = true;
  online.guestToss = false;
  mode = 'match';
  applyArena(m.arena);
  TUNE.gravity = m.phys.g; TUNE.restitution = m.phys.r; TUNE.slide = m.phys.s;
  const bl = ballById(m.ball);
  ballMesh.scale.setScalar(bl.scale);
  ballMesh.material.map = ballTexture(bl.id);
  ballMesh.material.color.set('#ffffff');
  ballMesh.material.needsUpdate = true;
  myBall = bl; // 球的外觀以房主的為準
  skill.gauge = 0; skill.until = 0; skill.armed = false; perfectChain = 0;
  setupOpponent({ name: m.host.name, char: m.host.char, racket: m.host.racket, look: m.host.look });
  score = { player: 0, ai: 0 };
  streak = 0;
  server = m.first === 'guest' ? 'player' : 'ai';
  lastHitter = server;
  bounce = { player: 0, ai: 0 };
  state = 'serve';
  showScreen(null);
  setHud(true);
  updateScoreUI();
  updateSkillUI();
  setHint(server === 'player' ? '點球拋起，落下時再點或滑過球發球' : '對手發球，準備接球！');
}
function onNetMessage(m) {
  if (!m || typeof m !== 'object') return;
  online.lastRecv = performance.now();
  switch (m.t) {
    case 'hello': online.opp = { name: String(m.name || '對手').slice(0, 16), char: m.char, racket: m.racket, ball: m.ball, look: m.look }; break;
    case 'ready':
      online.opp = { ...online.opp, ...(m.hello ? { name: String(m.hello.name || '對手').slice(0, 16), char: m.hello.char, racket: m.hello.racket, look: m.hello.look } : {}) };
      online.oppReady = true; hostTryStart(); break;
    case 'start': if (online.role === 'guest') guestStart(m); break;
    case 'snap': applySnapshot(m); break;
    case 'pos': online.remoteX = online.role === 'host' ? -m.x : -m.x; break; // 雙方座標都是「自己看自己」，對方的 x 要取負
    case 'hit': if (online.role === 'host') hostRemoteHit(m); break;
    case 'serve': if (online.role === 'host') hostRemoteServe(m); break;
    case 'res': if (online.role === 'guest') guestHitResult(m); break;
    case 'ev': if (online.role === 'guest') guestEvent(m); break;
    case 'point': if (online.role === 'guest') guestPoint(m); break;
    case 'over': if (online.role === 'guest') guestOver(m); break;
    case 'again': if (online.role === 'host') toast('對手想再來一局'); break;
    default: break;
  }
}

// ── 房主：處理訪客的擊球 ──
function hostRemoteHit(m) {
  if (state !== 'rally' || lastHitter !== 'player' || bounce.ai < 1 || ball.vel.z >= 0) return;
  const zc = -ball.pos.z;
  if (zc < 0.6 || zc > 3.2 || ball.pos.y < 0.35) return;
  const sw = m.sw || {};
  const p0c = mPos(ball.pos); // 換成「訪客站在近端」的座標來算
  const guestX = -ai.x;
  const hand = handOf(p0c.x, guestX);
  const tInfo = timingInfo(Number(m.z) || p0c.z);
  const contact = { ox: Number(m.contact?.ox) || 0, oy: Number(m.contact?.oy) || 0 };
  const shot = buildPlayerShot({ swipe: { dx: +sw.dx || 0, dy: +sw.dy || 0, len: +sw.len || 0, dur: +sw.dur || 1, speed: +sw.speed || 0, curve: +sw.curve || 0 }, p0: p0c, hand, timingOff: tInfo.off, contact, mods: m.mods || {} });
  const fin = finalizeShot(p0c, shot);
  const vel = mPos(fin.vel);
  launch({ vel, spin: mSpin(shot.spin), kickMul: shot.kickMul, hidden: shot.hidden }, 'ai');
  lastShotWasSmash = shot.smash;
  swingActor(ai, new THREE.Vector3(ball.pos.x, ball.pos.y, ball.pos.z), clamp(-(+sw.dx || 0) / 120, -1, 1), 0.3, hand === 'BH');
  if (shot.smash) { sfx.smash(); shake = 0.12; } else sfx.hit();
  const f = describeFlight(p0c, fin.vel, shot.spin);
  netSend({ t: 'res', label: shot.label, perfect: shot.perfect, smash: shot.smash, tn: tInfo.name, contact, pace: f.pace, curve: f.curveCm, landing: f.landing ? f.landing.zone : null });
}
function hostRemoteServe(m) {
  if (state !== 'serve' || server !== 'ai') return;
  const p0c = { x: +m.p0?.[0] || 0, y: +m.p0?.[1] || 1.05, z: +m.p0?.[2] || 3.15 };
  const sw = m.sw || {};
  const shot = buildPlayerShot({ swipe: { dx: +sw.dx || 0, dy: +sw.dy || -100, len: +sw.len || 100, dur: +sw.dur || 150, speed: +sw.speed || 0.8, curve: +sw.curve || 0 }, p0: p0c, hand: 'FH', isServe: true, errMul: 0.5, contact: { ox: (Number(m.contact?.ox) || 0) * 0.6, oy: 0 } });
  const sv = solveServe(p0c, shot.target, shot.spin);
  ball.pos = mPos(p0c);
  launch({ vel: mPos(sv.vel), spin: mSpin(shot.spin) }, 'ai', true);
  state = 'rally';
  swingActor(ai, new THREE.Vector3(ball.pos.x, ball.pos.y, ball.pos.z), 0);
  sfx.hit();
}

// ── 訪客：送出擊球、接收結果 ──
function guestHit(s, p0, hand, tInfo, contact, mods) {
  if (clockT < online.hitLock) return;
  online.hitLock = clockT + 0.4; // 送出後等房主的結果，不重複擊球
  netSend({ t: 'hit', sw: { dx: s.dx, dy: s.dy, len: s.len, dur: s.dur, speed: s.speed, curve: s.curve }, contact, z: s.contactZ ?? p0.z, mods });
  swingActor(player, new THREE.Vector3(p0.x, p0.y, p0.z), clamp(s.dx / 120, -1, 1), 0.3, hand === 'BH');
  sfx.hit();
  buzz(8);
  consumeSkillOnShot();
}
function guestServe(s, p0) {
  netSend({ t: 'serve', p0: [p0.x, p0.y, p0.z], sw: { dx: s.dx, dy: s.dy, len: s.len, dur: s.dur, speed: s.speed, curve: s.curve }, contact: { ox: s.contactOx ?? 0 } });
  swingActor(player, new THREE.Vector3(p0.x, p0.y, p0.z), clamp(s.dx / 120, -1, 1));
  sfx.hit();
  setHint('');
}
function guestHitResult(m) {
  perfectChain = m.perfect ? perfectChain + 1 : 0;
  addGauge(m.perfect ? 0.25 : 0.1);
  if (m.smash) { sfx.smash(); shake = TUNE.smashShake; fovKick = TUNE.smashFov; }
  if (m.smash || perfectChain >= 2) pop(perfectChain >= 2 ? `完美 ×${perfectChain}` : m.label, m.smash ? '#ff8a4c' : '#7dff9a');
  showShotInfo({ label: m.label }, { pace: m.pace, speed: m.pace, curveCm: m.curve, landing: m.landing ? { zone: m.landing } : null }, { name: m.tn }, m.contact);
}
function guestEvent(m) {
  if (m.e === 'launch' && m.by === 'host') {
    const p = mPos({ x: m.p[0], y: m.p[1], z: m.p[2] });
    swingActor(ai, new THREE.Vector3(p.x, p.y, p.z), 0);
    sfx.hit();
  }
}
function guestPoint(m) {
  const w = m.w === 'guest' ? 'player' : 'ai';
  score = { player: m.sc.g, ai: m.sc.h };
  state = 'point';
  online.guestToss = false;
  rally = 0;
  react(w);
  if (w === 'player') { sfx.point(); pop('得分！', '#7dff9a'); } else { sfx.lose(); pop('失分…', '#ff7d7d'); }
  updateScoreUI();
}
function guestOver(m) {
  state = 'over';
  const a = m.g, b = m.h; // 訪客是「你」
  setTimeout(() => {
    if (state !== 'over') return;
    $('overTitle').textContent = a > b ? '勝利' : '落敗';
    $('overScore').textContent = `${a} : ${b}`;
    showScreen('over');
  }, 1400);
}
function enterGuestState(ns) {
  online.guestToss = online.guestToss && ns !== 'rally';
  if (ns === 'serve') {
    perfectChain = 0;
    setHint(server === 'player' ? '點球拋起，落下時再點或滑過球發球' : '對手發球，準備接球！');
  } else if (ns === 'rally') setHint('');
}
function applySnapshot(m) {
  if (online.role !== 'guest' || !online.started) return;
  server = swapSide(m.sv);
  lastHitter = swapSide(m.lh);
  bounce = { player: m.b.ai, ai: m.b.player };
  if (state !== 'point' && state !== 'over') score = { player: m.sc.ai, ai: m.sc.player };
  serveStage = m.ss;
  online.remoteX = -m.px;
  TUNE.windX = -m.wx;
  if (online.guestToss) { if (m.s === 'rally') online.guestToss = false; else return; } // 自己拋球時，球由本機控制
  if (m.s !== state && !(state === 'over' && m.s === 'point')) { enterGuestState(m.s); state = m.s; }
  const tp = mPos({ x: m.p[0], y: m.p[1], z: m.p[2] });
  const err = Math.hypot(ball.pos.x - tp.x, ball.pos.y - tp.y, ball.pos.z - tp.z);
  if (err > 0.45 || state === 'serve' || state === 'toss') ball.pos = tp;
  else { ball.pos.x += (tp.x - ball.pos.x) * 0.5; ball.pos.y += (tp.y - ball.pos.y) * 0.5; ball.pos.z += (tp.z - ball.pos.z) * 0.5; }
  ball.vel = { x: -m.v[0], y: m.v[1], z: -m.v[2] };
  ball.spin = { top: m.sp[0], side: -m.sp[1] };
  ball.kickMul = m.km ?? 1;
  ball.hidden = !!m.hid;
  updateScoreUI();
}
// 訪客這一端的球：用相同的物理自己往前推（兩次快照之間更順），規則與計分全由房主決定
function guestStep(h) {
  if (state === 'toss' && online.guestToss) { stepToss(h); return; }
  if (state === 'rally') {
    stepBall(ball, h);
    if (ball.vel.y < 0 && ball.pos.y <= TABLE.top + BALL_R && ball.pos.y > TABLE.top - 0.12
      && Math.abs(ball.pos.x) <= TABLE.halfW + BALL_R && Math.abs(ball.pos.z) <= TABLE.halfL + BALL_R) {
      bounceOnTable(ball);
      sfx.bounce();
      spawnRipple(ball.pos.x, ball.pos.z, 0xffffff, 0.8);
    }
  } else if (state === 'point' || state === 'over') stepAfterPoint(h);
}
// 每個畫面更新：傳快照／位置、偵測斷線
function onlineFrame(rawDt) {
  if (!online.started) return;
  online.snapT += rawDt;
  online.posT += rawDt;
  if (online.role === 'host' && online.snapT >= 0.033) {
    online.snapT = 0;
    netSend({ t: 'snap', s: state, sv: server, lh: lastHitter, b: bounce, sc: score, ss: serveStage,
      p: [ball.pos.x, ball.pos.y, ball.pos.z], v: [ball.vel.x, ball.vel.y, ball.vel.z], sp: [ball.spin.top, ball.spin.side],
      km: ball.kickMul ?? 1, hid: ball.hidden ? 1 : 0, px: player.x, wx: TUNE.windX });
  }
  if (online.posT >= 0.066) { online.posT = 0; netSend({ t: 'pos', x: player.x }); }
  const rs = online.link?.state;
  if (rs && rs.lastRecv && Date.now() - rs.lastRecv > 9000) leaveOnline('和對手失去連線');
}

const _axisX = new THREE.Vector3(1, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);
function updateActor(c, dt, time) {
  const g = c.group;
  g.position.x = c.x;
  c.body.position.y = Math.abs(Math.sin(time * 5 + (c.isPlayer ? 0 : 1))) * 0.035;
  c.head.rotation.z = Math.sin(time * 3 + (c.isPlayer ? 0 : 2)) * 0.07;
  // 得分／失分的搞笑反應：贏的人跳起來，輸的人頭膨脹搖晃
  if (c.react > 0) {
    c.react -= dt;
    const k = Math.max(0, c.react), f = Math.min(1, k * 2);
    if (c.reactKind === 'win') {
      c.body.position.y += Math.abs(Math.sin(k * 13)) * TUNE.reactJump * f;
      c.head.rotation.z += Math.sin(k * 28) * TUNE.reactWobble * f;
    } else {
      c.head.rotation.z += Math.sin(k * 24) * TUNE.reactWobble * 1.5 * f;
      const sq = 1 + Math.sin(k * 10) * 0.1 * f;
      const hb = c.headBase ?? 1;
      c.head.scale.set(sq * hb, hb / sq, sq * hb);
    }
  } else { const hb = c.headBase ?? 1; c.head.scale.set(hb, hb, hb); }

  g.updateMatrixWorld(true);
  c.shoulder.getWorldPosition(_v);
  const fwd = Math.cos(g.rotation.y) >= 0 ? 1 : -1; // 面向 +z 或 -z
  const handSide = Math.sign(_v.x - c.x) || 1;      // 球拍手在畫面哪一側
  const rest = new THREE.Vector3(c.x + handSide * 0.5, 1.0, c.baseZ + fwd * 0.55);
  const pos = rest.clone();
  const restMirror = rest.clone();
  restMirror.x = c.x - handSide * 0.5; // 反手：球拍從身體另一側橫過來
  let tilt = 0;
  if (c.swing) {
    const s = c.swing;
    s.t += dt / s.dur;
    if (s.t >= 1) {
      c.swing = null;
    } else {
      const k = s.t < 0.35 ? 1 - Math.pow(1 - s.t / 0.35, 3) : 1 - Math.pow((s.t - 0.35) / 0.65, 2);
      pos.lerpVectors(s.bh ? restMirror : rest, s.to, k);
      tilt = s.dirX * k;
    }
  }
  c.paddle.position.copy(pos);
  c.paddle.rotation.set(-0.25 * fwd, 0, -tilt * 0.6);
  stretchArm(c.arm, _v.clone(), pos.clone().add(new THREE.Vector3(0, -0.08, 0)));
}

// ───────────────────────── 比賽狀態 ─────────────────────────
let state = 'menu'; // menu | editor | serve | rally | point | over
let mode = 'match'; // match（對戰 AI）| drill（發球機練習）
let streak = 0;
let perfectChain = 0;    // 連續完美擊球數
let serveStage = 0;      // 發球規則：1 = 等第一次落在自己半桌，2 = 等落在對方半桌，0 = 一般對打
let replay = null;       // 得分後的放大回放
let replayBlend = 0;
const replayFocus = new THREE.Vector3(0, 0.9, -0.5); // 回放鏡頭對準的位置（關鍵落點）
let clockT = 0;
let landingOn = false;
const rec = [];          // 最後一球的飛行紀錄
const recEvents = [];    // 落桌點
let bestStreak = Number(loadPref('bestStreak', 0)) || 0;
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
  $('rally').textContent = mode === 'match' && rally > 1 ? `連續對打 ${rally}` : '';
  $('sStreak').textContent = streak;
  $('sBest').textContent = bestStreak;
}

function currentServer() {
  const total = score.player + score.ai;
  if (score.player >= 10 && score.ai >= 10) return total % 2 === 0 ? firstServer : other(firstServer);
  return Math.floor(total / 2) % 2 === 0 ? firstServer : other(firstServer);
}

function startPoint() {
  serveStage = 0;
  perfectChain = 0;
  replay = null; // 離開或重開時，若回放還在播就中止，否則球會被回放拉走
  server = mode === 'drill' ? 'ai' : currentServer();
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
    setHint('點球拋起，落下時再點或滑過球發球');
  } else {
    ball.pos = { x: ai.x, y: 1.05, z: AI_Z + 0.35 };
    lastHitter = 'ai';
    serveTimer = 1.1;
    setHint('對手發球，準備接球！');
  }
  updateScoreUI();
}

function react(winner) {
  const w = winner === 'player' ? player : ai;
  const l = winner === 'player' ? ai : player;
  w.react = 1.2; w.reactKind = 'win';
  l.react = 1.2; l.reactKind = 'lose';
}

function award(winner, why) {
  if (state === 'point' || state === 'over') return;
  if (mode === 'drill') { drillResult(winner, why); return; }
  const longRally = rally >= 6;
  score[winner]++;
  state = 'point';
  rec.push({ t: clockT, x: ball.pos.x, y: ball.pos.y, z: ball.pos.z, top: ball.spin.top, side: ball.spin.side });
  const rdur = startReplay();
  pointTimer = rdur > 0 ? rdur + 0.5 : 1.7;
  rally = 0;
  react(winner);
  if (longRally && !rdur) { slowT = TUNE.smashSlow; fovKick = TUNE.smashFov; }
  if (online.role === 'host') netSend({ t: 'point', w: winner === 'player' ? 'host' : 'guest', sc: { h: score.player, g: score.ai } });
  if (winner === 'player') { sfx.point(); pop(why || '得分！', '#7dff9a'); }
  else { sfx.lose(); pop(why || '失分…', '#ff7d7d'); }
  updateScoreUI();
  const a = score.player, b = score.ai;
  if ((a >= WIN_SCORE || b >= WIN_SCORE) && Math.abs(a - b) >= 2) {
    state = 'over';
    setTimeout(() => {
    if (online.role === 'host') netSend({ t: 'over', h: a, g: b });
      if (state !== 'over') return;
      $('overTitle').textContent = a > b ? '勝利' : '落敗';
      $('overScore').textContent = `${a} : ${b}`;
      showScreen('over');
    }, (rdur > 0 ? rdur + 0.9 : 1.4) * 1000);
  }
}

// 練習模式：只統計「連續命中」，不計分、不結束
function drillResult(winner, why) {
  state = 'point';
  pointTimer = 1.1;
  rally = 0;
  if (winner === 'player' && lastHitter === 'player') {
    streak++;
    react('player');
    if (streak > bestStreak) { bestStreak = streak; savePref('bestStreak', bestStreak); }
    sfx.point();
    if (streak >= 3) pop(`命中 ×${streak}`, '#7dff9a');
  } else if (winner === 'player') {
    pop('重發', '#ffd23f'); // 發球機自己的失誤不算你的
  } else {
    streak = 0;
    react('ai');
    sfx.lose();
    pop(why || '失誤…', '#ff7d7d');
  }
  updateScoreUI();
}

// ───────────────────────── 擊球 ─────────────────────────
function launch(shot, hitter, isServe = false) {
  serveStage = isServe ? 1 : 0;
  ball.vel = { ...shot.vel };
  ball.spin = { ...shot.spin };
  ball.kickMul = shot.kickMul ?? 1;   // 技能：落桌後的偏轉倍率
  ball.hidden = !!shot.hidden;        // 技能：隱形球
  lastHitter = hitter;
  bounce = { player: 0, ai: 0 };
  rally++;
  aiTried = false;
  resetPath();
  if (online.role === 'host') netSend({ t: 'ev', e: 'launch', by: hitter === 'player' ? 'host' : 'guest', p: [ball.pos.x, ball.pos.y, ball.pos.z] });
  rec.length = 0;
  recEvents.length = 0;
  landingOn = false;
  updateScoreUI();
}

function zoneText(p) {
  const lr = p.x < -0.25 ? '左' : p.x > 0.25 ? '右' : '中';
  const d = Math.abs(p.z);
  return `${lr}・${d < 0.45 ? '網前' : d < 0.95 ? '中場' : '底線'}`;
}

// 擊球後在畫面上方顯示：球種、時機、球速、弧度、落點（方便「看」每一球的結果）
let shotInfoTimer = 0;
function buzz(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* 不支援震動就略過 */ }
}
function contactText(c) {
  if (Math.hypot(c.ox, c.oy) < SWEET) return '正中心';
  return Math.abs(c.oy) > Math.abs(c.ox) ? (c.oy < 0 ? '偏起手' : '偏收尾') : (c.ox < 0 ? '偏左' : '偏右');
}
function showShotInfo(shot, sim, tInfo, contact) {
  const el = $('shotInfo');
  el.replaceChildren();
  const l1 = document.createElement('b');
  l1.textContent = shot.label;
  const l2 = document.createElement('span');
  const parts = [];
  if (tInfo) parts.push(`時機${tInfo.name}`);
  if (contact) parts.push(`擊球點${contactText(contact)}`);
  parts.push(`球速 ${Math.round((sim.pace ?? sim.speed) * 3.6)} km/h`);
  if (sim.curveCm != null) parts.push(`弧度 ${sim.curveCm} cm`);
  // 失誤的球不會預告結果（不標落點、也不寫掛網／出界）
  if (sim.landing) parts.push(`落點 ${sim.landing.zone}`);
  l2.textContent = parts.join(' · ');
  el.append(l1, l2);
  el.style.display = 'flex';
  clearTimeout(shotInfoTimer);
  shotInfoTimer = setTimeout(() => { el.style.display = 'none'; }, 2600);
  if (sim.landing) setLanding(sim.landing.x, sim.landing.z); // 立刻在球桌上標出落點
}

// 拋球發球：點一下球 → 球垂直拋起 → 落下到適合的高度時，點一下或滑過球發出去
function tossBall() {
  state = 'toss';
  if (online.role === 'guest') online.guestToss = true; // 連線時，拋球在本機進行，打出去才通知對方
  ball.vel = { x: 0, y: 3.3, z: 0 };
  ball.spin = { top: 0, side: 0 };
  setHint('球落下時，點一下或滑過球發球');
  sfx.whoosh();
}
function stepToss(dt) {
  stepBall(ball, dt);
  if (ball.vel.y < 0 && ball.pos.y < 0.7) { // 沒打到：球回到手上，重新發球，不算失誤
    ball.pos = { x: player.x, y: 1.05, z: PLAYER_Z - 0.35 };
    ball.vel = { x: 0, y: 0, z: 0 };
    state = 'serve';
    setHint('球回到手上了，再發一次');
    online.guestToss = false;
  }
}

function playerServe(s) {
  if (Math.abs(s.dy) < 25) return; // 往上滑＝一般發球，往下滑＝下旋發球
  if (!s.anyWin || s.contact > hitR()) { sfx.whoosh(); pop('要從球上滑過去！', '#ffd23f'); return; }
  const p0 = { ...ball.pos };
  // 發球只看「左右」有沒有碰在中間，而且容錯加倍（不看這一劃的哪一段），所以不容易飛走
  if (online.role === 'guest') { guestServe(s, p0); return; }
  const shot = buildPlayerShot({ swipe: s, p0, hand: 'FH', isServe: true, errMul: 0.5, contact: { ox: (s.contactOx ?? 0) * 0.6, oy: 0 } });
  // 發球：球先落在自己這半桌，彈起後過網，再落在對方半桌
  const sv = solveServe(p0, shot.target, shot.spin);
  launch({ vel: sv.vel, spin: shot.spin }, 'player', true);
  state = 'rally';
  swingActor(player, new THREE.Vector3(p0.x, p0.y, p0.z), clamp(s.dx / 120, -1, 1));
  sfx.hit();
  setHint('');
  showShotInfo(shot, { speed: Math.hypot(sv.vel.x, sv.vel.z), landing: sv.result === 'ok' && sv.landing ? { x: sv.landing.x, z: sv.landing.z, zone: zoneText(sv.landing) } : null }, null);
}

function playerSwipe(s) {
  if ((state === 'serve' || state === 'toss') && server === 'player') { playerServe(s); return; }
  if (state !== 'rally') return;
  const dirX = clamp(s.dx / 120, -1, 1);
  const reach = lastHitter === 'ai' && bounce.player >= 1 && ball.vel.z > 0 && ball.pos.z > 0.8 && ball.pos.z < 3.0 && ball.pos.y > 0.4;
  // 空揮（沒滑到球、或球還沒進入擊球範圍）只會揮一下拍子，不扣分、不出現任何訊息，可以揮很多次
  if (!(s.anyWin && reach) || s.contact > hitR()) {
    sfx.whoosh();
    swingActor(player, new THREE.Vector3(player.x + dirX * 0.3, 1.1, PLAYER_Z - 1.0), dirX);
    return;
  }
  const p0 = { ...ball.pos };
  const hand = handOf(p0.x, player.x);                    // 球在身體右側＝正手，左側＝反手
  const tInfo = timingInfo(s.contactZ ?? p0.z);           // 以「滑過球的那一刻」的位置判斷時機
  // 沒有隨機：球打得進不進，完全看「時機」和「滑過球的位置（甜蜜點）」
  const contact = { ox: s.contactOx ?? 0, oy: s.contactOy ?? 0 };
  const mods = curMods(); // 角色數值、被動、球拍、球、技能合起來的修正
  const shot = buildPlayerShot({ swipe: s, p0, hand, timingOff: tInfo.off, contact, mods });
  if (online.role === 'guest') { guestHit(s, p0, hand, tInfo, contact, mods); return; }
  const fin = finalizeShot(p0, shot);
  launch({ vel: fin.vel, spin: shot.spin, kickMul: shot.kickMul, hidden: shot.hidden }, 'player');
  consumeSkillOnShot();
  addGauge(shot.perfect ? 0.25 : 0.1);
  pendingAiMiss += base.aiMiss ?? 0;
  lastShotWasSmash = shot.smash;
  swingActor(player, new THREE.Vector3(p0.x, p0.y, p0.z), dirX, 0.3, hand === 'BH');
  if (shot.smash) { sfx.smash(); shake = TUNE.smashShake; hitStop = 0.06; slowT = TUNE.smashSlow; fovKick = TUNE.smashFov; }
  else { sfx.hit(1 + Math.min(perfectChain, 6) * 0.06); if (shot.perfect) fovKick = -3; }
  if (Math.abs(shot.spin.side) >= 0.5) camRollTarget = -shot.spin.side * TUNE.camRoll;
  // 連續完美擊球：連擊數 + 震動回饋（手機）
  perfectChain = shot.perfect ? perfectChain + 1 : 0;
  buzz(shot.smash ? [18, 30, 18] : shot.perfect ? 16 : 8);
  // 畫面不要太吵：只在殺球或連續完美時才跳大字，其他球種看上方的小資訊就好
  if (shot.smash || perfectChain >= 2) pop(perfectChain >= 2 ? `完美 ×${perfectChain}` : shot.label, shot.smash ? '#ff8a4c' : '#7dff9a');
  showShotInfo(shot, describeFlight(p0, fin.vel, shot.spin), tInfo, contact);
}

function aiServe() {
  const p0 = { ...ball.pos };
  const kind = ['drive', 'spin', 'loop', 'chop', 'drop'][Math.floor(Math.random() * 5)];
  const shot = buildAiShot(kind, aiSkill(), Math.random, aiMods());
  shot.target.z = clamp(shot.target.z, 0.4, 1.15); // 發球要落在你這邊的前半桌
  const sv = solveServe(p0, shot.target, shot.spin);
  launch({ vel: sv.vel, spin: shot.spin }, 'ai', true);
  if (sv.result === 'ok') setLanding(shot.target.x, shot.target.z);
  state = 'rally';
  swingActor(ai, new THREE.Vector3(p0.x, p0.y, p0.z), 0);
  sfx.hit();
  announceShot(shot);
}

function aiReturn() {
  const p0 = { ...ball.pos };
  let missP = diff.miss;
  if (lastShotWasSmash) missP += 0.3;
  missP += Math.abs(ball.spin.side) * 0.2 + Math.max(0, -ball.spin.top) * 0.06;
  // 球太遠也接不到
  if (Math.abs(ball.pos.x - ai.x) > 0.5 * diff.react + 0.35) missP += 0.4;
  missP += (1 - aiBase.reach) * 0.3 + pendingAiMiss; // 角色的範圍數值、技能（煙霧彈等）
  pendingAiMiss = 0;
  if (Math.random() < missP) {
    swingActor(ai, new THREE.Vector3(p0.x + rnd(-0.5, 0.5), p0.y, p0.z - 0.1), 0.5, 0.35);
    return;
  }
  const kind = pickAiKind({ hitY: p0.y, rally, aggressive: diff.aggr });
  const shot = buildAiShot(kind, aiSkill(), Math.random, aiMods());
  const fin = finalizeShot(p0, shot);
  launch({ vel: fin.vel, spin: shot.spin }, 'ai');
  const aiFlight = describeFlight(p0, fin.vel, shot.spin);
  if (aiFlight.landing) setLanding(aiFlight.landing.x, aiFlight.landing.z); // 會失誤的球不顯示落點標記
  lastShotWasSmash = kind === 'smash';
  swingActor(ai, new THREE.Vector3(p0.x, p0.y, p0.z), clamp(shot.target.x, -1, 1));
  if (lastShotWasSmash) { sfx.smash(); shake = 0.12; } else sfx.hit();
  announceShot(shot);
}

function announceShot(shot) {
  const info = spinInfo(shot.spin);
  if (Math.abs(shot.spin.side) >= 0.5) camRollTarget = -shot.spin.side * TUNE.camRoll;
  let tip = '';
  if (Math.abs(shot.spin.side) >= 0.3) tip = `（彈起後會往${shot.spin.side > 0 ? '右' : '左'}偏）`;
  else if (shot.spin.top <= -0.3) tip = '（彈起後會變慢、變短）';
  else if (shot.spin.top >= 0.45) tip = '（彈起後會變快）';
  else if (!info) tip = '';
  setHint(`對手${shot.label}！${tip}`);
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
      award(other(lastHitter));
      return;
    }
  }

  // 球桌彈跳
  if (ball.vel.y < 0 && ball.pos.y <= TABLE.top + BALL_R && ball.pos.y > TABLE.top - 0.12
    && Math.abs(ball.pos.x) <= TABLE.halfW + BALL_R && Math.abs(ball.pos.z) <= TABLE.halfL + BALL_R) {
    bounceOnTable(ball);
    sfx.bounce();
    spawnRipple(ball.pos.x, ball.pos.z, 0xffffff, 0.8);
    recEvents.push({ t: clockT, x: ball.pos.x, z: ball.pos.z });
    const side = ball.pos.z > 0 ? 'player' : 'ai';
    if (serveStage === 1) {
      // 發球規則：第一次一定要落在自己半桌；直接飛到對方半桌算違例
      if (side === lastHitter) { serveStage = 2; return; }
      award(other(lastHitter));
      return;
    }
    if (serveStage === 2) {
      if (side === lastHitter) { award(other(lastHitter)); return; } // 在自己半桌彈了兩次
      serveStage = 0;
    }
    if (side === lastHitter) {
      award(other(lastHitter)); // 對打時先落在自己半桌 = 沒過網
      return;
    }
    bounce[side]++;
    if (side === 'player' && lastHitter === 'ai' && timedActive() && myChar.skill.id === 'mochiShield') { ball.vel.y *= 1.12; ball.vel.z *= 0.82; ball.vel.x *= 0.9; } // 麻糬護體：落桌後又高又慢
    if (mode === 'drill' && side === 'ai' && lastHitter === 'player') {
      award('player');
      return;
    }
    if (bounce[side] >= 2) {
      award(lastHitter);
      return;
    }
  }

  // 對手回擊
  if (mode === 'match' && !online.role && lastHitter === 'player' && bounce.ai >= 1 && ball.vel.z < 0 && ball.pos.z <= -1.2 && !aiTried && ball.pos.y > 0.4) {
    aiTried = true;
    aiReturn();
  }

  // 落地 / 出界
  if ((ball.pos.y <= BALL_R + 0.005 && ball.vel.y < 0) || Math.abs(ball.pos.x) > 6 || Math.abs(ball.pos.z) > 7) {
    const recv = other(lastHitter);
    const good = bounce[recv] >= 1;
    if (good) award(lastHitter);
    else award(other(lastHitter)); // 沒落在對方半桌（出界）
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
// 每個取樣點記下「當下球在螢幕上的位置」，之後判斷滑動有沒有經過球
function mkSample(e) {
  const p = { x: e.clientX, y: e.clientY, t: performance.now(), ok: false, bx: 0, by: 0, bz: 0 };
  if (canHitNow()) { const b = ballScreen(); p.ok = true; p.bx = b.x; p.by = b.y; p.bz = ball.pos.z; }
  return p;
}
// 點到線段的最近點（回傳距離與最近點座標）
function segClosest(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  const cx = ax + t * dx, cy = ay + t * dy;
  return { d: Math.hypot(px - cx, py - cy), cx, cy, t };
}
// 手指軌跡特效：讓玩家看到自己「劃」出的線（弧線＝旋球）
const fx = $('swipeFx');
const fxCtx = fx.getContext('2d');
let fxTimer = 0;
function drawSwipe(list) {
  fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if (list.length < 2) return;
  const s = analyzeSwipe(list);
  const col = Math.abs(s.curve) > 0.09 ? (s.curve < 0 ? '#4cc9f0' : '#ff4fd8') : '#ffe27a';
  fxCtx.lineCap = 'round'; fxCtx.lineJoin = 'round';
  fxCtx.strokeStyle = col; fxCtx.shadowColor = col; fxCtx.shadowBlur = 16;
  fxCtx.lineWidth = 9;
  fxCtx.beginPath();
  list.forEach((p, i) => (i ? fxCtx.lineTo(p.x, p.y) : fxCtx.moveTo(p.x, p.y)));
  fxCtx.stroke();
}
function fadeSwipe() {
  fx.style.transition = 'opacity .3s';
  fx.style.opacity = '0';
  clearTimeout(fxTimer);
  fxTimer = setTimeout(() => fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight), 320);
}
cv.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (state === 'point' && replay) { replay = null; pointTimer = Math.min(pointTimer, 0.15); return; } // 點一下跳過回放
  pts = [mkSample(e)];
  cv.setPointerCapture?.(e.pointerId);
  clearTimeout(fxTimer);
  fx.style.transition = 'none';
  fx.style.opacity = '1';
  fxCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
});
cv.addEventListener('pointermove', (e) => {
  if (!pts) return;
  const sm = mkSample(e);
  pts.push(sm);
  drawSwipe(pts);
  if (sm.ok && Math.hypot(sm.x - sm.bx, sm.y - sm.by) <= hitR()) $('hitRing').classList.add('touch');
});
function endSwipe(e) {
  if (!pts) return;
  pts.push(mkSample(e));
  const s = analyzeSwipe(pts);
  // 滑動路徑離球最近的距離（用每個取樣當下球的位置，路徑以線段計算）
  s.anyWin = false;
  s.contact = 1e9;
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens[i] = lens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const total = lens[lens.length - 1] || 1;
  pts.forEach((p, i) => {
    if (!p.ok) return;
    s.anyWin = true;
    const q = i > 0 ? pts[i - 1] : p;
    const c = segClosest(p.bx, p.by, q.x, q.y, p.x, p.y);
    if (c.d < s.contact) {
      s.contact = c.d;
      s.contactZ = p.bz;                       // 最貼近球的那一刻 = 擊球時機
      // 擊球點有兩個方向：
      //  ox：滑動路徑從球的左(−)／右(+)邊擦過（以擊球圈半徑為單位）
      //  oy：球落在這一劃的哪一段。起手段(−)＝還沒加速、力量不足；收尾段(+)＝揮過頭、球飛太遠；中段最準
      const along = (lens[i - 1 >= 0 ? i - 1 : 0] + c.t * Math.hypot(p.x - q.x, p.y - q.y)) / total;
      s.contactOx = (c.cx - p.bx) / hitR();
      s.contactOy = clamp((along - 0.5) * 2.4, -1.2, 1.2) + 0.6 * (c.cy - p.by) / hitR();
      s.tapOx = (c.cx - p.bx) / hitR();
      s.tapOy = 0.6 * (c.cy - p.by) / hitR();
    }
  });
  pts = null;
  $('hitRing').classList.remove('touch');
  fadeSwipe();
  if (state === 'menu' || state === 'over' || state === 'editor' || state === 'loadout') return;
  if (s.len < 28) {
    // 點一下球 = 平擊（發球時 = 一般發球）。要點在擊球圈內；點得越靠近球心越準
    if (!s.anyWin || s.contact > hitR()) return;
    if (state === 'serve' && server === 'player') { tossBall(); return; } // 發球：先點一下把球拋起來
    Object.assign(s, { dx: s.tapOx * 70, dy: -120, len: 120, dur: 220, speed: 0.85, curve: 0, contactOx: s.tapOx, contactOy: s.tapOy, tap: true });
  }
  playerSwipe(s);
}
cv.addEventListener('pointerup', endSwipe);
cv.addEventListener('pointercancel', () => { pts = null; fadeSwipe(); });

// ───────────────────────── 選單 ─────────────────────────
// 目前以遊客身分進入（之後連線對戰、背包存檔都用這個 id）
const profile = getProfile();
{
  const el = $('profile');
  const tag = document.createElement('small');
  tag.textContent = providerLabel(profile);
  el.append(tag, document.createTextNode(profile.name));
}

function showScreen(id) { // id 為 null 時全部隱藏
  for (const x of ['menu', 'practice', 'over', 'online']) $(x).classList.toggle('hidden', x !== id);
}
$('camLabel').textContent = CAM_LEVELS[camLevel].label;
$('camBtn').addEventListener('click', () => {
  camLevel = CAM_ORDER[(CAM_ORDER.indexOf(camLevel) + 1) % CAM_ORDER.length];
  CAM_BASE.set(0, CAM_LEVELS[camLevel].y, CAM_LEVELS[camLevel].z);
  $('camLabel').textContent = CAM_LEVELS[camLevel].label;
  savePref('cam2', camLevel);
});
function setHud(on) {
  $('hud').classList.toggle('hidden', !on);
  $('quitBtn').classList.toggle('hidden', !on);
  $('skillBtn').classList.toggle('hidden', !on);
  $('camBtn').classList.toggle('hidden', !on);
  document.querySelector('.score.match').classList.toggle('hidden', mode !== 'match');
  $('drillHud').classList.toggle('hidden', mode !== 'drill');
}

const savedDiff = DIFFS[loadPref('diff', 'normal')] ? loadPref('diff', 'normal') : 'normal';
diff = DIFFS[savedDiff];
document.querySelectorAll('#diff button').forEach((b) => {
  b.classList.toggle('on', b.dataset.d === savedDiff);
  b.addEventListener('click', () => {
    document.querySelectorAll('#diff button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    diff = DIFFS[b.dataset.d];
    savePref('diff', b.dataset.d);
  });
});

function startGame(m) {
  unlockAudio();
  mode = m;
  skill.gauge = 0; skill.until = 0; skill.armed = false; pendingAiMiss = 0;
  if (online.role === 'host' && online.opp) setupOpponent(online.opp); else pickAiCharacter();
  applyPhysicsFx();
  updateSkillUI();
  score = { player: 0, ai: 0 };
  streak = 0;
  firstServer = Math.random() < 0.5 ? 'player' : 'ai';
  showScreen(null);
  setHud(true);
  startPoint();
}
function toMenu() {
  replay = null;
  if (online.role) leaveOnline();
  state = 'menu';
  ball.vel = { x: 0, y: 0, z: 0 };
  ball.pos = { x: 0, y: 1.05, z: PLAYER_Z - 0.35 };
  setHint('');
  $('pop').classList.remove('show');
  setHud(false);
  showScreen('menu');
}
$('practiceBtn').addEventListener('click', () => { unlockAudio(); showScreen('practice'); });
$('practiceBack').addEventListener('click', () => showScreen('menu'));
$('matchBtn').addEventListener('click', () => openLoadout('match'));
$('drillBtn').addEventListener('click', () => openLoadout('drill'));
$('againBtn').addEventListener('click', () => {
  if (online.role === 'host') { online.myReady = true; online.oppReady = true; hostTryStart(); return; }
  if (online.role === 'guest') { netSend({ t: 'again' }); toast('已通知房主再來一局'); return; }
  startGame(mode);
});
$('quitBtn').addEventListener('click', toMenu);

// 場地選擇：底部面板，上方仍看得到球桌與場景
const arenaBox = $('arenaSheet');
function renderArenas() {
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  arenaBox.replaceChildren();
  const sheet = mk('div', 'sheet');
  sheet.append(mk('h3', null, '選擇場地'));
  for (const [id, a] of Object.entries(ARENAS)) {
    const b = mk('button', 'arena' + (id === currentArena ? ' on' : ''));
    b.type = 'button';
    const sw = mk('span', 'sw4');
    a.swatch.forEach((c) => { const i = mk('i'); i.style.background = c; sw.append(i); });
    const t = mk('span', 'at');
    t.append(mk('b', null, a.name), mk('small', null, a.desc));
    b.append(sw, t);
    b.addEventListener('click', () => {
      applyArena(id);
      applyPhysicsFx();
      savePref('arena2', id);
      $('arenaName').textContent = a.name;
      renderArenas();
    });
    sheet.append(b);
  }
  const bar = mk('div', 'bar');
  const done = mk('button', 'btn small', '完成');
  done.addEventListener('click', () => { arenaBox.classList.add('hidden'); showScreen('menu'); });
  bar.append(done);
  sheet.append(bar);
  arenaBox.append(sheet);
}
$('arenaName').textContent = ARENAS[currentArena].name;
$('arenaBtn').addEventListener('click', () => {
  showScreen(null);
  renderArenas();
  arenaBox.classList.remove('hidden');
});

// 出賽準備：鏡頭轉到玩家正面（跟改造型一樣），下半部是選角色／球拍／球的面板
let pendingMode = 'match';
function previewOn() {
  state = 'loadout';
  showScreen(null);
  setHud(false);
  setHint('');
  player.x = 0;
  player.group.rotation.y = 0;
  setPlayerGhost(player, false);
  ballMesh.visible = shadow.visible = false;
  trail.forEach((t) => { t.material.opacity = 0; });
}
function previewOff() {
  player.group.rotation.y = Math.PI;
  setPlayerGhost(player, true);
  ballMesh.visible = shadow.visible = true;
}
const cycleId = (list, id, dir) => list[(list.findIndex((x) => x.id === id) + dir + list.length) % list.length].id;
function renderLoadout() {
  const ch = charById(loadout.char), rk = racketById(loadout.racket), bl = ballById(loadout.ball);
  $('charName').textContent = ch.name;
  $('charRole').textContent = ch.role;
  const st = finalStats(ch, rk);
  const box = $('charStats');
  box.replaceChildren();
  for (const k of STAT_KEYS) {
    const row = document.createElement('div');
    row.className = 'srow';
    const n = document.createElement('span'); n.textContent = STAT_NAME[k];
    const bar = document.createElement('div'); bar.className = 'sbar';
    const fill = document.createElement('i'); fill.style.width = `${Math.min(100, st[k] * 10)}%`;
    if (st[k] !== ch.stats[k]) fill.className = st[k] > ch.stats[k] ? 'up' : 'down'; // 球拍加減後的差異
    bar.append(fill);
    const v = document.createElement('b'); v.textContent = String(st[k]);
    row.append(n, bar, v);
    box.append(row);
  }
  $('charPassive').textContent = `被動｜${ch.passive.name}：${ch.passive.desc}`;
  $('charSkill').textContent = `技能｜${ch.skill.name}：${ch.skill.desc}`;
  $('racketBtn').textContent = rk.name;
  $('ballBtn').textContent = bl.name;
  $('gearDesc').textContent = `${rk.desc}　／　${bl.desc}`;
  const fxd = ARENA_FX[currentArena]?.desc;
  $('arenaFx').textContent = fxd ? `場地效果｜${fxd}` : '';
}
function openLoadout(m) {
  unlockAudio();
  pendingMode = m;
  previewOn();
  renderLoadout();
  $('loadout').classList.remove('hidden');
}
function closeLoadout() {
  $('loadout').classList.add('hidden');
  previewOff();
}
  $('goBtn').disabled = false;
  $('goBtn').textContent = online.role ? '準備' : '開始';
function pickLoadout(key, list, dir) {
  loadout[key] = cycleId(list, loadout[key], dir);
  savePref(key, loadout[key]);
  applyLoadout();
  renderLoadout();
}
$('charPrev').addEventListener('click', () => pickLoadout('char', CHARACTERS, -1));
// 連線畫面
$('onlineBtn').addEventListener('click', openOnline);
$('hostBtn').addEventListener('click', startHost);
$('joinBtn').addEventListener('click', () => { setOnlineScreen('onlineJoin'); $('joinStatus').textContent = ''; $('codeInput').value = ''; $('codeInput').focus(); });
$('joinGo').addEventListener('click', () => startJoin($('codeInput').value.trim()));
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') startJoin($('codeInput').value.trim()); });
$('codeInput').addEventListener('input', () => { $('codeInput').value = $('codeInput').value.replace(/\D/g, '').slice(0, 4); });
$('onlineBack').addEventListener('click', () => {
  if ($('onlineHome').classList.contains('hidden')) { resetOnline(); setOnlineScreen('onlineHome'); return; } // 在建立／加入頁：回到選擇頁
  showScreen('menu');
});
$('charNext').addEventListener('click', () => pickLoadout('char', CHARACTERS, 1));
$('racketBtn').addEventListener('click', () => pickLoadout('racket', RACKETS, 1));
$('ballBtn').addEventListener('click', () => pickLoadout('ball', BALLS, 1));
$('goBtn').addEventListener('click', () => {
  if (pendingMode === 'online') { onlineReady(); return; } // 連線：按下「準備」，等雙方都準備好才開始
  closeLoadout();
  startGame(pendingMode);
});
$('loadoutBack').addEventListener('click', () => {
  if (pendingMode === 'online') { closeLoadout(); leaveOnline(); return; }
  closeLoadout();
  state = 'menu';
  showScreen('practice');
});
$('skillBtn').addEventListener('click', activateSkill);

// 角色編輯：鏡頭轉到玩家正面，下半部顯示編輯面板
const editor = createEditor($('editor'), {
  getConfig: () => ({ ...playerCfg }),
  onChange: (cfg) => { playerCfg = { ...cfg }; rebuildPlayer(playerCfg); },
  onClose: (cfg) => {
    playerCfg = { ...cfg };
    saveConfig(playerCfg, myChar.id);
    state = 'menu';
    editor.close();
    player.group.rotation.y = Math.PI;
    setPlayerGhost(player, true);
    ballMesh.visible = shadow.visible = true;
    showScreen('menu');
  },
});
$('editBtn').addEventListener('click', () => {
  unlockAudio();
  state = 'editor';
  showScreen(null);
  setHud(false);
  setHint('');
  player.x = 0;
  player.group.rotation.y = 0;
  setPlayerGhost(player, false);
  ballMesh.visible = shadow.visible = false;
  trail.forEach((t) => { t.material.opacity = 0; });
  editor.open();
});
// ───────────────────────── 主迴圈 ─────────────────────────
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // 直向螢幕拉高視角，確保桌子兩端都在畫面內
  baseFov = w / h < 0.8 ? 66 : 52;
  camera.fov = baseFov;
  camera.updateProjectionMatrix();
  const dpr = Math.min(window.devicePixelRatio, 2);
  fx.width = w * dpr; fx.height = h * dpr;
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let time = 0;
function frame(now) {
  const rawDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (hitStop > 0) hitStop -= rawDt;
  slowT = Math.max(0, slowT - rawDt);
  timeScale = lerp(timeScale, slowT > 0 ? TUNE.slowScale : 1, 1 - Math.exp(-14 * rawDt));
  const dt = hitStop > 0 ? 0 : rawDt * timeScale;
  time += dt;
  clockT += dt;

  const sub = 4;
  for (let i = 0; i < sub; i++) {
    const h = dt / sub;
    if (online.role === 'guest') guestStep(h);
    else if (state === 'rally') stepRally(h);
    else if (state === 'toss') stepToss(h);
    else if ((state === 'point' || state === 'over') && !replay) stepAfterPoint(h);
  }
  if (state === 'rally') rec.push({ t: clockT, x: ball.pos.x, y: ball.pos.y, z: ball.pos.z, top: ball.spin.top, side: ball.spin.side });
  if (rec.length > 600) rec.splice(0, rec.length - 600);
  if (replay) stepReplay(rawDt);
  updateRipples(rawDt);
  landingMark.visible = landingOn && state === 'rally' && bounce[other(lastHitter)] === 0;
  if (landingMark.visible) landingMark.scale.setScalar(1 + Math.sin(time * 10) * 0.12);
  $('replayTag').style.display = replay ? 'block' : 'none';
  if (state === 'serve' && online.role !== 'guest') {
    if (server === 'player') ball.pos.x = player.x;
    else { ball.pos.x = ai.x; if (!online.role) { serveTimer -= dt; if (serveTimer <= 0) aiServe(); } }
  }
  if (online.role) onlineFrame(rawDt);
  if (state === 'point' && online.role !== 'guest') {
    pointTimer -= dt;
    if (pointTimer <= 0) startPoint();
  }

  // 玩家左右跟著來球移動；對手預判落點
  let ptx = 0;
  // 身體只跟著球移動六成，所以球在左側時會用反手、在右側時用正手
  if (state === 'rally' && lastHitter === 'ai') ptx = 0.6 * clamp(ball.pos.x + ball.vel.x * 0.3, -1.4, 1.4);
  player.x = lerp(player.x, ptx, 1 - Math.exp(-5 * dt));
  let atx = 0;
  if (state === 'rally' && lastHitter === 'player') atx = clamp(ball.pos.x + ball.vel.x * 0.3, -1.2, 1.2) * diff.react;
  if (online.role) ai.x = lerp(ai.x, online.remoteX, 1 - Math.exp(-12 * rawDt)); // 連線：對手的位置由對方回報
  else ai.x = lerp(ai.x, atx, 1 - Math.exp(-6 * dt * diff.react));
  updateActor(player, dt, time);
  updateActor(ai, dt, time);

  // 球與影子、殘影
  ballMesh.position.set(ball.pos.x, ball.pos.y, ball.pos.z);
  // 隱形球：過網後到落桌前看不見；幽靈球：忽隱忽現
  const hiddenNow = ball.hidden && state === 'rally' && lastHitter === 'player' && ball.pos.z < 0.1 && bounce.ai === 0;
  if (state !== 'editor' && state !== 'loadout') { ballMesh.visible = !hiddenNow; shadow.visible = !hiddenNow; }
  ballMesh.material.opacity = myBall.blink ? 0.55 + 0.4 * Math.sin(time * 9) : 1;
  ballMesh.material.transparent = !!myBall.blink;
  const aw = ARENA_FX[currentArena]?.wind || 0;
  if (online.role !== 'guest') TUNE.windX = state === 'rally' ? aw * Math.sin(clockT * 0.5) : 0; // 訪客的風來自房主的快照
  const wt = $('windTag');
  if (aw && (state === 'rally' || state === 'serve' || state === 'toss' || state === 'point')) { wt.style.display = 'block'; wt.textContent = Math.abs(TUNE.windX) < 0.12 ? '風：微' : TUNE.windX > 0 ? '風 →' : '風 ←'; } else wt.style.display = 'none';
  updateSkillUI();
  const overTable = Math.abs(ball.pos.x) <= TABLE.halfW && Math.abs(ball.pos.z) <= TABLE.halfL && ball.pos.y > TABLE.top - 0.05;
  const baseY = overTable ? TABLE.top + 0.003 : 0.012;
  const hgt = Math.max(0, ball.pos.y - baseY);
  shadow.position.set(ball.pos.x, baseY, ball.pos.z);
  shadow.scale.setScalar(clamp(1.3 - hgt * 0.5, 0.35, 1.3));
  shadow.material.opacity = clamp(0.5 - hgt * 0.15, 0.12, 0.5);
  const speed = Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z);
  const sInfo = spinInfo(ball.spin);
  for (let i = trail.length - 1; i > 0; i--) {
    trail[i].position.copy(trail[i - 1].position);
    trail[i].material.opacity = trail[i - 1].material.opacity * 0.86;
    trail[i].scale.setScalar(trail[i - 1].scale.x * 0.95);
    trail[i].material.color.copy(trail[i - 1].material.color);
  }
  trail[0].position.copy(ballMesh.position);
  trail[0].material.color.set(sInfo ? sInfo.css : '#ffc766');
  trail[0].material.opacity = state === 'rally' ? clamp((speed - 2) / 8, 0, sInfo ? 0.55 : 0.35) : 0;
  trail[0].scale.setScalar(1.0);
  // 球本體旋轉（條紋轉動）：上下旋繞 x 軸、側旋繞 y 軸
  if (state === 'rally' || state === 'point') {
    const dirZ = Math.sign(ball.vel.z) || 1;
    ballMesh.rotateOnWorldAxis(_axisX, ball.spin.top * 40 * dirZ * dt + 6 * dirZ * dt);
    ballMesh.rotateOnWorldAxis(_axisY, -ball.spin.side * 40 * dt);
  }
  if (state === 'rally') growPath();
  else if (state === 'point' && !replay) pathMesh.material.opacity = Math.max(0, pathMesh.material.opacity - dt * 0.9);
  else pathMesh.count = 0;
  updateSpinTag();
  updateHitRing();

  // 鏡頭導演：來球時壓低靠近、殺球震動與變焦、旋球傾斜、得分時推近
  shake = Math.max(0, shake - rawDt);
  fovKick = lerp(fovKick, 0, 1 - Math.exp(-5 * rawDt));
  camRollTarget = lerp(camRollTarget, 0, 1 - Math.exp(-2.2 * rawDt));
  camRoll = lerp(camRoll, camRollTarget, 1 - Math.exp(-9 * rawDt));
  if (state === 'editor' || state === 'loadout') {
    // 對準玩家正面；角色放在畫面上半部，下半部留給編輯面板
    camera.position.set(Math.sin(time * 0.6) * 0.25, 1.3, PLAYER_Z + 4.0);
    camera.lookAt(0, -0.1, PLAYER_Z);
    camera.fov = baseFov;
  } else {
    const incoming = state === 'rally' && lastHitter === 'ai' && ball.vel.z > 0;
    camApproach = lerp(camApproach, incoming ? clamp(ball.pos.z / 2.6, 0, 1) : 0, 1 - Math.exp(-6 * rawDt));
    pointDolly = lerp(pointDolly, (state === 'point' || state === 'over') && !replay ? 1 : 0, 1 - Math.exp(-3 * rawDt));
    const sx = (Math.random() - 0.5) * shake * 0.14, sy = (Math.random() - 0.5) * shake * 0.14;
    const camPos = new THREE.Vector3(
      CAM_BASE.x + clamp(ball.pos.x, -1.6, 1.6) * 0.32 + sx,
      CAM_BASE.y - 0.5 * camApproach - 0.5 * TUNE.pointDolly * pointDolly + sy,
      CAM_BASE.z - 0.6 * camApproach - 0.9 * TUNE.pointDolly * pointDolly,
    );
    const ly = 0.4 + clamp(ball.pos.y - 0.8, 0, 1) * 0.25;
    const look = new THREE.Vector3(
      lerp(ball.pos.x * 0.3, ball.pos.x * 0.7, pointDolly),
      lerp(ly, ball.pos.y * 0.6, pointDolly),
      lerp(-0.3 + camApproach * 0.8, ball.pos.z * 0.5, pointDolly),
    );
    let fov = baseFov + fovKick - 4 * camApproach - 5 * pointDolly;
    // 回放：鏡頭放大貼近球並緩慢環繞
    replayBlend = lerp(replayBlend, replay ? 1 : 0, 1 - Math.exp(-4.5 * rawDt));
    const e = replayBlend * replayBlend * (3 - 2 * replayBlend);
    if (e > 0.001) {
      const ang = 0.55 + Math.sin(clockT * 0.9) * 0.35;
      const close = new THREE.Vector3(replayFocus.x + Math.sin(ang) * 2.2, 2.6, replayFocus.z + Math.cos(ang) * 3.9);
      camPos.lerp(close, e);
      look.lerp(new THREE.Vector3(lerp(replayFocus.x, ball.pos.x, 0.45), lerp(replayFocus.y, ball.pos.y, 0.5), lerp(replayFocus.z, ball.pos.z, 0.45)), e);
      fov = lerp(fov, 50, e);
    }
    // 跟球：先用一般鏡頭算出球在畫面上的位置，快要跑出畫面（太高、太遠、太偏）時，視線轉向球並稍微拉遠
    camera.position.copy(camPos);
    camera.lookAt(look);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    _bs.copy(ballMesh.position).project(camera);
    const over = Math.max(Math.abs(_bs.x) - 0.6, _bs.y - 0.5, -_bs.y - 0.8, 0); // 超出安全範圍多少（螢幕座標 -1~1）
    const wantFollow = !replay && (state === 'rally' || state === 'point') && _bs.z < 1 ? clamp(over / 0.35, 0, 1) * TUNE.camFollow : 0;
    camFollowW = lerp(camFollowW, wantFollow, 1 - Math.exp(-(wantFollow > camFollowW ? 10 : 2.5) * rawDt));
    if (camFollowW > 0.001) {
      look.lerp(ballMesh.position, 0.85 * camFollowW);
      camPos.y += 0.7 * camFollowW;
      camPos.z += 0.9 * camFollowW;
      fov += 8 * camFollowW;
    }
    camera.position.copy(camPos);
    camera.lookAt(look);
    camera.rotateZ(camRoll * (1 - e));
    camera.fov = fov;
  }
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
applyLoadout();
requestAnimationFrame(frame);

// 提供除錯用的小接口（瀏覽器 console 可用 __game 檢視狀態）
window.__game = { online, startHost, startJoin, profile, loadout, skill, TUNE, get camFollow() { return camFollowW; }, get fxNow() { return curMods(); }, get aiChar() { return aiChar; }, activateSkill,  get state() { return state; }, get server() { return server; }, get lastHitter() { return lastHitter; }, get bounce() { return bounce; }, get rally() { return rally; }, get mode() { return mode; }, get serveStage() { return serveStage; }, get streak() { return streak; }, get arena() { return currentArena; }, ballScreen, hitR, ball, score: () => ({ ...score }), player, ai, startPoint, startGame };
void NET_TOP;
