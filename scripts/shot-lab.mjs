// 擊球實驗室：不開瀏覽器，直接把各種滑動 × 來球位置 × 時機 × 擊球點丟進擊球模型，
// 看球種、落點、弧度（側偏）、球速、過網高度，以及「什麼操作會失誤」。用法：npm run lab
import { TUNE } from '../src/tuning.js';
import {
  buildPlayerShot, simulateShot, handOf, timingInfo, buildAiShot, pickAiKind, KIND_NAME, solveServe,
} from '../src/shots.js';

const OLD = { sideA: 8, topG: 4.5, bounceKick: 1.0, bounceTopK: 0.25 }; // 較早一版（太誇張）的數值
const arg = process.argv[2];
const swipes = {
  '慢直滑': { dx: 0, dy: -80, len: 80, dur: 330, curve: 0 },
  '中速直滑': { dx: 0, dy: -150, len: 150, dur: 170, curve: 0 },
  '快速猛滑': { dx: 0, dy: -170, len: 170, dur: 70, curve: 0 },
  '右弧': { dx: 10, dy: -150, len: 150, dur: 160, curve: -0.16 },
  '左弧': { dx: -10, dy: -150, len: 150, dur: 160, curve: 0.16 },
  '強右弧': { dx: 10, dy: -150, len: 150, dur: 140, curve: -0.3 },
  '向下切': { dx: 0, dy: 120, len: 120, dur: 220, curve: 0 },
  '斜右上': { dx: 70, dy: -130, len: 148, dur: 170, curve: 0 },
  '斜左上': { dx: -70, dy: -130, len: 148, dur: 170, curve: 0 },
};
for (const s of Object.values(swipes)) s.speed = s.len / s.dur;
const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, Math.random()))) * Math.cos(2 * Math.PI * Math.random());
const pct = (n, d) => `${Math.round((n / d) * 100)}%`;

function run(title, tune) {
  Object.assign(TUNE, tune);
  console.log(`\n══ ${title}  (sideA=${TUNE.sideA} topG=${TUNE.topG} kick=${TUNE.bounceKick}) ══`);
  const rows = [];
  for (const [sn, s] of Object.entries(swipes)) {
    for (const [bn, bx, by] of [['右側高球', 0.5, 1.1], ['中間中球', 0.0, 0.92], ['左側中球', -0.5, 0.92], ['左側低球', -0.5, 0.72]]) {
      const hand = handOf(bx, 0.6 * bx);
      const p0 = { x: bx, y: by, z: TUNE.idealZ };
      const shot = buildPlayerShot({ swipe: s, p0, hand, timingOff: 0 }); // 時機完美、打在正中心
      const r = simulateShot(p0, shot);
      rows.push({ 滑動: sn, 來球: bn, 球種: shot.label, 落點: r.landing ? r.landing.zone : r.result,
        '球速km/h': Math.round(r.speed * 3.6), 弧度cm: r.curveCm, 彈後偏cm: r.bounceShiftCm,
        上下旋: shot.spin.top.toFixed(2), 側旋: shot.spin.side.toFixed(2) });
    }
  }
  console.table(rows);
  const ok = rows.filter((r) => r.落點 !== 'net' && r.落點 !== 'out' && r.落點 !== 'short').length;
  console.log(`完美擊球上桌率 ${ok}/${rows.length}　最大飛行弧度 ${Math.max(...rows.map((r) => r.弧度cm))} cm　最大彈起偏移 ${Math.max(...rows.map((r) => Math.abs(r.彈後偏cm)))} cm`);
}

const RES = { ok: '進', net: '掛網', out: '出界', short: '沒過' };
const sym = (r) => ({ ok: '○', net: '網', out: '界', short: '短' }[r] || '?');

function timingTable() {
  console.log('\n══ 時機實驗（中速直滑、中間中球、打在正中心）══');
  const rows = [];
  for (const z of [0.6, 0.8, 1.0, 1.25, 1.45, 1.7, 2.0, 2.3, 2.6]) {
    const t = timingInfo(z);
    const p0 = { x: 0, y: 0.92, z };
    const shot = buildPlayerShot({ swipe: swipes['中速直滑'], p0, hand: 'FH', timingOff: t.off });
    const r = simulateShot(p0, shot);
    rows.push({ 球離網z: z, 時機: t.name, 結果: RES[r.result], 落點: r.landing ? `${r.landing.zone}(x=${r.landing.x.toFixed(2)})` : '-', 'km/h': Math.round(r.speed * 3.6) });
  }
  console.table(rows);
}

function contactGrid() {
  console.log('\n══ 擊球點實驗：同一顆球、時機完美，只改「滑過球的哪個位置」（○進 網 界 短）══');
  console.log('橫軸 = 左右偏移(ox，單位：擊球圈半徑)；縱軸 = 球落在這一劃的哪一段(oy：負＝起手段、正＝收尾段，0 = 中段最準)');
  for (const kind of ['平擊(中速直滑)', '上旋拉球(快一點)', '殺球(快速猛滑)', '吊球(慢直滑)']) {
    const s = { '平擊(中速直滑)': swipes['中速直滑'], '上旋拉球(快一點)': { dx: 0, dy: -150, len: 150, dur: 130, curve: 0, speed: 150 / 130 }, '殺球(快速猛滑)': swipes['快速猛滑'], '吊球(慢直滑)': swipes['慢直滑'] }[kind];
    const p0 = { x: 0, y: 1.05, z: TUNE.idealZ };
    const xs = [-1, -0.7, -0.35, 0, 0.35, 0.7, 1];
    console.log(`\n${kind}`);
    console.log('      ' + xs.map((x) => String(x).padStart(5)).join(''));
    for (const oy of [-1, -0.7, -0.35, 0, 0.35, 0.7, 1]) {
      let line = String(oy).padStart(5) + ' ';
      for (const ox of xs) {
        const shot = buildPlayerShot({ swipe: s, p0, hand: 'FH', timingOff: 0, contact: { ox, oy } });
        line += `    ${sym(simulateShot(p0, shot).result)}`;
      }
      console.log(line);
    }
  }
}

function skillTable() {
  console.log('\n══ 不同操作水準的進球率（擊球點與時機的偏差呈常態分布，各 4000 球）══');
  const levels = [['很穩（點準、時機準）', 0.2, 0.1], ['一般玩家', 0.4, 0.25], ['手忙腳亂', 0.65, 0.45]];
  const rows = [];
  const detail = {};
  for (const [name, so, st] of levels) {
    const c = { ok: 0, net: 0, out: 0, short: 0 }; const byKind = {};
    for (let i = 0; i < 4000; i++) {
      const names = Object.keys(swipes);
      const base = swipes[names[Math.floor(Math.random() * names.length)]];
      const s = { ...base, speed: base.speed * (0.85 + Math.random() * 0.4), curve: base.curve + (Math.random() - 0.5) * 0.03 };
      const bx = (Math.random() - 0.5) * 1.2;
      const p0 = { x: bx, y: 0.75 + Math.random() * 0.45, z: TUNE.idealZ + gauss() * st };
      const off = timingInfo(p0.z).off;
      const shot = buildPlayerShot({ swipe: s, p0, hand: handOf(bx, 0.6 * bx), timingOff: off, contact: { ox: gauss() * so, oy: gauss() * so } });
      const r = simulateShot(p0, shot);
      c[r.result]++;
      byKind[shot.kind] ??= { n: 0, ok: 0 };
      byKind[shot.kind].n++; if (r.result === 'ok') byKind[shot.kind].ok++;
    }
    const n = c.ok + c.net + c.out + c.short;
    rows.push({ 水準: name, 進: pct(c.ok, n), 掛網: pct(c.net, n), 出界: pct(c.out, n), 沒過: pct(c.short, n) });
    detail[name] = byKind;
  }
  console.table(rows);
  console.log('各球種進球率（一般玩家）：' + Object.entries(detail['一般玩家']).map(([k, v]) => `${KIND_NAME[k] || k} ${pct(v.ok, v.n)}`).join('、'));
  console.log('各球種進球率（很穩）　　：' + Object.entries(detail['很穩（點準、時機準）']).map(([k, v]) => `${KIND_NAME[k] || k} ${pct(v.ok, v.n)}`).join('、'));
}

function aiTable() {
  console.log('\n══ AI 各難度（每種球 7 種 × 400 次；球從對手半邊打向你）══');
  const rows = [];
  for (const [dn, skill] of [['簡單', { sigO: 0.45, sigT: 0.35 }], ['普通', { sigO: 0.3, sigT: 0.22 }], ['困難', { sigO: 0.2, sigT: 0.14 }]]) {
    const c = { ok: 0, net: 0, out: 0, short: 0 }; let n = 0, curve = 0;
    for (const kind of ['drive', 'loop', 'spin', 'chop', 'drop', 'smash', 'lob']) {
      for (let i = 0; i < 400; i++) {
        const p0 = { x: (Math.random() - 0.5) * 1.2, y: 0.9, z: -1.4 };
        const r = simulateShot(p0, buildAiShot(kind, skill));
        c[r.result]++; n++; curve += r.curveCm;
      }
    }
    rows.push({ 難度: dn, 進: pct(c.ok, n), 掛網: pct(c.net, n), 出界: pct(c.out, n), 沒過: pct(c.short, n), 平均弧度cm: Math.round(curve / n) });
  }
  console.table(rows);
  const cnt = {};
  for (let i = 0; i < 2000; i++) { const k = pickAiKind({ hitY: 0.7 + Math.random() * 0.5, rally: Math.floor(Math.random() * 8), aggressive: 0.5 }); cnt[k] = (cnt[k] || 0) + 1; }
  console.log('AI 選球比例：', Object.entries(cnt).map(([k, v]) => `${KIND_NAME[k] || k} ${Math.round(v / 20)}%`).join('、'));
}

function serveTable() {
  console.log('\n══ 發球實驗：先落自己半桌再過網（擊球點偏差 σ=0.4，各 400 次）══');
  const rows = [];
  for (const [who, z0, sgn] of [['玩家發球', 2.65, -1], ['AI 發球', -2.65, 1]]) {
    const c = { ok: 0, net: 0, out: 0, short: 0, illegal: 0 };
    let minOwn = 9, maxOwn = 0, errSum = 0, errN = 0;
    for (let i = 0; i < 400; i++) {
      const p0 = { x: (Math.random() - 0.5) * 0.6, y: 1.05, z: z0 };
      const s = { dx: (Math.random() - 0.5) * 80, dy: -150, len: 150, dur: 150 + Math.random() * 100, curve: (Math.random() - 0.5) * 0.1 };
      s.speed = s.len / s.dur;
      let target;
      if (sgn < 0) {
        const shot = buildPlayerShot({ swipe: s, p0, isServe: true, contact: { ox: gauss() * 0.4, oy: gauss() * 0.4 } });
        target = shot.target; var spin = shot.spin;
      } else {
        const shot = buildAiShot(['drive', 'spin', 'loop', 'chop', 'drop'][i % 5], { sigO: 0.4, sigT: 0.3 });
        target = { ...shot.target, z: Math.max(0.4, Math.min(1.15, shot.target.z)) }; spin = shot.spin;
      }
      const r = solveServe(p0, target, spin);
      c[r.result]++;
      if (r.own) { minOwn = Math.min(minOwn, Math.abs(r.own.z)); maxOwn = Math.max(maxOwn, Math.abs(r.own.z)); }
      if (r.result === 'ok' && r.landing) { errSum += Math.hypot(r.landing.x - target.x, r.landing.z - target.z); errN++; }
    }
    rows.push({ 發球方: who, 合法進: pct(c.ok, 400), 掛網: pct(c.net, 400), 出界: pct(c.out, 400), 沒過: pct(c.short, 400), 沒先落己方: pct(c.illegal, 400),
      '自己半桌落點z': `${minOwn.toFixed(2)}~${maxOwn.toFixed(2)}`, '平均落點誤差cm': errN ? Math.round((errSum / errN) * 100) : '-' });
  }
  console.table(rows);
}

if (arg === 'compare') run('較早一版（太誇張）', OLD);
run('目前設定', arg === 'compare' ? { sideA: 4.5, topG: 3.0, bounceKick: 0.5, bounceTopK: 0.18 } : {});
timingTable();
contactGrid();
skillTable();
aiTable();
serveTable();
