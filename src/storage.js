// 本機存檔（之後會換成 Firebase 雲端存檔，介面維持一樣）。
import { DEFAULT_CONFIG, sanitizeConfig } from './character.js';

const KEY = 'pp.character.v1';

export function loadConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitizeConfig(JSON.parse(raw)) : { ...DEFAULT_CONFIG };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg) {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* 無痕模式等情況：略過 */ }
}
