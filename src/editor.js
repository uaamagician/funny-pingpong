import { RANGES, COLOR_KEYS, DEFAULT_CONFIG, HATS, GLASSES, SHIRTS, randomConfig, sanitizeConfig } from './character.js';

/**
 * 角色編輯面板。cfg 變動時呼叫 onChange(cfg)；按「完成」呼叫 onClose(cfg)。
 */
export function createEditor(root, { getConfig, onChange, onClose }) {
  let cfg = getConfig();

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function render() {
    root.replaceChildren();
    const sheet = el('div', 'sheet');

    const face = el('div', 'sec');
    face.append(el('h3', null, '臉與頭'));
    for (const [key, [min, max, step, label]] of Object.entries(RANGES)) {
      const row = el('label', 'row');
      row.append(el('span', null, label));
      const input = el('input');
      Object.assign(input, { type: 'range', min, max, step, value: cfg[key] });
      input.addEventListener('input', () => { cfg[key] = Number(input.value); onChange(cfg); });
      row.append(input);
      face.append(row);
    }
    const mouth = el('label', 'row');
    mouth.append(el('span', null, '張大嘴'));
    const chk = el('input');
    chk.type = 'checkbox';
    chk.checked = !!cfg.mouthOpen;
    chk.addEventListener('change', () => { cfg.mouthOpen = chk.checked ? 1 : 0; onChange(cfg); });
    mouth.append(chk);
    face.append(mouth);
    sheet.append(face);

    // 配件：帽子、眼鏡、上衣花紋（點選項即時套用）
    const acc = el('div', 'sec');
    acc.append(el('h3', null, '配件'));
    for (const [key, label, list] of [['hat', '帽子', HATS], ['glasses', '眼鏡', GLASSES], ['shirtStyle', '上衣', SHIRTS]]) {
      const row = el('div', 'row chips');
      row.append(el('span', null, label));
      const wrap = el('div', 'chipwrap');
      for (const [val, name] of list) {
        const b = el('button', 'chip' + (cfg[key] === val ? ' on' : ''), name);
        b.type = 'button';
        b.addEventListener('click', () => {
          cfg[key] = val;
          onChange(cfg);
          wrap.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b));
        });
        wrap.append(b);
      }
      row.append(wrap);
      acc.append(row);
    }
    sheet.append(acc);

    const colors = el('div', 'sec');
    colors.append(el('h3', null, '服飾與顏色'));
    for (const [key, [label, palette]] of Object.entries(COLOR_KEYS)) {
      const row = el('div', 'row sw');
      row.append(el('span', null, label));
      const wrap = el('div', 'swatches');
      for (const c of palette) {
        const b = el('button', 'swatch' + (cfg[key].toLowerCase() === c ? ' on' : ''));
        b.type = 'button';
        b.style.background = c;
        b.setAttribute('aria-label', `${label} ${c}`);
        b.addEventListener('click', () => {
          cfg[key] = c;
          onChange(cfg);
          wrap.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === b));
        });
        wrap.append(b);
      }
      row.append(wrap);
      colors.append(row);
    }
    sheet.append(colors);

    const bar = el('div', 'bar');
    const rand = el('button', 'btn small alt', '隨機');
    rand.addEventListener('click', () => { cfg = sanitizeConfig({ ...randomConfig() }); onChange(cfg); render(); });
    const reset = el('button', 'btn small gray', '重設');
    reset.addEventListener('click', () => { cfg = { ...DEFAULT_CONFIG }; onChange(cfg); render(); });
    const done = el('button', 'btn small', '完成');
    done.addEventListener('click', () => onClose(cfg));
    bar.append(rand, reset, done);
    sheet.append(bar);

    root.append(sheet);
  }

  return {
    open() { cfg = getConfig(); render(); root.classList.remove('hidden'); },
    close() { root.classList.add('hidden'); },
  };
}
