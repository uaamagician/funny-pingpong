// 擊球模型：把「滑動 + 球的位置 + 時機」轉成一記球。純函式、不依賴畫面，
// 所以可以在 Node 裡做實驗（npm run lab），也能在遊戲裡直接用。
import { TABLE, BALL_R, NET_TOP, stepBall, bounceOnTable, solveShot } from './physics.js';
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

// ───────────────────────── 失誤（沒進）模型：完全由你的操作決定 ─────────────────────────
// 沒有隨機骰子。球沒進，是因為：
//  1. 時機不對：太早 → 球偏左、太短、過網太低（容易掛網或沒過）；太晚 → 球偏右、太深（容易出界）
//  2. 沒打在球的「甜蜜點」（球拍正中心）：從球的左／右邊擦過 → 球偏向那一側；
//     球碰在這一劃的起手段（還沒加速）→ 力量不足、球壓得太低（掛網）；
//     碰在收尾段（揮過頭）→ 球飛太遠（出界）。最準是在一劃的中段碰到球。
// 球種越冒險（殺球、快撥、吊球），同樣的偏差會被放大得越多。
export const SWEET = 0.55;                  // 甜蜜點半徑（占擊球圈半徑的比例），在內不會有偏差
const KIND_RISK = { smash: 1.5, flick: 1.25, spin: 1.15, loop: 1.1, drop: 1.2, drive: 0.85, chop: 0.85, lift: 0.7, lob: 0.8, serve: 0.9 };
const dead = (v) => Math.sign(v) * Math.max(0, Math.abs(v) - SWEET) / (1 - SWEET);
// 時機寬容區：|偏差| 在這之內完全不扣分
const LATE_EARLY_FREE = 0.3;

/**
 * 把「碰到球的位置」和「時機」換成落點偏差。
 * ox：滑動路徑從球的左(−)右(+)擦過；oy：球落在這一劃的起手段(−)／收尾段(+)，中段最準（都以擊球圈半徑為單位）。
 * 回傳：dx 橫向偏移(m)、dDepth 深度變化(m，正＝更深)、dClear 過網高度減少(m)。
 */
export function contactErrors({ ox = 0, oy = 0, timingOff = 0, kind = 'drive', errMul = 1 }) {
  const m = (KIND_RISK[kind] ?? 1) * errMul;
  const oxe = dead(ox), oye = dead(oy);
  const late = Math.max(0, timingOff - LATE_EARLY_FREE), early = Math.max(0, -timingOff - LATE_EARLY_FREE);
  const dx = m * 0.5 * oxe + 0.15 * clamp(timingOff / 0.8, -1, 1);
  const dDepth = m * (0.5 * Math.max(0, oye) - 0.35 * Math.max(0, -oye) + 0.7 * late - 0.55 * early)
    + (timingOff >= 0 ? 0.25 : 0.2) * timingOff;
  const dClear = m * (0.14 * Math.max(0, -oye) + 0.24 * early); // 球被壓低的程度
  return { dx, dDepth, dClear, sloppy: Math.max(Math.abs(oxe), Math.abs(oye)) };
}

const gauss = (rand) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand());

/**
 * 玩家的滑動 → 一記球。
 * - 一律帶旋轉：向前滑=上旋，向下滑=下旋，劃弧線=側旋；越快旋轉越強。
 * - 正手：力量大、旋轉強、能殺球；反手：較穩、力量小、改用快撥。
 * - 時機偏早 → 球偏左、變短；偏晚 → 球偏右、變深（容易出界）。
 */
export function buildPlayerShot({ swipe: s, p0, hand = 'FH', timingOff = 0, contact = { ox: 0, oy: 0 }, isServe = false, errMul = 1, rand = () => 0.5 }) {
  const FH = hand === 'FH';
  const fwd = -s.dy;
  const tq = clamp(1 - Math.abs(timingOff) / 0.9, 0, 1);
  const off = Math.hypot(contact.ox, contact.oy);          // 離球心多遠（0 = 正中心）
  const acc = clamp(1 - off, 0, 1);
  const quality = isServe ? 1 : clamp(0.6 * tq + 0.4 * acc, 0, 1);
  const perfect = !isServe && Math.abs(timingOff) < 0.2 && off < SWEET + 0.05; // 時機準 + 打在甜蜜點

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
    case 'serve': top = fwd < 0 ? -(0.4 + 0.35 * clamp(-fwd / 140, 0, 1)) : 0.15 + 0.3 * p; break; // 往下滑 = 下旋發球
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
    default: // serve
      if (fwd < 0) { T = 0.9; tz = -(0.45 + 0.25 * p); }  // 下旋發球：慢、短
      else { T = 0.82 - 0.3 * p; tz = -(0.5 + 0.6 * p); }
  }
  // 往前滑：看滑動方向；往下切：看左右偏多少（直直往下就是打中間）
  let tx = fwd > 0 ? clamp(Math.atan2(s.dx, fwd) / 0.9, -1, 1) * 0.58 : clamp(s.dx / 150, -1, 1) * 0.5;

  // 套用時機與擊球點造成的偏差（發球只受擊球點影響）
  const e = contactErrors({ ox: contact.ox, oy: contact.oy, timingOff: isServe ? 0 : timingOff, kind, errMul: errMul * (FH ? 1 : 0.85) });
  tx += e.dx;
  const dz = clamp(-tz + e.dDepth, 0.05, 1.9);   // 離網距離（越大越深）
  tz = -dz;
  if (!isServe) T += (1 - tq) * 0.1;
  tx = clamp(tx, -1.1, 1.1);                      // 超過 ±0.76 就是出界

  const name = kind === 'spin' ? (side > 0 ? '右旋球' : '左旋球') : KIND_NAME[kind];
  // 正手／反手只影響手感，不顯示在畫面上
  const serveName = top < -0.25 ? '下旋發球' : Math.abs(side) > 0.3 ? (side > 0 ? '右旋發球' : '左旋發球') : '發球';
  const label = isServe ? serveName : `${perfect ? '完美·' : ''}${name}`;
  return {
    kind, hand, label, smash: kind === 'smash', perfect, quality, tq,
    off,
    target: { x: tx, y: TABLE.top + BALL_R, z: tz },
    T, spin: { top, side },
    // 太早或打在球上半 → 球被壓低（sink），過網高度不夠，會掛網
    clearance: kind === 'smash' ? 0.02 : 0.05,
    sink: isServe ? 0 : e.dClear * 10,
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

/**
 * AI 的球也走同一套規則：AI 的「擊球點」和「時機」會有高斯分布的偏差，偏差大小由難度決定，
 * 所以 AI 的失誤原因和你一樣（掛網、出界、沒過），只是由它的技術水準決定。
 */
export function buildAiShot(kind, skill = { sigO: 0.4, sigT: 0.3 }, rand = Math.random) {
  const d = AI_KINDS[kind] || AI_KINDS.drive;
  const range = ([a, b]) => a + (b - a) * rand();
  const ox = gauss(rand) * skill.sigO, oy = gauss(rand) * skill.sigO, timingOff = gauss(rand) * skill.sigT;
  const e = contactErrors({ ox, oy, timingOff, kind });
  const x = clamp((rand() - 0.5) * 1.2 + e.dx, -1.1, 1.1);
  const z = clamp(range(d.z) + e.dDepth, 0.05, 1.9);
  return {
    kind, label: d.name,
    target: { x, y: TABLE.top + BALL_R, z },
    T: range(d.T), spin: d.spin(rand),
    clearance: kind === 'smash' ? 0.02 : 0.05,
    sink: e.dClear * 10,
  };
}

// ───────────────────────── 飛行模擬 ─────────────────────────
function zoneOf(x, z) {
  const lr = x < -0.25 ? '左' : x > 0.25 ? '右' : '中';
  const depth = Math.abs(z); // 離網距離
  const dn = depth < 0.45 ? '網前' : depth < 0.95 ? '中場' : '底線';
  return { lr, dn, text: `${lr}・${dn}` };
}

/** 把一記球完整飛一遍（含球網、落桌、彈起），回傳事件與軌跡。 */
export function flight(p0, vel, spin, maxT = 3) {
  const b = { pos: { ...p0 }, vel: { ...vel }, spin: { ...spin } };
  const bounces = [];
  const path = [{ ...b.pos }];
  let crossed = false, netHit = false, netClear = null, peakY = b.pos.y;
  const dt = 1 / 240;
  let t = 0;
  for (; t < maxT; t += dt) {
    const pz = b.pos.z;
    stepBall(b, dt);
    path.push({ ...b.pos });
    peakY = Math.max(peakY, b.pos.y);
    if (!crossed && (pz > 0) !== (b.pos.z > 0)) {
      crossed = true;
      netClear = b.pos.y - NET_TOP;
      if (b.pos.y < NET_TOP + BALL_R * 0.3 && Math.abs(b.pos.x) < TABLE.halfW + 0.15) { netHit = true; break; }
    }
    if (b.vel.y < 0 && b.pos.y <= TABLE.top + BALL_R && b.pos.y > TABLE.top - 0.12
      && Math.abs(b.pos.x) <= TABLE.halfW + BALL_R && Math.abs(b.pos.z) <= TABLE.halfL + BALL_R) {
      const vxBefore = b.vel.x;
      const hit = { x: b.pos.x, z: b.pos.z, t, side: b.pos.z > 0 ? 1 : -1, vxBefore };
      bounceOnTable(b);
      hit.vxAfter = b.vel.x;
      bounces.push(hit);
      if (bounces.length >= 3) break;
    }
    if (b.pos.y < BALL_R) break;
  }
  return { bounces, crossed, netHit, netClear, peakY, path, end: { ...b.pos }, t };
}

/** 解出這一記球的初速度（偏差已經反映在 target 與 clearance 裡，沒有額外的隨機破壞）。 */
export function finalizeShot(p0, shot) {
  const sol = solveShot(p0, shot.target, shot.T, shot.spin, shot.clearance ?? (shot.smash ? 0.02 : 0.05));
  const vel = { ...sol.vel };
  vel.y -= shot.sink || 0; // 被壓低的球：出手時向下的速度更多
  return { vel, T: sol.T };
}

/** 落點結果：ok／net／out／short */
export function classify(f, ownSign) {
  if (f.netHit) return 'net';
  const first = f.bounces[0];
  if (first) return first.side === ownSign ? 'short' : 'ok';
  return f.crossed ? 'out' : 'short';
}

/** 實際把這一記球飛一遍：結果、落點、弧度（側偏）、最高點、過網高度、彈起後偏移。 */
export function simulateShot(p0, shot) {
  const { vel } = finalizeShot(p0, shot);
  return describeFlight(p0, vel, shot.spin);
}

/** 描述已知初速度的一記球（遊戲裡用實際發出去的速度，確保顯示和結果一致）。 */
export function describeFlight(p0, vel, spin) {
  const ownSign = Math.sign(p0.z) || 1;
  const f = flight(p0, vel, spin);
  const result = classify(f, ownSign);
  const land = result === 'ok' ? f.bounces[0] : null;
  const end = land || f.path[f.path.length - 1];
  let maxDev = 0;
  const dz = end.z - p0.z;
  const upto = land ? f.path.slice(0, Math.floor(land.t * 240) + 2) : f.path; // 只量到第一次落桌為止
  if (Math.abs(dz) > 0.05) {
    for (const q of upto) {
      const sFrac = clamp((q.z - p0.z) / dz, 0, 1);
      maxDev = Math.max(maxDev, Math.abs(q.x - (p0.x + sFrac * (end.x - p0.x))));
    }
  }
  return {
    result, onTable: result === 'ok', hitNet: result === 'net',
    speed: Math.hypot(vel.x, vel.y, vel.z), peakY: f.peakY, netClear: f.netClear,
    curveCm: Math.round(maxDev * 100),
    bounceShiftCm: land ? Math.round((land.vxAfter - land.vxBefore) * 35) : 0,
    landing: land ? { x: land.x, z: land.z, zone: zoneOf(land.x, land.z).text } : null,
    vel,
  };
}

// ───────────────────────── 發球：先打自己這半桌，再過網 ─────────────────────────
/**
 * 解出發球的初速度：球先落在自己半桌（第一次落點 B），彈起後過網，落在對方半桌 L 附近。
 * 用掃描 + 模擬找最接近的組合；若這球注定失誤（fault），改挑一個會失誤的組合。
 * 回傳 { vel, own: 第一次落點, result: ok/net/out/short/illegal }
 */
export function solveServe(p0, L, spin) {
  const sgn = Math.sign(p0.z) || 1;
  const cands = [];
  for (const T1 of [0.28, 0.34, 0.4, 0.48]) {
    for (let bz = 0.2; bz <= 1.3; bz += 0.05) {
      const B = { x: p0.x + (L.x - p0.x) * 0.35, y: TABLE.top + BALL_R, z: sgn * bz };
      const sol = solveShot(p0, B, T1, spin, -1);
      const f = flight(p0, sol.vel, spin, 2.5);
      const first = f.bounces[0], second = f.bounces[1];
      let result;
      if (f.netHit) result = 'net';
      else if (!first || first.side !== sgn) result = 'illegal';          // 沒先打到自己半桌
      else if (!second) result = f.crossed ? 'out' : 'short';
      else result = second.side === sgn ? 'short' : 'ok';
      const lz = second ? second.z : f.end.z, lx = second ? second.x : f.end.x;
      cands.push({ vel: sol.vel, own: first || null, result, err: Math.abs(lz - L.z) + 0.6 * Math.abs(lx - L.x), lz, lx });
    }
  }
  // 選最接近目標的組合。目標若已經偏出桌面或貼網（例如打在球上半、力量過頭），自然就會失誤。
  const legal = cands.filter((c) => c.result !== 'illegal');
  const best = (legal.length ? legal : cands).sort((a, b) => a.err - b.err)[0];
  return { vel: best.vel, own: best.own, result: best.result, landing: best.result === 'ok' ? { x: best.lx, z: best.lz } : null };
}
