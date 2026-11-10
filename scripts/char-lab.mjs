// 角色平衡實驗：同一批操作，比較十個角色（標準球拍＋標準球）的進球率與球速。
// 數值設計目標：差異要明顯但不誇張。用法：npm run lab:char
import { TUNE } from '../src/tuning.js';
import { buildPlayerShot, simulateShot, handOf, timingInfo } from '../src/shots.js';
import { CHARACTERS, RACKETS, BALLS, baseMods, racketById, ballById, charById } from '../src/characters.js';

const swipes = [
  { dx: 0, dy: -80, len: 80, dur: 330, curve: 0 }, { dx: 0, dy: -150, len: 150, dur: 170, curve: 0 }, { dx: 0, dy: -170, len: 170, dur: 70, curve: 0 },
  { dx: 10, dy: -150, len: 150, dur: 160, curve: -0.16 }, { dx: 0, dy: 120, len: 120, dur: 220, curve: 0 },
  { dx: 70, dy: -130, len: 148, dur: 170, curve: 0 }, { dx: -70, dy: -130, len: 148, dur: 170, curve: 0 }, { dx: 0, dy: -120, len: 120, dur: 220, curve: 0, speed: 0.85 },
];
for (const s of swipes) s.speed ??= s.len / s.dur;
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gaussFrom = (r) => () => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());

function trial(mods, so, st, N = 4000) {
  const r = mulberry(4242), g = gaussFrom(r);
  const c = { ok: 0, net: 0, out: 0, short: 0 }; let pace = 0, spin = 0, curve = 0;
  for (let i = 0; i < N; i++) {
    const s = { ...swipes[Math.floor(r() * swipes.length)] }; s.speed *= 0.85 + r() * 0.4;
    const bx = (r() - 0.5) * 1.2;
    const p0 = { x: bx, y: 0.75 + r() * 0.45, z: TUNE.idealZ + g() * st };
    const shot = buildPlayerShot({ swipe: s, p0, hand: handOf(bx, 0.6 * bx), timingOff: timingInfo(p0.z).off, contact: { ox: g() * so, oy: g() * so }, mods });
    const x = simulateShot(p0, shot);
    c[x.result]++; pace += x.pace; spin += Math.abs(shot.spin.top) + Math.abs(shot.spin.side); curve += x.curveCm;
  }
  return { ok: c.ok / N, pace: (pace / N) * 3.6, spin: spin / N, curve: curve / N };
}

const racket = racketById('std'), ball = ballById('std');
console.log('角色（標準拍、標準球）                新手進球  一般進球  很穩進球  水平球速  平均旋轉  平均弧度cm');
let base;
for (const ch of CHARACTERS) {
  const m = baseMods(ch, racket, ball);
  const mods = { push: m.push, spin: m.spin, err: m.err, free: m.free, sideSpin: m.sideSpin, smashPush: m.smashPush, chopSpin: m.chopSpin, dropDepth: m.dropDepth };
  const a = trial(mods, 0.6, 0.45), b = trial(mods, 0.4, 0.28), c = trial(mods, 0.2, 0.12);
  base ??= { b, a };
  const f = (v) => `${Math.round(v * 100)}%`.padStart(4);
  console.log(`${ch.name.padEnd(8, '　')}${ch.role.padEnd(8, '　')}      ${f(a.ok)}      ${f(b.ok)}      ${f(c.ok)}     ${b.pace.toFixed(1).padStart(5)}     ${b.spin.toFixed(2)}     ${b.curve.toFixed(1).padStart(5)}`);
}
console.log('\n球拍與球（以麻糬君、一般玩家為基準）');
const mochi = charById('mochi');
for (const r of RACKETS) {
  const m = baseMods(mochi, r, ball); const t = trial({ push: m.push, spin: m.spin, err: m.err, free: m.free }, 0.4, 0.28);
  console.log(`球拍 ${r.name.padEnd(12, '　')} 進球 ${Math.round(t.ok * 100)}%  球速 ${t.pace.toFixed(1)}  旋轉 ${t.spin.toFixed(2)}`);
}
for (const bl of BALLS) {
  const m = baseMods(mochi, racket, bl); const g0 = TUNE.gravity; TUNE.gravity = m.gravity; TUNE.restitution = m.rest; TUNE.slide = m.slide;
  const t = trial({ push: m.push, spin: m.spin, err: m.err, free: m.free }, 0.4, 0.28);
  TUNE.gravity = g0; TUNE.restitution = 0.9; TUNE.slide = 1;
  console.log(`球　 ${bl.name.padEnd(12, '　')} 進球 ${Math.round(t.ok * 100)}%  球速 ${t.pace.toFixed(1)}  旋轉 ${t.spin.toFixed(2)}`);
}
