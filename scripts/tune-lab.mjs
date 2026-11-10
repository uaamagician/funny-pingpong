// 手感調整實驗：用同一批「操作」（固定亂數）比較不同的容錯與推力設定，
// 看新手／一般／很穩的玩家各自的進球率與出球的水平球速。用法：npm run lab:tune
import { TUNE } from '../src/tuning.js';
import { buildPlayerShot, simulateShot, handOf, timingInfo } from '../src/shots.js';

const swipes = [
  { dx: 0, dy: -80, len: 80, dur: 330, curve: 0 }, { dx: 0, dy: -150, len: 150, dur: 170, curve: 0 }, { dx: 0, dy: -170, len: 170, dur: 70, curve: 0 },
  { dx: 10, dy: -150, len: 150, dur: 160, curve: -0.16 }, { dx: 0, dy: 120, len: 120, dur: 220, curve: 0 },
  { dx: 70, dy: -130, len: 148, dur: 170, curve: 0 }, { dx: -70, dy: -130, len: 148, dur: 170, curve: 0 },
  { dx: 0, dy: -120, len: 120, dur: 220, curve: 0, speed: 0.85 }, // 點一下（平擊）
];
for (const s of swipes) s.speed ??= s.len / s.dur;
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gaussFrom = (r) => () => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());

function trial(so, st, N = 5000) {
  const r = mulberry(12345), g = gaussFrom(r);
  const c = { ok: 0, net: 0, out: 0, short: 0 }; let pace = 0, flight = 0;
  for (let i = 0; i < N; i++) {
    const s = { ...swipes[Math.floor(r() * swipes.length)] };
    s.speed *= 0.85 + r() * 0.4;
    const bx = (r() - 0.5) * 1.2;
    const p0 = { x: bx, y: 0.75 + r() * 0.45, z: TUNE.idealZ + g() * st };
    const shot = buildPlayerShot({ swipe: s, p0, hand: handOf(bx, 0.6 * bx), timingOff: timingInfo(p0.z).off, contact: { ox: g() * so, oy: g() * so } });
    const x = simulateShot(p0, shot);
    c[x.result]++; pace += x.pace; flight += x.flightT ?? shot.T;
  }
  return { ...c, pace: (pace / N) * 3.6, N };
}

const levels = [['新手', 0.6, 0.45], ['一般', 0.4, 0.28], ['很穩', 0.2, 0.12]];
const configs = [
  ['舊設定', { gravity: 1, push: 1, netMargin: 0, sinkK: 10, errScale: 1 }],
  ['只放寬容錯', { gravity: 1, push: 1, netMargin: 0.04, sinkK: 3, errScale: 0.7 }],
  ['寬容 + 推力 ×1.06', { gravity: 1, push: 1.06, netMargin: 0.04, sinkK: 3, errScale: 0.7 }],
  ['寬容 + 推力 ×1.12（目前預設）', { gravity: 1, push: 1.12, netMargin: 0.04, sinkK: 3, errScale: 0.7 }],
  ['寬容 + 推力 ×1.25', { gravity: 1, push: 1.25, netMargin: 0.04, sinkK: 3, errScale: 0.7 }],
];
const saved = { ...TUNE };
for (const [name, cfg] of configs) {
  Object.assign(TUNE, cfg);
  const cells = levels.map(([ln, so, st]) => {
    const t = trial(so, st); const p = (v) => String(Math.round((v / t.N) * 100)).padStart(2);
    return `${ln} 進${p(t.ok)}% (網${p(t.net)} 界${p(t.out)} 短${p(t.short)}) 水平球速${t.pace.toFixed(1)}`;
  });
  console.log(name.padEnd(28), cells.join('  |  '));
}
Object.assign(TUNE, saved);
console.log('\n（網=掛網、界=出界、短=沒過；水平球速單位 km/h；各 5000 球、同一批操作）');
