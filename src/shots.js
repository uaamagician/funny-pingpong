// 擊球模型：把「滑動 + 球的位置 + 時機」轉成一記球。純函式、不依賴畫面，
// 所以可以在 Node 裡做實驗（npm run lab），也能在遊戲裡直接用。
import { TABLE, BALL_R, NET_TOP, makeBall, stepBall, bounceOnTable, solveShot } from './physics.js';
import { TUNE } from './tuning.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const KIND_NAME = {
  serve: '發球', drive: '平擊', loop: '上旋拉球', spin: '旋球', chop: '切球',
  drop: '吊球', smash: '殺球', flick: '快撥', lift: '挑球', lob: '高吊',
};

/** 把滑動的取樣點整理成：位移、速度、彎曲程度。 */
export function analyzeSwipe(pts) {
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

/** 球在身體右側 = 正手；左側 = 反手。 */
export function handOf(ballX, bodyX) {
  return ballX - bodyX >= -0.06 ? 'FH' : 'BH';
}

/** 時機：球離網越接近 idealZ 越好；偏早／偏晚會影響方向、深度與力道。 */
export function timingInfo(z) {
  const off = z - TUNE.idealZ;
  const a = Math.abs(off);
  const name = a < 0.2 ? '完美' : a < 0.5 ? (off < 0 ? '偏早' : '偏晚') : (off < 0 ? '太早' : '太晚');
  return { off, q: clamp(1 - a / 0.9, 0, 1), name };
}

/**
 * 玩家的滑動 → 一記球。
 * - 一律帶旋轉：向前滑=上旋，向下滑=下旋，劃弧線=側旋；越快旋轉越強。
 * - 正手：力量大、旋轉強、能殺球；反手：較穩、力量小、改用快撥。
 * - 時機偏早 → 球偏左、變短；偏晚 → 球偏右、變深（容易出界）。
 */
export function buildPlayerShot({ swipe: s, p0, hand = 'FH', timingOff = 0, acc = 1, isServe = false, rand = Math.random }) {
  const FH = hand === 'FH';
  const fwd = -s.dy;
  const tq = clamp(1 - Math.abs(timingOff) / 0.9, 0, 1);
  const quality = isServe ? 1 : clamp(0.6 * tq + 0.4 * acc, 0, 1);
  const perfect = !isServe && Math.abs(timingOff) < 0.2 && acc > 0.6;

  let p = clamp((s.speed - 0.35) / 1.7, 0, 1);
  if (isServe) p = Math.min(p, 0.55);
  else p *= FH ? 1 : 0.85; // 反手力量較小

  // —— 決定球種 ——
  let kind;
  if (isServe) kind = 'serve';
  else if (fwd < -15) kind = 'chop';
  else if (p < 0.2) kind = 'drop';
  else if (p > 0.78) kind = FH ? (p0.y > 0.95 ? 'smash' : 'loop') : 'flick';
  else if (Math.abs(s.curve) > 0.07) kind = 'spin';
  else if (p > 0.42) kind = 'loop';
  else kind = 'drive';
  // 球太低就挑起來（不能殺、不能拉）
  if (!isServe && p0.y < 0.78 && ['smash', 'loop', 'flick', 'drive', 'spin'].includes(kind)) kind = 'lift';

  // —— 旋轉：每一次滑動都有旋轉，快 = 強 ——
  const spinMul = isServe ? 1 : (0.7 + 0.3 * tq) * (perfect ? 1.1 : 1);
  let top;
  switch (kind) {
    case 'chop': top = -(0.4 + 0.45 * clamp(-fwd / 140, 0, 1)) * (FH ? 1 : 1.1); break;
    case 'drop': top = -0.3; break;
    case 'smash': top = 0.15; break;
    case 'flick': top = 0.2; break;
    case 'loop': top = (0.35 + 0.4 * p) * (FH ? 1 : 0.8); break;
    case 'spin': top = 0.25; break;
    case 'lift': top = 0.3; break;
    case 'serve': top = 0.15 + 0.3 * p; break;
    default: top = 0.18 + 0.12 * p;
  }
  top *= spinMul;
  if (Math.abs(top) < 0.12) top = Math.sign(top || 1) * 0.12;
  let side = clamp(-s.curve * 4.5, -1, 1) * (0.35 + 0.65 * p) * (FH ? 1 : 0.75) * spinMul;
  if (kind !== 'spin' && kind !== 'serve') side *= 0.6;

  // —— 速度與落點 ——
  let T, tz;
  switch (kind) {
    case 'drive': T = 0.66 - 0.1 * p; tz = -(0.7 + 0.35 * p); break;
    case 'loop': T = 0.72 - 0.08 * p; tz = -(0.95 + 0.25 * p); break;
    case 'spin': T = 0.7; tz = -(0.75 + 0.3 * p); break;
    case 'chop': T = 0.92; tz = -(0.55 + 0.35 * rand()); break;
    case 'drop': T = 0.95; tz = -(0.35 + 0.2 * rand()); break;
    case 'smash': T = 0.34; tz = -1.2; break;
    case 'flick': T = 0.46; tz = -1.0; break;
    case 'lift': T = 0.88; tz = -1.0; break;
    default: T = 0.82 - 0.3 * p; tz = -(0.5 + 0.6 * p); // serve
  }
  // 往前滑：看滑動方向；往下切：看左右偏多少（直直往下就是打中間）
  let tx = fwd > 0 ? clamp(Math.atan2(s.dx, fwd) / 0.9, -1, 1) * 0.58 : clamp(s.dx / 150, -1, 1) * 0.5;

  if (!isServe) {
    tx += clamp(timingOff / 0.8, -1, 1) * 0.45;                // 偏晚→往右飄，偏早→往左飄
    tz += timingOff < 0 ? -timingOff * 0.45 : -timingOff * 0.6; // 偏早→變短，偏晚→變深（可能出界）
    T += (1 - tq) * 0.1;
    const err = (1 - quality) * 0.4 * (FH ? 1 : 0.8);           // 反手比較穩
    tx += (rand() - 0.5) * 2 * err;
  }
  tx = clamp(tx, -0.74, 0.74);
  tz = clamp(tz, -1.55, -0.3);

  const name = kind === 'spin' ? (side > 0 ? '右旋球' : '左旋球') : KIND_NAME[kind];
  const label = isServe ? '發球' : `${perfect ? '完美·' : ''}${FH ? '正手' : '反手'}${name}`;
  return {
    kind, hand, label, smash: kind === 'smash', perfect, quality, tq,
    target: { x: tx, y: TABLE.top + BALL_R, z: tz },
    T, spin: { top, side },
    // 時機太差時過網高度不足 → 可能掛網
    clearance: (kind === 'smash' ? 0.02 : 0.05) - 0.09 * (isServe ? 0 : 1 - tq),
  };
}

// ───────────────────────── AI 的球種 ─────────────────────────
const AI_KINDS = {
  drive: { name: '平擊', T: [0.6, 0.72], z: [0.6, 1.1], spin: () => ({ top: 0.2, side: 0 }) },
  loop: { name: '上旋拉球', T: [0.68, 0.78], z: [0.9, 1.3], spin: () => ({ top: 0.5, side: 0 }) },
  spin: { name: '旋球', T: [0.66, 0.76], z: [0.7, 1.15], spin: (r) => ({ top: 0.25, side: (0.35 + 0.35 * r()) * (r() < 0.5 ? -1 : 1) }) },
  chop: { name: '切球', T: [0.88, 0.98], z: [0.45, 0.8], spin: () => ({ top: -0.6, side: 0 }) },
  drop: { name: '吊球', T: [0.92, 1.0], z: [0.3, 0.5], spin: () => ({ top: -0.35, side: 0 }) },
  smash: { name: '殺球', T: [0.34, 0.4], z: [0.8, 1.2], spin: () => ({ top: 0.15, side: 0 }) },
  lob: { name: '高吊', T: [1.1, 1.2], z: [1.0, 1.3], spin: () => ({ top: 0.3, side: 0 }) },
};

/** AI 依情況挑球種：球高就殺、長回合更積極，平常混用各種球。 */
export function pickAiKind({ hitY = 0.9, rally = 0, aggressive = 0.5, rand = Math.random }) {
  const w = { drive: 0.22, loop: 0.22, spin: 0.2, chop: 0.14, drop: 0.08, smash: 0, lob: 0.04 };
  if (hitY > 0.95) w.smash = 0.25 + 0.4 * aggressive;
  if (rally >= 4) { w.loop += 0.1; w.smash += 0.05 * aggressive; }
  if (hitY < 0.8) { w.smash = 0; w.loop *= 0.4; w.lob += 0.1; w.chop += 0.1; }
  let sum = 0;
  for (const k in w) sum += w[k];
  let r = rand() * sum;
  for (const k in w) { r -= w[k]; if (r <= 0) return k; }
  return 'drive';
}

export function buildAiShot(kind, err = 0.3, rand = Math.random) {
  const d = AI_KINDS[kind] || AI_KINDS.drive;
  const range = ([a, b]) => a + (b - a) * rand();
  return {
    kind, label: d.name,
    target: { x: clamp((rand() - 0.5) * 1.2 + (rand() - 0.5) * err, -0.72, 0.72), y: TABLE.top + BALL_R, z: range(d.z) },
    T: range(d.T), spin: d.spin(rand),
  };
}

// ───────────────────────── 試打模擬 ─────────────────────────
function zoneOf(x, z, towardNegZ) {
  const lr = x < -0.25 ? '左' : x > 0.25 ? '右' : '中';
  const depth = Math.abs(z); // 離網距離
  const dn = depth < 0.45 ? '網前' : depth < 0.95 ? '中場' : '底線';
  return { lr, dn, text: `${lr}・${dn}`, towardNegZ };
}

/** 實際把這一記球飛一遍：落點、弧度（側偏）、最高點、過網高度、彈起後偏移。 */
export function simulateShot(p0, shot) {
  const sol = solveShot(p0, shot.target, shot.T, shot.spin, shot.clearance ?? (shot.smash ? 0.02 : 0.05));
  const b = makeBall();
  b.pos = { ...p0 };
  b.vel = { ...sol.vel };
  b.spin = { ...shot.spin };
  const dirZ = Math.sign(sol.vel.z) || -1;
  const speed0 = Math.hypot(sol.vel.x, sol.vel.y, sol.vel.z);
  const path = [{ ...b.pos }];
  let netClear = null, hitNet = false, crossed = false, landing = null, peakY = b.pos.y, post = null;
  const dt = 1 / 240;
  for (let i = 0; i < 240 * 3; i++) {
    const pz = b.pos.z;
    stepBall(b, dt);
    path.push({ ...b.pos });
    peakY = Math.max(peakY, b.pos.y);
    if (!crossed && (pz > 0) !== (b.pos.z > 0)) {
      crossed = true;
      netClear = b.pos.y - NET_TOP;
      if (b.pos.y < NET_TOP + BALL_R * 0.3 && Math.abs(b.pos.x) < TABLE.halfW + 0.15) { hitNet = true; break; }
    }
    if (!landing && crossed && b.vel.y < 0 && b.pos.y <= TABLE.top + BALL_R
      && Math.abs(b.pos.x) <= TABLE.halfW + BALL_R && Math.abs(b.pos.z) <= TABLE.halfL + BALL_R) {
      const vxBefore = b.vel.x;
      landing = { x: b.pos.x, z: b.pos.z, t: i * dt };
      bounceOnTable(b);
      post = { x0: b.pos.x, vxBefore, vxAfter: b.vel.x };
      // 彈起後再飛 0.35 秒，看側向又偏了多少
      const bb = { pos: { ...b.pos }, vel: { ...b.vel }, spin: { ...b.spin } };
      for (let k = 0; k < 84; k++) stepBall(bb, dt);
      post.shift = bb.pos.x - post.x0 - vxBefore * 0.35;
      break;
    }
    if (b.pos.y < BALL_R) break;
  }
  // 側向弧度：路徑相對「起點→落點」直線的最大偏離
  let maxDev = 0;
  const end = landing || path[path.length - 1];
  const dz = end.z - p0.z;
  if (Math.abs(dz) > 0.05) {
    for (const q of path) {
      const s = clamp((q.z - p0.z) / dz, 0, 1);
      maxDev = Math.max(maxDev, Math.abs(q.x - (p0.x + s * (end.x - p0.x))));
    }
  }
  const onTable = !!landing;
  return {
    onTable, hitNet, speed: speed0, flightT: landing ? landing.t : null, peakY,
    netClear, curveCm: Math.round(maxDev * 100), bounceShiftCm: post ? Math.round(post.shift * 100) : 0,
    landing: landing ? { x: landing.x, z: landing.z, zone: zoneOf(landing.x, landing.z, dirZ < 0).text } : null,
    vel: sol.vel,
  };
}
