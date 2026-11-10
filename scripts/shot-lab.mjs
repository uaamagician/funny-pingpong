// 擊球實驗室：不開瀏覽器，直接把各種滑動 × 來球位置 × 時機丟進擊球模型，
// 看球種、落點、弧度（側偏）、球速、過網高度。用法：npm run lab
import { TUNE } from '../src/tuning.js';
import { buildPlayerShot, simulateShot, handOf, timingInfo, buildAiShot, pickAiKind, KIND_NAME } from '../src/shots.js';

const OLD = { sideA: 8, topG: 4.5, bounceKick: 1.0, bounceTopK: 0.25 }; // 上一版（太誇張）的數值
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
const fixed = () => 0.5; // 去掉隨機，結果才能重現

function run(title, tune) {
  Object.assign(TUNE, tune);
  console.log(`\n══ ${title}  (sideA=${TUNE.sideA} topG=${TUNE.topG} kick=${TUNE.bounceKick}) ══`);
  const rows = [];
  for (const [sn, s] of Object.entries(swipes)) {
    for (const [bn, bx, by] of [['右側高球', 0.5, 1.1], ['中間中球', 0.0, 0.92], ['左側中球', -0.5, 0.92], ['左側低球', -0.5, 0.72]]) {
      const bodyX = 0.6 * bx;
      const hand = handOf(bx, bodyX);
      const p0 = { x: bx, y: by, z: TUNE.idealZ };
      const shot = buildPlayerShot({ swipe: s, p0, hand, timingOff: 0, acc: 1, rand: fixed });
      const r = simulateShot(p0, shot);
      rows.push({ 滑動: sn, 來球: bn, 球種: shot.label, 落點: r.landing ? r.landing.zone : (r.hitNet ? '掛網' : '出界'),
        '球速km/h': Math.round(r.speed * 3.6), 弧度cm: r.curveCm, 彈後偏cm: r.bounceShiftCm,
        上下旋: shot.spin.top.toFixed(2), 側旋: shot.spin.side.toFixed(2) });
    }
  }
  console.table(rows);
  const ok = rows.filter((r) => r.落點 !== '掛網' && r.落點 !== '出界').length;
  const maxCurve = Math.max(...rows.map((r) => r.弧度cm));
  console.log(`上桌率 ${ok}/${rows.length}　最大飛行弧度 ${maxCurve} cm　最大彈起偏移 ${Math.max(...rows.map((r) => Math.abs(r.彈後偏cm)))} cm`);
  return { ok, n: rows.length, maxCurve };
}

function timingTable() {
  console.log('\n══ 時機實驗（中速直滑、中間中球、正手）══');
  const rows = [];
  for (const z of [0.7, 1.0, 1.25, 1.45, 1.7, 2.0, 2.4]) {
    const t = timingInfo(z);
    const p0 = { x: 0, y: 0.92, z };
    const shot = buildPlayerShot({ swipe: swipes['中速直滑'], p0, hand: 'FH', timingOff: t.off, acc: 1, rand: fixed });
    const r = simulateShot(p0, shot);
    rows.push({ 球離網z: z, 時機: t.name, 球種: shot.label, 落點: r.landing ? `${r.landing.zone}(x=${r.landing.x.toFixed(2)})` : (r.hitNet ? '掛網' : '出界'),
      '球速km/h': Math.round(r.speed * 3.6), 上旋: shot.spin.top.toFixed(2) });
  }
  console.table(rows);
}

function handTable() {
  console.log('\n══ 正手 vs 反手（中速直滑 / 快速猛滑，同一顆中球）══');
  const rows = [];
  for (const [sn, s] of [['中速直滑', swipes['中速直滑']], ['快速猛滑', swipes['快速猛滑']], ['向下切', swipes['向下切']]]) {
    for (const hand of ['FH', 'BH']) {
      const p0 = { x: hand === 'FH' ? 0.4 : -0.4, y: 1.05, z: TUNE.idealZ };
      const shot = buildPlayerShot({ swipe: s, p0, hand, timingOff: 0, acc: 1, rand: fixed });
      const r = simulateShot(p0, shot);
      rows.push({ 滑動: sn, 手: hand === 'FH' ? '正手' : '反手', 球種: shot.label, '球速km/h': Math.round(r.speed * 3.6),
        上下旋: shot.spin.top.toFixed(2), 落點: r.landing ? r.landing.zone : '失誤' });
    }
  }
  console.table(rows);
}

function aiTable() {
  console.log('\n══ AI 各球種（各 300 次隨機，球從對手半邊打向你）══');
  const rows = [];
  for (const kind of ['drive', 'loop', 'spin', 'chop', 'drop', 'smash', 'lob']) {
    let ok = 0, curve = 0, spd = 0, shift = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
      const p0 = { x: (Math.random() - 0.5) * 1.2, y: 0.9, z: -1.4 };
      const shot = buildAiShot(kind, 0.3);
      const r = simulateShot(p0, shot);
      if (r.onTable) ok++;
      curve += r.curveCm; spd += r.speed * 3.6; shift += Math.abs(r.bounceShiftCm);
    }
    rows.push({ 球種: kind, 上桌率: `${Math.round((ok / N) * 100)}%`, '平均球速km/h': Math.round(spd / N), 平均弧度cm: Math.round(curve / N), 平均彈後偏cm: Math.round(shift / N) });
  }
  console.table(rows);
  // 球種分布
  const cnt = {};
  for (let i = 0; i < 2000; i++) { const k = pickAiKind({ hitY: 0.7 + Math.random() * 0.5, rally: Math.floor(Math.random() * 8), aggressive: 0.5 }); cnt[k] = (cnt[k] || 0) + 1; }
  console.log('AI 選球比例：', Object.entries(cnt).map(([k, v]) => `${KIND_NAME[k] || k} ${Math.round(v / 20)}%`).join('、'));
}

if (arg === 'compare') { run('上一版（太誇張）', OLD); }
run('目前設定', arg === 'compare' ? { sideA: 4.5, topG: 3.0, bounceKick: 0.5, bounceTopK: 0.18 } : {});
timingTable();
handTable();
aiTable();
