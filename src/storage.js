// 本機存檔（之後會換成 Firebase 雲端存檔，介面維持一樣）。
import { DEFAULT_CONFIG, sanitizeConfig } from './character.js';

const KEY = 'pp.character.v1';

// 每個角色各自存一份外觀（沒改過就用角色預設外觀）
export function loadConfig(id = 'default', fallback = DEFAULT_CONFIG) {
  try {
    const raw = localStorage.getItem(`${KEY}.${id}`);
    return raw ? sanitizeConfig(JSON.parse(raw), fallback) : sanitizeConfig(fallback, DEFAULT_CONFIG);
  } catch {
    return sanitizeConfig(fallback, DEFAULT_CONFIG);
  }
}

export function saveConfig(cfg, id = 'default') {
  try { localStorage.setItem(`${KEY}.${id}`, JSON.stringify(cfg)); } catch { /* 無痕模式等情況：略過 */ }
}

// 其他簡單偏好設定（場地、難度等）
export function loadPref(key, fallback) {
  try { return localStorage.getItem('pp.' + key) ?? fallback; } catch { return fallback; }
}
export function savePref(key, value) {
  try { localStorage.setItem('pp.' + key, String(value)); } catch { /* 略過 */ }
}
