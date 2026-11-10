// 極簡 WebAudio 音效（不需要音檔）。需要在第一次點擊後才能發聲。
let ctx = null;

export function unlockAudio() {
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* 沒有音效也能玩 */ }
}

function tone(freq, dur, type = 'square', vol = 0.08, slide = 0) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur);
}

export const sfx = {
  hit: (m = 1) => tone(620 * m, 0.08, 'triangle', 0.14, -260 * m), // m > 1：連續完美時音調越來越高
  smash: () => { tone(180, 0.18, 'sawtooth', 0.14, -90); tone(900, 0.1, 'square', 0.08, -500); },
  bounce: () => tone(240, 0.05, 'sine', 0.12, -60),
  net: () => tone(110, 0.14, 'square', 0.1, -40),
  whoosh: () => tone(400, 0.12, 'sawtooth', 0.04, -250),
  point: () => { tone(660, 0.1, 'square', 0.07); setTimeout(() => tone(880, 0.16, 'square', 0.07), 90); },
  lose: () => { tone(300, 0.15, 'square', 0.07, -80); setTimeout(() => tone(200, 0.25, 'square', 0.07, -80), 120); },
};
