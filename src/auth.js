// 登入：目前只有「遊客」。之後要加 Google 等登入時，只要在 PROVIDERS 多一個項目，
// 並把遊客資料綁定（link）到新的帳號，連線對戰與背包存檔都沿用同一個 id。
const KEY = 'pp.profile.v1';

export const PROVIDERS = {
  guest: { label: '遊客' },
  // google: { label: 'Google' },  // 之後確定好再加
};

function newId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); // 只有 https / localhost 可用
  } catch { /* 往下用備援 */ }
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function validProfile(p) {
  return p && typeof p === 'object' && typeof p.id === 'string' && typeof p.name === 'string' && p.id.length > 0;
}

/** 取得目前玩家資料；第一次開啟會自動建立遊客帳號（存在這支手機的瀏覽器裡）。 */
export function getProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (validProfile(p)) return { provider: 'guest', ...p, name: String(p.name).slice(0, 16) };
    }
  } catch { /* 資料壞掉就重建 */ }
  const p = {
    id: newId(),
    name: `Guest${Math.floor(1000 + Math.random() * 9000)}`,
    provider: 'guest',
    createdAt: Date.now(),
  };
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* 無痕模式等：每次開啟都是新遊客 */ }
  return p;
}

export function providerLabel(p) {
  return PROVIDERS[p.provider]?.label ?? '遊客';
}
