import * as THREE from 'three';
import { buildCharacter, randomConfig, stretchArm, DEFAULT_CONFIG } from './character.js';
import { TABLE, BALL_R, NET_TOP, makeBall, stepBall, bounceOnTable } from './physics.js';
import { sfx, unlockAudio } from './audio.js';
import { createEditor } from './editor.js';
import { loadConfig, saveConfig, loadPref, savePref } from './storage.js';
import { ARENAS, DEFAULT_ARENA } from './arenas.js';
import { TUNE } from './tuning.js';
import { analyzeSwipe, handOf, timingInfo, buildPlayerShot, buildAiShot, pickAiKind, finalizeShot, describeFlight, solveServe } from './shots.js';

// ───────────────────────── 基本設定 ─────────────────────────
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);

const WIN_SCORE = 11;
const PLAYER_Z = 3.0;
const AI_Z = -2.6;
const DIFFS = {
  easy:   { miss: 0.28, err: 0.55, react: 0.7, hitR: 72, aggr: 0.3 },
  normal: { miss: 0.14, err: 0.35, react: 0.85, hitR: 58, aggr: 0.55 },
  hard:   { miss: 0.05, err: 0.18, react: 1.0, hitR: 46, aggr: 0.9 },
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
const CAM_BASE = new THREE.Vector3(0, 3.5, 5.6);
let baseFov = 66;
// 鏡頭導演：慢動作、頓幀、視角衝擊、傾斜、靠近來球
let timeScale = 1, slowT = 0, hitStop = 0, fovKick = 0, camRoll = 0, camRollTarget = 0, camApproach = 0, pointDolly = 0;
camera.position.copy(CAM_BASE);
camera.lookAt(0, 0.4, -0.3);

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
  new THREE.MeshToonMaterial({ color: 0x4a2f8f }),
);
court.rotation.x = -Math.PI / 2;
court.position.y = 0.004;
court.receiveShadow = true;
scene.add(court);
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

// 球桌
const tableMat = new THREE.MeshStandardMaterial({ color: 0x1f5fb8, roughness: 0.5 });
const tableTop = new THREE.Mesh(new THREE.BoxGeometry(TABLE.halfW * 2, 0.04, TABLE.halfL * 2), tableMat);
tableTop.position.y = TABLE.top - 0.02;
tableTop.castShadow = true;
tableTop.receiveShadow = true;
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
const hitR = () => diff.hitR * clamp(Math.min(window.innerWidth, window.innerHeight * 0.56) / 375, 0.85, 1.5);
const _bs = new THREE.Vector3();
function ballScreen() {
  _bs.copy(ballMesh.position).project(camera);
  return { x: (_bs.x * 0.5 + 0.5) * window.innerWidth, y: (-_bs.y * 0.5 + 0.5) * window.innerHeight };
}
function canHitNow() {
  return (state === 'serve' && server === 'player')
    || (state === 'rally' && lastHitter === 'ai' && bounce.player >= 1 && ball.vel.z > 0
      && ball.pos.z > 0.5 && ball.pos.z < 2.6 && ball.pos.y > 0.45);
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
  const tq = state === 'serve' ? 1 : clamp(1 - Math.abs(ball.pos.z - 1.4) / 1.1, 0, 1);
  el.classList.toggle('gold', tq > 0.8);
  el.dataset.hand = state === 'serve' ? '發球' : '';
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
  if (mode !== 'match' || rec.length < 8) return 0;
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
  ring.material.color.set(a.ring);
  beams.forEach((b, i) => b.material.color.set(a.beams[i % a.beams.length]));
  pillars.forEach((p, i) => {
    p.material.color.set(a.pillar);
    p.material.emissive.setHSL(a.hue[0] + (a.hue[1] - a.hue[0]) * (i / (pillars.length - 1)), a.sat, a.light);
  });
  stars.visible = a.stars;
}
applyArena(loadPref('arena', DEFAULT_ARENA));

// 球、影子、殘影
const ball = makeBall();
// 球上有條紋，旋轉才看得出來
const ballTex = (() => {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#fff6dc'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#ff7a1a';
  for (let i = 0; i < 4; i++) g.fillRect(i * 32 + 6, 0, 14, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
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
let playerCfg = loadConfig();
let player = makeActor(playerCfg, true);
const ai = makeActor(randomConfig(), false);

// 比賽時玩家的大頭會擋住視線，所以讓它半透明；編輯造型時要完全不透明
function setHeadGhost(c, ghost) {
  c.head.traverse((o) => {
    if (!o.material) return;
    o.material.transparent = ghost;
    o.material.opacity = ghost ? 0.35 : 1;
    o.material.depthWrite = !ghost;
    o.material.needsUpdate = true;
    if (o.userData.outline) o.visible = !ghost; // 半透明時不要黑色描邊
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
  player = makeActor(cfg, true);
  player.x = x;
  if (state === 'editor') player.group.rotation.y = 0;
  else setHeadGhost(player, true);
  window.__game && (window.__game.player = player);
}
setHeadGhost(player, true);

function swingActor(c, toPos, dirX = 0, dur = 0.3, bh = false) {
  c.swing = { t: 0, to: toPos.clone(), dirX, dur, bh };
}

const _v = new THREE.Vector3();
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
      c.head.scale.set(sq, 1 / sq, sq);
    }
  } else c.head.scale.set(1, 1, 1);

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
    setHint('向上滑動發球（往左或往右滑決定方向）');
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
  if (winner === 'player') { sfx.point(); pop(why || '得分！', '#7dff9a'); }
  else { sfx.lose(); pop(why || '失分…', '#ff7d7d'); }
  updateScoreUI();
  const a = score.player, b = score.ai;
  if ((a >= WIN_SCORE || b >= WIN_SCORE) && Math.abs(a - b) >= 2) {
    state = 'over';
    setTimeout(() => {
      if (state !== 'over') return;
      $('overTitle').textContent = a > b ? '你贏了！' : '你輸了…';
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
    pop(streak >= 3 ? `命中 ×${streak}！` : '命中！', '#7dff9a');
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
  lastHitter = hitter;
  bounce = { player: 0, ai: 0 };
  rally++;
  aiTried = false;
  resetPath();
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
function showShotInfo(shot, sim, tInfo) {
  const el = $('shotInfo');
  el.replaceChildren();
  const l1 = document.createElement('b');
  l1.textContent = shot.label;
  const l2 = document.createElement('span');
  const parts = [];
  if (tInfo) parts.push(`時機${tInfo.name}`);
  parts.push(`球速 ${Math.round(sim.speed * 3.6)} km/h`);
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

function playerServe(s) {
  if (-s.dy < 25) return;
  if (!s.anyWin || s.contact > hitR()) { sfx.whoosh(); pop('要從球上滑過去！', '#ffd23f'); return; }
  const p0 = { ...ball.pos };
  const shot = buildPlayerShot({ swipe: s, p0, hand: 'FH', isServe: true });
  // 發球：球先落在自己這半桌，彈起後過網，再落在對方半桌
  const sv = solveServe(p0, shot.target, shot.spin, shot.fault);
  launch({ vel: sv.vel, spin: shot.spin }, 'player', true);
  state = 'rally';
  swingActor(player, new THREE.Vector3(p0.x, p0.y, p0.z), clamp(s.dx / 120, -1, 1));
  sfx.hit();
  setHint('');
  showShotInfo(shot, { speed: Math.hypot(sv.vel.x, sv.vel.y, sv.vel.z), landing: sv.result === 'ok' && sv.landing ? { x: sv.landing.x, z: sv.landing.z, zone: zoneText(sv.landing) } : null }, null);
}

function playerSwipe(s) {
  if (state === 'serve' && server === 'player') { playerServe(s); return; }
  if (state !== 'rally') return;
  const dirX = clamp(s.dx / 120, -1, 1);
  const reach = lastHitter === 'ai' && bounce.player >= 1 && ball.vel.z > 0 && ball.pos.z > 0.5 && ball.pos.z < 3.0 && ball.pos.y > 0.4;
  if (s.anyWin && reach && s.contact > hitR()) {
    sfx.whoosh();
    swingActor(player, new THREE.Vector3(player.x + dirX * 0.3, 1.1, PLAYER_Z - 1.0), dirX);
    pop('沒滑到球！', '#ffd23f');
    return;
  }
  if (!(s.anyWin && reach)) {
    sfx.whoosh();
    swingActor(player, new THREE.Vector3(player.x + dirX * 0.3, 1.1, PLAYER_Z - 1.0), dirX);
    if (lastHitter === 'ai' && ball.vel.z > 0) {
      if (bounce.player === 0) pop('太早了！', '#ffd23f');
      else if (ball.pos.z >= 2.6) pop('太晚了！', '#ffd23f');
    }
    return;
  }
  const p0 = { ...ball.pos };
  const hand = handOf(p0.x, player.x);                    // 球在身體右側＝正手，左側＝反手
  const tInfo = timingInfo(s.contactZ ?? p0.z);           // 以「滑過球的那一刻」的位置判斷時機
  const acc = clamp(1 - s.contact / hitR(), 0, 1);        // 滑得準不準
  const shot = buildPlayerShot({ swipe: s, p0, hand, timingOff: tInfo.off, acc });
  const fin = finalizeShot(p0, shot); // 這球若注定失誤，速度會被弄壞（掛網／太長／太偏／沒過網）
  launch({ vel: fin.vel, spin: shot.spin }, 'player');
  lastShotWasSmash = shot.smash;
  swingActor(player, new THREE.Vector3(p0.x, p0.y, p0.z), dirX, 0.3, hand === 'BH');
  if (shot.smash) { sfx.smash(); shake = TUNE.smashShake; hitStop = 0.06; slowT = TUNE.smashSlow; fovKick = TUNE.smashFov; }
  else { sfx.hit(); if (shot.perfect) fovKick = -3; }
  if (Math.abs(shot.spin.side) >= 0.5) camRollTarget = -shot.spin.side * TUNE.camRoll;
  pop(shot.label, shot.smash ? '#ff6b3d' : shot.perfect ? '#7dff9a' : '#ffd23f');
  showShotInfo(shot, describeFlight(p0, fin.vel, shot.spin), tInfo);
}

function aiServe() {
  const p0 = { ...ball.pos };
  const kind = ['drive', 'spin', 'loop', 'chop', 'drop'][Math.floor(Math.random() * 5)];
  const shot = buildAiShot(kind, 0.2);
  shot.target.z = clamp(shot.target.z, 0.4, 1.15); // 發球要落在你這邊的前半桌
  const sv = solveServe(p0, shot.target, shot.spin, shot.fault);
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
  if (Math.random() < missP) {
    swingActor(ai, new THREE.Vector3(p0.x + rnd(-0.5, 0.5), p0.y, p0.z - 0.1), 0.5, 0.35);
    return;
  }
  const kind = pickAiKind({ hitY: p0.y, rally, aggressive: diff.aggr });
  const shot = buildAiShot(kind, diff.err);
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
  if (mode === 'match' && lastHitter === 'player' && bounce.ai >= 1 && ball.vel.z < 0 && ball.pos.z <= -1.2 && !aiTried && ball.pos.y > 0.4) {
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
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
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
  pts.forEach((p, i) => {
    if (!p.ok) return;
    s.anyWin = true;
    const q = i > 0 ? pts[i - 1] : p;
    const d = segDist(p.bx, p.by, q.x, q.y, p.x, p.y);
    if (d < s.contact) { s.contact = d; s.contactZ = p.bz; } // 最貼近球的那一刻 = 擊球時機
  });
  pts = null;
  $('hitRing').classList.remove('touch');
  fadeSwipe();
  if (s.len < 28) return; // 只認「滑動」，輕點不算
  if (state === 'menu' || state === 'over' || state === 'editor') return;
  playerSwipe(s);
}
cv.addEventListener('pointerup', endSwipe);
cv.addEventListener('pointercancel', () => { pts = null; fadeSwipe(); });

// ───────────────────────── 選單 ─────────────────────────
function showScreen(id) { // id 為 null 時全部隱藏
  for (const x of ['menu', 'practice', 'over']) $(x).classList.toggle('hidden', x !== id);
}
function setHud(on) {
  $('hud').classList.toggle('hidden', !on);
  $('quitBtn').classList.toggle('hidden', !on);
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
  score = { player: 0, ai: 0 };
  streak = 0;
  firstServer = Math.random() < 0.5 ? 'player' : 'ai';
  showScreen(null);
  setHud(true);
  startPoint();
}
function toMenu() {
  replay = null;
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
$('matchBtn').addEventListener('click', () => startGame('match'));
$('drillBtn').addEventListener('click', () => startGame('drill'));
$('againBtn').addEventListener('click', () => startGame(mode));
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
      savePref('arena', id);
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

// 角色編輯：鏡頭轉到玩家正面，下半部顯示編輯面板
const editor = createEditor($('editor'), {
  getConfig: () => ({ ...playerCfg }),
  onChange: (cfg) => { playerCfg = { ...cfg }; rebuildPlayer(playerCfg); },
  onClose: (cfg) => {
    playerCfg = { ...cfg };
    saveConfig(playerCfg);
    state = 'menu';
    editor.close();
    player.group.rotation.y = Math.PI;
    setHeadGhost(player, true);
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
  setHeadGhost(player, false);
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
    if (state === 'rally') stepRally(h);
    else if ((state === 'point' || state === 'over') && !replay) stepAfterPoint(h);
  }
  if (state === 'rally') rec.push({ t: clockT, x: ball.pos.x, y: ball.pos.y, z: ball.pos.z, top: ball.spin.top, side: ball.spin.side });
  if (rec.length > 600) rec.splice(0, rec.length - 600);
  if (replay) stepReplay(rawDt);
  updateRipples(rawDt);
  landingMark.visible = landingOn && state === 'rally' && bounce[other(lastHitter)] === 0;
  if (landingMark.visible) landingMark.scale.setScalar(1 + Math.sin(time * 10) * 0.12);
  $('replayTag').style.display = replay ? 'block' : 'none';
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
  // 身體只跟著球移動六成，所以球在左側時會用反手、在右側時用正手
  if (state === 'rally' && lastHitter === 'ai') ptx = 0.6 * clamp(ball.pos.x + ball.vel.x * 0.3, -1.4, 1.4);
  player.x = lerp(player.x, ptx, 1 - Math.exp(-5 * dt));
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
  if (state === 'editor') {
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
      lerp(CAM_BASE.y, 2.9, camApproach) - 0.7 * TUNE.pointDolly * pointDolly + sy,
      lerp(CAM_BASE.z, 4.8, camApproach) - 1.4 * TUNE.pointDolly * pointDolly,
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
    camera.position.copy(camPos);
    camera.lookAt(look);
    camera.rotateZ(camRoll * (1 - e));
    camera.fov = fov;
  }
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 提供除錯用的小接口（瀏覽器 console 可用 __game 檢視狀態）
window.__game = { get state() { return state; }, get server() { return server; }, get lastHitter() { return lastHitter; }, get bounce() { return bounce; }, get rally() { return rally; }, get mode() { return mode; }, get serveStage() { return serveStage; }, get streak() { return streak; }, get arena() { return currentArena; }, ballScreen, hitR, ball, score: () => ({ ...score }), player, ai, startPoint, startGame };
void NET_TOP;
