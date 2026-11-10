// 角色、球拍、球、場地效果：純資料 + 把它們換算成「擊球修正值」的函式。
// 設計原則：數值影響很小（大約 ±10–20%），遊戲體驗不能因為選錯角色就變差。

export const STAT_KEYS = ['pow', 'spn', 'ctl', 'tmg', 'rch'];
export const STAT_NAME = { pow: '力量', spn: '旋轉', ctl: '控球', tmg: '時機', rch: '範圍' };

/** 五項數值（1–10，5 = 標準）→ 擊球修正倍率。 */
export function statMods(st) {
  const c = (v) => Math.max(1, Math.min(12, v));
  return {
    push: 1 + 0.02 * (c(st.pow) - 5),   // 球速／推力 0.9–1.14
    spin: 1 + 0.05 * (c(st.spn) - 5),   // 旋轉強度 0.75–1.35
    err: 1 - 0.04 * (c(st.ctl) - 5),    // 擊球偏差（越小越穩）0.72–1.2
    free: 0.3 + 0.02 * (c(st.tmg) - 5), // 時機寬容區 0.2–0.44
    reach: 1 + 0.03 * (c(st.rch) - 5),  // 擊球圈大小 0.88–1.21
  };
}

// 技能：kind 'timed' = 啟動後持續 secs 秒；'next' = 只影響啟動後的下一球。
export const CHARACTERS = [
  {
    id: 'mochi', name: '麻糬君', role: '均衡型',
    stats: { pow: 5, spn: 5, ctl: 5, tmg: 5, rch: 5 },
    passive: { name: 'Q彈', desc: '連續完美擊球時，時機寬容區再放寬（最多 3 層）' },
    skill: { id: 'mochiShield', name: '麻糬護體', kind: 'timed', secs: 5, desc: '5 秒內，來球落桌後又高又慢，好接' },
    look: { skin: '#fff1e0', shirt: '#ffffff', pants: '#9bb5d6', hair: '#e7d6b8', band: '#ffb3c7', headScale: 1.7, eyeSize: 0.08, eyeGap: 0.15, eyeAsym: 1, mouthW: 0.14, mouthOpen: 0, paddleColor: '#d62828', hat: 'none', glasses: 'none', shirtStyle: 'plain' },
  },
  {
    id: 'whirl', name: '旋風大叔', role: '旋轉大師',
    stats: { pow: 4, spn: 10, ctl: 5, tmg: 4, rch: 4 },
    passive: { name: '旋轉達人', desc: '側旋更強（約 +20%）' },
    skill: { id: 'tornado', name: '龍捲風', kind: 'next', desc: '下一球帶強烈側旋，落桌後橫向跳開' },
    look: { skin: '#e8b98f', shirt: '#2a9d8f', pants: '#264653', hair: '#222222', band: '#f2b134', headScale: 1.45, eyeSize: 0.1, eyeGap: 0.17, eyeAsym: 1.4, mouthW: 0.2, mouthOpen: 1, paddleColor: '#2a9d8f', hat: 'beanie', glasses: 'round', shirtStyle: 'stripes' },
  },
  {
    id: 'granny', name: '鐵拳阿嬤', role: '殺球',
    stats: { pow: 10, spn: 3, ctl: 4, tmg: 4, rch: 5 },
    passive: { name: '鐵拳', desc: '殺球速度 +12%' },
    skill: { id: 'roar', name: '奶奶的怒吼', kind: 'next', desc: '下一球一定是殺球，對手更容易接不到' },
    look: { skin: '#f4d6c0', shirt: '#e76f51', pants: '#6b2b2b', hair: '#d9d9d9', band: '#e63946', headScale: 1.6, eyeSize: 0.06, eyeGap: 0.12, eyeAsym: 0.8, mouthW: 0.12, mouthOpen: 0, paddleColor: '#8d0801', hat: 'none', glasses: 'round', shirtStyle: 'dots' },
  },
  {
    id: 'robo', name: '小冷機器人', role: '精準控球',
    stats: { pow: 5, spn: 3, ctl: 10, tmg: 6, rch: 4 },
    passive: { name: '精密校準', desc: '擊球偏差再小 15%' },
    skill: { id: 'laser', name: '雷射校準', kind: 'timed', secs: 5, desc: '5 秒內，球一定落在你滑動指的位置' },
    look: { skin: '#b8c4d0', shirt: '#3a4a5c', pants: '#1d2530', hair: '#7aa2c7', band: '#4cc9f0', headScale: 1.5, eyeSize: 0.12, eyeGap: 0.1, eyeAsym: 1, mouthW: 0.08, mouthOpen: 0, paddleColor: '#4cc9f0', hat: 'headphones', glasses: 'shades', shirtStyle: 'plain' },
  },
  {
    id: 'ninja', name: '忍者切切', role: '切球防守',
    stats: { pow: 3, spn: 7, ctl: 8, tmg: 5, rch: 5 },
    passive: { name: '影之切球', desc: '切球的下旋更強（約 +25%）' },
    skill: { id: 'smoke', name: '煙霧彈', kind: 'next', desc: '下一球之後，對手的回球更容易失誤' },
    look: { skin: '#e0b88f', shirt: '#222831', pants: '#222831', hair: '#111111', band: '#c1121f', headScale: 1.35, eyeSize: 0.05, eyeGap: 0.15, eyeAsym: 1, mouthW: 0.06, mouthOpen: 0, paddleColor: '#222222', hat: 'none', glasses: 'none', shirtStyle: 'plain' },
  },
  {
    id: 'spring', name: '彈簧小子', role: '時機寬容',
    stats: { pow: 4, spn: 4, ctl: 4, tmg: 10, rch: 6 },
    passive: { name: '彈跳', desc: '時機寬容區再加寬' },
    skill: { id: 'bounce', name: '彈跳步', kind: 'timed', secs: 5, desc: '5 秒內，擊球圈變大、時機更寬' },
    look: { skin: '#ffd9b3', shirt: '#7bd389', pants: '#f4a261', hair: '#cc3333', band: '#ffffff', headScale: 1.55, eyeSize: 0.12, eyeGap: 0.2, eyeAsym: 1.2, mouthW: 0.22, mouthOpen: 1, paddleColor: '#7bd389', hat: 'cap', glasses: 'none', shirtStyle: 'stripes' },
  },
  {
    id: 'lady', name: '吊球貴婦', role: '欺敵吊球',
    stats: { pow: 2, spn: 6, ctl: 8, tmg: 6, rch: 6 },
    passive: { name: '貼網吊球', desc: '吊球落得更靠近球網' },
    skill: { id: 'fancyDrop', name: '花式吊球', kind: 'next', desc: '下一球是吊球，先往一邊飄，落桌後往反方向跳' },
    look: { skin: '#ffdcc2', shirt: '#f72585', pants: '#7209b7', hair: '#6b3fa0', band: '#ffd6e8', headScale: 1.45, eyeSize: 0.075, eyeGap: 0.14, eyeAsym: 1, mouthW: 0.15, mouthOpen: 0, paddleColor: '#f72585', hat: 'crown', glasses: 'star', shirtStyle: 'dots' },
  },
  {
    id: 'rampage', name: '爆走阿伯', role: '高風險高報酬',
    stats: { pow: 9, spn: 8, ctl: 2, tmg: 3, rch: 4 },
    passive: { name: '一往無前', desc: '力量與旋轉再各 +6%，但更容易失誤' },
    skill: { id: 'rage', name: '暴走', kind: 'timed', secs: 5, desc: '5 秒內力量與旋轉大增，但準度變差' },
    look: { skin: '#c68642', shirt: '#e63946', pants: '#222222', hair: '#cc3333', band: '#222222', headScale: 1.8, eyeSize: 0.13, eyeGap: 0.22, eyeAsym: 1.7, mouthW: 0.26, mouthOpen: 1, paddleColor: '#e63946', hat: 'none', glasses: 'shades', shirtStyle: 'plain' },
  },
  {
    id: 'ghost', name: '幽靈小白', role: '隱形球',
    stats: { pow: 5, spn: 6, ctl: 6, tmg: 5, rch: 5 },
    passive: { name: '飄忽', desc: '對手回球更容易失誤（小幅）' },
    skill: { id: 'invisible', name: '隱形球', kind: 'next', desc: '下一球過網後隱形到落桌，對手更容易接不到' },
    look: { skin: '#f2f5ff', shirt: '#cfd8ff', pants: '#aab4e8', hair: '#ffffff', band: '#9aa7ff', headScale: 1.65, eyeSize: 0.14, eyeGap: 0.12, eyeAsym: 1, mouthW: 0.1, mouthOpen: 1, paddleColor: '#9aa7ff', hat: 'none', glasses: 'none', shirtStyle: 'dots' },
  },
  {
    id: 'octo', name: '章魚老闆', role: '守備範圍王',
    stats: { pow: 4, spn: 4, ctl: 5, tmg: 5, rch: 10 },
    passive: { name: '八隻手', desc: '擊球圈再大 12%' },
    skill: { id: 'eightArms', name: '八爪連擊', kind: 'timed', secs: 5, desc: '5 秒內，擊球圈變成兩倍大' },
    look: { skin: '#c3a3e8', shirt: '#ffd23f', pants: '#5a3d8a', hair: '#8338ec', band: '#ff9f1c', headScale: 1.9, eyeSize: 0.1, eyeGap: 0.17, eyeAsym: 1.1, mouthW: 0.18, mouthOpen: 0, paddleColor: '#8338ec', hat: 'tophat', glasses: 'none', shirtStyle: 'stripes' },
  },
];
export const DEFAULT_CHARACTER = 'mochi';
export const charById = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];

// 球拍：用「數值加減」表示（單位＝1 點），顏色會套到球拍上。
export const RACKETS = [
  { id: 'std', name: '標準木拍', desc: '沒有加成', d: {}, color: null },
  { id: 'attack', name: '進攻碳纖拍', desc: '力量 +2、控球 −1', d: { pow: 2, ctl: -1 }, color: '#1f2933' },
  { id: 'defense', name: '防守長顆粒拍', desc: '旋轉 +1、控球 +1、力量 −1', d: { spn: 1, ctl: 1, pow: -1 }, color: '#2a9d8f' },
  { id: 'spin', name: '旋轉膠皮拍', desc: '旋轉 +2、時機 −1', d: { spn: 2, tmg: -1 }, color: '#e63946' },
  { id: 'control', name: '控制拍', desc: '控球 +2、力量 −1', d: { ctl: 2, pow: -1 }, color: '#4cc9f0' },
  { id: 'pan', name: '平底鍋（搞笑）', desc: '力量 +3、控球 −3、範圍 +1', d: { pow: 3, ctl: -3, rch: 1 }, color: '#3a3f47' },
  { id: 'swatter', name: '蒼蠅拍（搞笑）', desc: '範圍 +3、力量 −2', d: { rch: 3, pow: -2 }, color: '#7bd389' },
  { id: 'rainbow', name: '彩虹魔法拍（稀有）', desc: '全部 +1', d: { pow: 1, spn: 1, ctl: 1, tmg: 1, rch: 1 }, color: '#c77dff' },
];
export const DEFAULT_RACKET = 'std';
export const racketById = (id) => RACKETS.find((r) => r.id === id) || RACKETS[0];

// 球：gravity／rest（彈性）／push／spin／err／reach 都是小幅倍率或加減；scale 與 color 只影響外觀。
export const BALLS = [
  { id: 'std', name: '標準白球', desc: '沒有加成', fx: {}, color: '#fff6dc', scale: 1 },
  { id: 'lead', name: '鉛球', desc: '飛得慢一點，落桌後衝得快', fx: { push: 0.95, slide: 1.08 }, color: '#9aa4b2', scale: 1 },
  { id: 'bubble', name: '泡泡球', desc: '會飄、旋轉效果 +15%', fx: { gravity: 0.88, spin: 1.15 }, color: '#bfe9ff', scale: 1.05 },
  { id: 'spring', name: '彈力球', desc: '落桌彈得更高', fx: { rest: 0.97 }, color: '#7bd389', scale: 1 },
  { id: 'fire', name: '火球', desc: '球速 +6%，但偏差大一點', fx: { push: 1.06, err: 1.1 }, color: '#ff7a3d', scale: 1 },
  { id: 'melon', name: '西瓜球', desc: '球大好打（範圍 +10%），但慢 8%', fx: { push: 0.92, reach: 1.1 }, color: '#4caf50', scale: 1.5 },
  { id: 'ghost', name: '幽靈球（稀有）', desc: '飛行中忽隱忽現', fx: {}, color: '#dfe6ff', scale: 1, blink: true },
];
export const DEFAULT_BALL = 'std';
export const ballById = (id) => BALLS.find((b) => b.id === id) || BALLS[0];

/** 角色數值 + 球拍加減 → 最終五項數值。 */
export function finalStats(char, racket) {
  const out = { ...char.stats };
  for (const k of STAT_KEYS) out[k] = Math.max(1, Math.min(12, out[k] + (racket.d[k] || 0)));
  return out;
}

/** 這個角色／球拍／球的「基礎修正」：整場比賽不變的部分。 */
export function baseMods(char, racket, ball) {
  const m = statMods(finalStats(char, racket));
  const f = ball.fx || {};
  m.push *= f.push ?? 1;
  m.spin *= f.spin ?? 1;
  m.err *= f.err ?? 1;
  m.reach *= f.reach ?? 1;
  m.slide = f.slide ?? 1;
  m.gravity = f.gravity ?? 1;
  m.rest = f.rest ?? 0.9;
  // 角色被動（常駐，數值都很小）
  switch (char.id) {
    case 'whirl': m.sideSpin = 1.2; break;
    case 'granny': m.smashPush = 1.12; break;
    case 'robo': m.err *= 0.85; break;
    case 'ninja': m.chopSpin = 1.25; break;
    case 'spring': m.free += 0.08; break;
    case 'lady': m.dropDepth = 0.8; break;
    case 'rampage': m.push *= 1.06; m.spin *= 1.06; m.err *= 1.1; break;
    case 'ghost': m.aiMiss = 0.05; break;
    case 'octo': m.reach *= 1.12; break;
    default: break;
  }
  return m;
}

// 場地效果（都很溫和）：gravity 倍率、wind 風（m/s²，來回吹）、slide 落桌後的滑行倍率
export const ARENA_FX = {
  gym: {},
  neon: {},
  beach: { wind: 0.7, desc: '海風：橫風會慢慢換方向，球會被吹偏一點' },
  space: { gravity: 0.82, desc: '低重力：球飛得更高更久' },
  ice: { slide: 1.07, desc: '滑桌面：球落桌後跑得更快' },
};
