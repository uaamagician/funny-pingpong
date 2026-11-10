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

// ───────────────────────── 失誤（沒進）模型 ─────────────────────────
// 每一球都有機率失誤：球種越冒險、時機/準度越差，機率越高。
// 失誤不會寫在畫面上，而是真的讓球「掛網／出界／沒過網」，再由比賽規則判定。
const FAULT_BASE = { drive: 0.05, loop: 0.1, spin: 0.11, chop: 0.06, drop: 0.13, smash: 0.2, flick: 0.15, lift: 0.04, serve: 0.05, lob: 0.05 };
const FAULT_MIX = {
  smash: { net: 0.35, long: 0.45, wide: 0.2 },
  flick: { net: 0.4, long: 0.4, wide: 0.2 },
  loop: { long: 0.5, net: 0.3, wide: 0.2 },
  spin: { wide: 0.5, net: 0.3, long: 0.2 },
  drop: { net: 0.5, short: 0.5 },
  chop: { net: 0.6, short: 0.4 },
  drive: { net: 0.4, long: 0.3, short: 0.3 },
  lift: { long: 0.6, wide: 0.4 },
  lob: { long: 0.6, wide: 0.4 },
  serve: { net: 0.4, long: 0.3, short: 0.3 },
};
export function faultChance(kind, quality = 1, mul = 1) {
  return clamp((FAULT_BASE[kind] ?? 0.04) * (1 + 2 * (1 - quality)) * mul, 0, 0.55);
}
export function rollFault(kind, quality = 1, mul = 1, rand = Math.random) {
  if (rand() >= faultChance(kind, quality, mul)) return null;
  const mix = FAULT_MIX[kind] || FAULT_MIX.drive;
  let r = rand() * Object.values(mix).reduce((a, b) => a + b, 0);
  for (const [k, w] of Object.entries(mix)) { r -= w; if (r <= 0) return k; }
  return 'net';
}

/**
 * 玩家的滑動 → 一記球。
 * - 一律帶旋轉：向前滑=上旋，向下滑=下旋，劃弧線=側旋；越快旋轉越強。
 * - 正手：力量大、旋轉強、能殺球；反手：較穩、力量小、改用快撥。
 * - 時機偏早 → 球偏左、變短；偏晚 → 球偏右、變深（容易出界）。
 */
export function buildPlayerShot({ swipe: s, p0, hand = 'FH', timingOff = 0, acc = 1, isServe = false, riskMul = 1, rand = Math.random }) {
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
  // 正手／反手只影響手感，不顯示在畫面上
  const label = isServe ? '發球' : `${perfect ? '完美·' : ''}${name}`;
  return {
    kind, hand, label, smash: kind === 'smash', perfect, quality, tq,
    fault: rollFault(kind, quality, riskMul, rand),
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
  const fault = rollFault(kind, 1, err / 0.35, rand); // 簡單的 AI 比較容易失誤
  const d = AI_KINDS[kind] || AI_KINDS.drive;
  const range = ([a, b]) => a + (b - a) * rand();
  return {
    kind, label: d.name, fault,
    target: { x: clamp((rand() - 0.5) * 1.2 + (rand() - 0.5) * err, -0.72, 0.72), y: TABLE.top + BALL_R, z: range(d.z) },
    T: range(d.T), spin: d.spin(rand),
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

/** 先解出理想速度，若這球注定失誤，再把速度弄壞一點（掛網／太長／太偏／力量不足）。 */
export function finalizeShot(p0, shot, rand = Math.random) {
  const sol = solveShot(p0, shot.target, shot.T, shot.spin, shot.clearance ?? (shot.smash ? 0.02 : 0.05));
  const vel = { ...sol.vel };
  switch (shot.fault) {
    case 'net': vel.y -= 1.4 + 0.6 * rand(); break;                        // 過網高度不夠
    case 'long': vel.z *= 1.3 + 0.12 * rand(); vel.y += 0.3; break;         // 太長，飛出桌尾
    case 'wide': vel.x += (rand() < 0.5 ? -1 : 1) * (1.6 + 0.7 * rand()); break; // 太偏，飛出側邊
    case 'short': vel.z *= 0.42 + 0.12 * rand(); break;                    // 力量不足，沒過網
    default: break;
  }
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
export function simulateShot(p0, shot, rand = Math.random) {
  const { vel } = finalizeShot(p0, shot, rand);
  const ownSign = Math.sign(p0.z) || 1;
  const f = flight(p0, vel, shot.spin);
  const result = classify(f, ownSign);
  const land = result === 'ok' ? f.bounces[0] : null;
  const end = land || f.path[f.path.length - 1];
  let maxDev = 0;
  const dz = end.z - p0.z;
  if (Math.abs(dz) > 0.05) {
    for (const q of f.path) {
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
export function solveServe(p0, L, spin, fault = null, rand = Math.random) {
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
  const pool = (r) => cands.filter((c) => c.result === r).sort((a, b) => a.err - b.err);
  const good = pool('ok');
  const want = fault && fault !== 'wide' ? fault : null;
  if (want) {
    // 想要的失誤方式：net／long(out)／short
    const list = pool(want === 'long' ? 'out' : want);
    if (list.length) return { vel: list[0].vel, own: list[0].own, result: list[0].result };
  }
  if (good.length) {
    const best = good[0];
    if (fault === 'wide') { // 太偏：同一組速度，橫向多給一點
      const vel = { ...best.vel, x: best.vel.x + (rand() < 0.5 ? -1 : 1) * 1.4 };
      return { vel, own: best.own, result: 'out' };
    }
    return { vel: best.vel, own: best.own, result: 'ok', landing: { x: best.lx, z: best.lz } };
  }
  const any = cands.sort((a, b) => a.err - b.err)[0];
  return { vel: any.vel, own: any.own, result: any.result };
}
