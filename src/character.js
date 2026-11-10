import * as THREE from 'three';

// 搞笑抽象角色：全部由程式用基本幾何體組出來。
// 所有外觀都來自一份 config（之後的角色編輯器、寶箱造型、存檔都用這份 JSON）。

export const DEFAULT_CONFIG = {
  skin: '#ffd9b3',
  shirt: '#ff4f8b',
  pants: '#2b2d6e',
  hair: '#2a1a12',
  band: '#ffd23f',
  headScale: 1.5,   // 頭大小倍率
  eyeSize: 0.085,   // 眼睛大小
  eyeGap: 0.15,     // 眼距
  eyeAsym: 1.0,     // 右眼相對左眼的大小倍率（>1 就是大小眼）
  mouthW: 0.17,     // 嘴巴寬度
  mouthOpen: 0.0,   // 0 = 微笑線條，1 = 大張嘴
  paddleColor: '#d62828',
  hat: 'none',        // 帽子：none / cap / beanie / crown / tophat / headphones
  glasses: 'none',    // 眼鏡：none / round / shades / star
  shirtStyle: 'plain', // 上衣花紋：plain / stripes / dots
  racket: 'std',      // 球拍外型（由出賽準備的球拍決定）
};

// 造型選項（編輯器與存檔驗證共用）：[值, 顯示名稱]
export const HATS = [['none', '無'], ['cap', '鴨舌帽'], ['beanie', '毛帽'], ['crown', '皇冠'], ['tophat', '紳士帽'], ['headphones', '耳機']];
export const GLASSES = [['none', '無'], ['round', '圓框'], ['shades', '墨鏡'], ['star', '星星']];
export const SHIRTS = [['plain', '素色'], ['stripes', '條紋'], ['dots', '圓點']];

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function randomConfig() {
  return {
    skin: pick(['#ffd9b3', '#f1c27d', '#c68642', '#8d5524', '#b5e8a8', '#a8d8ff']),
    shirt: pick(['#4cc9f0', '#f72585', '#7bd389', '#ff9f1c', '#9b5de5']),
    pants: pick(['#2b2d6e', '#222', '#6b2b2b', '#0b5d4b']),
    hair: pick(['#2a1a12', '#e0b050', '#cc3333', '#3a3aff', '#222']),
    band: pick(['#ffd23f', '#ffffff', '#00e5a0']),
    headScale: rnd(1.3, 1.9),
    eyeSize: rnd(0.06, 0.13),
    eyeGap: rnd(0.1, 0.2),
    eyeAsym: rnd(0.6, 1.7),
    mouthW: rnd(0.1, 0.24),
    mouthOpen: Math.random() < 0.4 ? 1 : 0,
    paddleColor: pick(['#2a9d8f', '#e76f51', '#264653', '#8338ec']),
    hat: pick(HATS)[0],
    glasses: pick(GLASSES)[0],
    shirtStyle: pick(SHIRTS)[0],
    racket: 'std',
  };
}

const UP = new THREE.Vector3(0, 1, 0);
// 卡通風：三階色調 + 黑色描邊（反向外殼法）
let _grad = null;
function gradient() {
  if (!_grad) {
    _grad = new THREE.DataTexture(new Uint8Array([110, 180, 255]), 3, 1, THREE.RedFormat);
    _grad.minFilter = _grad.magFilter = THREE.NearestFilter;
    _grad.needsUpdate = true;
  }
  return _grad;
}
const mat = (color) => new THREE.MeshToonMaterial({ color, gradientMap: gradient() });
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x120a28, side: THREE.BackSide });
function outlineAll(root) {
  const list = [];
  root.traverse((o) => { if (o.isMesh && !o.userData.outline) list.push(o); });
  for (const m of list) {
    m.castShadow = true;
    const o = new THREE.Mesh(m.geometry, outlineMat);
    o.scale.setScalar(1.07);
    o.userData.outline = true;
    m.add(o);
  }
}

/** 角色預設面向 +z。玩家會轉 180° 面向球網。 */
export function buildCharacter(cfg = DEFAULT_CONFIG) {
  const group = new THREE.Group();
  const body = new THREE.Group(); // 會上下彈跳的部分
  group.add(body);

  // 腿（細麵條）+ 腳
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.6, 8), mat(cfg.pants));
    leg.position.set(s * 0.1, 0.32, 0);
    group.add(leg);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), mat('#f5f5f5'));
    foot.scale.set(1, 0.55, 1.5);
    foot.position.set(s * 0.1, 0.04, 0.05);
    group.add(foot);
  }

  // 身體（小小一顆）
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.3, 6, 12), mat(cfg.shirt));
  torso.position.y = 0.88;
  body.add(torso);

  // 頭
  const headR = 0.28 * cfg.headScale;
  const head = new THREE.Group();
  head.position.y = 1.12 + headR * 0.9;
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(headR, 24, 18), mat(cfg.skin));
  head.add(skull);

  // 眼睛（可大小眼）
  const faceZ = (r, x, y) => Math.sqrt(Math.max(0, r * r - x * x - y * y));
  const eyeY = headR * 0.15;
  const eyes = [];
  [-1, 1].forEach((s) => {
    const er = cfg.eyeSize * (s > 0 ? cfg.eyeAsym : 1) * cfg.headScale * 0.9;
    const ex = s * cfg.eyeGap * cfg.headScale;
    const white = new THREE.Mesh(new THREE.SphereGeometry(er, 14, 12), mat('#ffffff'));
    white.position.set(ex, eyeY, faceZ(headR, ex, eyeY) * 0.97);
    head.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(er * 0.45, 10, 8), mat('#111'));
    pupil.position.set(ex + s * er * 0.1, eyeY, white.position.z + er * 0.75);
    head.add(pupil);
    eyes.push({ ex, er, z: white.position.z });
  });

  // 嘴巴
  const mouthY = -headR * 0.38;
  const mw = cfg.mouthW * cfg.headScale;
  if (cfg.mouthOpen > 0.5) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(mw * 0.6, 12, 10), mat('#5a0a1a'));
    m.scale.set(1, 0.7, 0.3);
    m.position.set(0, mouthY, faceZ(headR, 0, mouthY) * 0.98);
    head.add(m);
  } else {
    const m = new THREE.Mesh(new THREE.TorusGeometry(mw * 0.7, 0.014, 6, 16, Math.PI), mat('#7a1020'));
    m.rotation.z = Math.PI;
    m.position.set(0, mouthY + mw * 0.3, faceZ(headR, 0, mouthY) * 0.98);
    head.add(m);
  }

  // 頭帶
  const band = new THREE.Mesh(new THREE.TorusGeometry(headR * 0.98, 0.035, 8, 28), mat(cfg.band));
  band.rotation.x = Math.PI / 2;
  band.position.y = headR * 0.55;
  band.scale.set(1, 1, 0.9);
  head.add(band);

  addGlasses(head, cfg.glasses, eyes, eyeY);
  addHat(head, cfg, headR);
  addShirtStyle(body, cfg);

  // 一撮呆毛
  if (!cfg.hat || cfg.hat === 'none') {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 8), mat(cfg.hair));
    tuft.position.set(0.04, headR + 0.07, 0);
    tuft.rotation.z = -0.4;
    head.add(tuft);
  }

  // 肩膀位置（本地座標）給「橡皮手臂」使用
  const shoulder = new THREE.Object3D();
  shoulder.position.set(-0.2, 1.02, 0); // 本地 -x；玩家轉 180° 後會出現在畫面右邊
  group.add(shoulder);

  // 另一隻手：自然垂下
  const idleArm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8), mat(cfg.skin));
  idleArm.position.set(0.24, 0.85, 0.02);
  idleArm.rotation.z = 0.18;
  group.add(idleArm);

  // 球拍手臂（會被拉長的圓柱）
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), mat(cfg.skin));
  group.add(arm); // 之後會移到 scene 層級由 stretchArm 以世界座標更新

  // 球拍（外型由 cfg.racket 決定）
  const paddle = buildPaddle(cfg.racket || 'std', cfg.paddleColor);

  outlineAll(group);
  outlineAll(paddle);
  return { group, body, head, shoulder, arm, paddle, cfg };
}

// ───────────────────────── 配件：帽子、眼鏡、上衣花紋 ─────────────────────────
const gold = () => new THREE.MeshToonMaterial({ color: '#ffcf33', gradientMap: gradient() });
function addHat(head, cfg, headR) {
  const kind = cfg.hat;
  if (!kind || kind === 'none') return;
  const add = (m) => { head.add(m); return m; };
  if (kind === 'cap') {
    const R = headR * 1.05, th = 1.05;
    add(new THREE.Mesh(new THREE.SphereGeometry(R, 24, 12, 0, Math.PI * 2, 0, th), mat(cfg.band)));
    const rimR = R * Math.sin(th), rimY = R * Math.cos(th);
    const brim = add(new THREE.Mesh(new THREE.BoxGeometry(headR * 1.15, 0.028, headR * 0.8), mat(cfg.band)));
    brim.position.set(0, rimY - 0.01, rimR + headR * 0.28);
    brim.rotation.x = 0.12;
  } else if (kind === 'beanie') {
    const R = headR * 1.1, th = 1.15;
    add(new THREE.Mesh(new THREE.SphereGeometry(R, 24, 12, 0, Math.PI * 2, 0, th), mat(cfg.shirt)));
    const cuff = add(new THREE.Mesh(new THREE.TorusGeometry(R * Math.sin(th), headR * 0.07, 8, 28), mat(cfg.band)));
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = R * Math.cos(th);
    add(new THREE.Mesh(new THREE.SphereGeometry(headR * 0.16, 12, 10), mat(cfg.band))).position.y = R + headR * 0.08;
  } else if (kind === 'crown') {
    const base = add(new THREE.Mesh(new THREE.CylinderGeometry(headR * 0.62, headR * 0.7, headR * 0.22, 20, 1, true), gold()));
    base.position.y = headR * 0.96;
    base.material.side = THREE.DoubleSide;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const spike = add(new THREE.Mesh(new THREE.ConeGeometry(headR * 0.1, headR * 0.3, 8), gold()));
      spike.position.set(Math.sin(a) * headR * 0.66, headR * 1.18, Math.cos(a) * headR * 0.66);
    }
  } else if (kind === 'tophat') {
    const dark = new THREE.MeshToonMaterial({ color: '#1b1f2a', gradientMap: gradient() });
    add(new THREE.Mesh(new THREE.CylinderGeometry(headR * 0.5, headR * 0.5, headR * 0.7, 22), dark)).position.y = headR * 1.3;
    add(new THREE.Mesh(new THREE.CylinderGeometry(headR * 0.88, headR * 0.88, 0.03, 26), dark)).position.y = headR * 0.95;
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(headR * 0.51, 0.025, 6, 22), mat(cfg.band)));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = headR * 1.02;
  } else if (kind === 'headphones') {
    const arc = add(new THREE.Mesh(new THREE.TorusGeometry(headR * 1.04, 0.04, 8, 28, Math.PI), new THREE.MeshToonMaterial({ color: '#2b2f3a', gradientMap: gradient() })));
    arc.position.y = 0;
    for (const s of [-1, 1]) {
      const cup = add(new THREE.Mesh(new THREE.CylinderGeometry(headR * 0.26, headR * 0.26, headR * 0.2, 16), mat(cfg.band)));
      cup.rotation.z = Math.PI / 2;
      cup.position.set(s * headR * 1.04, 0, 0);
    }
  }
}
function starShape(r) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    if (i === 0) sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  sh.closePath();
  return sh;
}
function addGlasses(head, kind, eyes, eyeY) {
  if (!kind || kind === 'none') return;
  const dark = new THREE.MeshToonMaterial({ color: '#15171c', gradientMap: gradient() });
  for (const e of eyes) {
    const z = e.z + e.er * 0.9;
    let m;
    if (kind === 'round') {
      m = new THREE.Mesh(new THREE.TorusGeometry(e.er * 1.2, 0.014, 8, 24), dark);
    } else if (kind === 'shades') {
      m = new THREE.Mesh(new THREE.SphereGeometry(e.er * 1.1, 14, 10), dark);
      m.scale.set(1.12, 0.72, 0.28);
    } else {
      m = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(e.er * 1.7), { depth: 0.02, bevelEnabled: false }), gold());
    }
    m.position.set(e.ex, eyeY, kind === 'shades' ? z + e.er * 0.2 : z);
    head.add(m);
  }
  if (eyes.length === 2) { // 鼻樑
    const gap = Math.abs(eyes[1].ex - eyes[0].ex) - eyes[0].er * 1.2 - eyes[1].er * 1.2;
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, Math.max(0.02, gap), 6), dark);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, eyeY, (eyes[0].z + eyes[1].z) / 2 + eyes[0].er * 0.9);
    head.add(bridge);
  }
}
function addShirtStyle(body, cfg) {
  if (cfg.shirtStyle === 'stripes') {
    const c = new THREE.Color(cfg.shirt).lerp(new THREE.Color('#ffffff'), 0.6);
    for (const y of [0.78, 0.87, 0.96]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.172, 0.014, 6, 24), new THREE.MeshToonMaterial({ color: c, gradientMap: gradient() }));
      t.rotation.x = Math.PI / 2;
      t.position.y = y;
      body.add(t);
    }
  } else if (cfg.shirtStyle === 'dots') {
    const c = new THREE.Color(cfg.shirt).lerp(new THREE.Color('#ffffff'), 0.65);
    for (let r = 0; r < 3; r++) {
      for (let i = -2; i <= 2; i++) {
        const a = i * 0.45 + (r % 2) * 0.22;
        const d = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), new THREE.MeshToonMaterial({ color: c, gradientMap: gradient() }));
        d.position.set(Math.sin(a) * 0.172, 0.8 + r * 0.09, Math.cos(a) * 0.172);
        body.add(d);
      }
    }
  }
}

// ───────────────────────── 球拍外型 ─────────────────────────
export const RACKET_LOOKS = {
  std: { shape: 'round', face: null, rim: '#8a1c1c', handle: '#c8a165', pattern: 'none' },
  attack: { shape: 'round', face: '#16181d', rim: '#c1121f', handle: '#2b2b2b', pattern: 'carbon' },
  defense: { shape: 'round', face: '#2a9d8f', rim: '#1f6f66', handle: '#c8a165', pattern: 'dots' },
  spin: { shape: 'round', face: '#e63946', rim: '#7a1020', handle: '#c8a165', pattern: 'gloss' },
  control: { shape: 'round', face: '#4cc9f0', rim: '#1b7ea1', handle: '#c8a165', pattern: 'none' },
  pan: { shape: 'pan', face: '#3a3f47', rim: '#9aa1ab', handle: '#1b1f25', pattern: 'none' },
  swatter: { shape: 'swatter', face: '#7bd389', rim: '#222831', handle: '#222831', pattern: 'grid' },
  rainbow: { shape: 'round', face: '#c77dff', rim: '#ffd23f', handle: '#ffffff', pattern: 'rainbow' },
};
const _padTex = {};
function paddleTexture(pattern, face) {
  const key = `${pattern}|${face}`;
  if (_padTex[key]) return _padTex[key];
  if (pattern === 'none') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = face; g.fillRect(0, 0, 128, 128);
  if (pattern === 'carbon') {
    g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 3;
    for (let i = -128; i < 256; i += 10) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,.35)';
    for (let i = -128; i < 256; i += 10) { g.beginPath(); g.moveTo(i + 128, 0); g.lineTo(i, 128); g.stroke(); }
  } else if (pattern === 'dots') {
    g.fillStyle = 'rgba(255,255,255,.28)';
    for (let y = 6; y < 128; y += 12) for (let x = 6 + ((y / 12) % 2) * 6; x < 128; x += 12) { g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); }
  } else if (pattern === 'gloss') {
    const gr = g.createLinearGradient(0, 0, 128, 128);
    gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(0.45, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,.2)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  } else if (pattern === 'rainbow') {
    const gr = g.createLinearGradient(0, 0, 128, 128);
    ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93'].forEach((col, i, a) => gr.addColorStop(i / (a.length - 1), col));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  } else if (pattern === 'grid') {
    g.strokeStyle = 'rgba(20,40,25,.55)'; g.lineWidth = 2;
    for (let i = 0; i <= 128; i += 12) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _padTex[key] = t;
  return t;
}
export function buildPaddle(id, fallbackColor) {
  const look = RACKET_LOOKS[id] || RACKET_LOOKS.std;
  const face = look.face || fallbackColor || '#d62828';
  const paddle = new THREE.Group();
  const faceMat = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: gradient(), map: paddleTexture(look.pattern, face) });
  if (!faceMat.map) faceMat.color.set(face);
  const rimMat = mat(look.rim);
  const handleMat = mat(look.handle);
  if (look.shape === 'swatter') {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.02), faceMat);
    paddle.add(plate);
    for (const [w, h, x, y] of [[0.32, 0.025, 0, 0.18], [0.32, 0.025, 0, -0.18], [0.025, 0.36, -0.15, 0], [0.025, 0.36, 0.15, 0]]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), rimMat);
      f.position.set(x, y, 0);
      paddle.add(f);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.34, 0.03), handleMat);
    handle.position.y = -0.34;
    paddle.add(handle);
  } else {
    const R = look.shape === 'pan' ? 0.2 : 0.17;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R, look.shape === 'pan' ? 0.035 : 0.025, 28), faceMat);
    disc.rotation.x = Math.PI / 2;
    paddle.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, look.shape === 'pan' ? 0.02 : 0.012, 8, 28), rimMat);
    paddle.add(rim);
    if (look.shape === 'pan') {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.34, 0.03), handleMat);
      handle.position.y = -0.37;
      paddle.add(handle);
      const hole = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.008, 6, 14), rimMat);
      hole.position.y = -0.5;
      paddle.add(hole);
    } else {
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.03), handleMat);
      handle.position.y = -0.24;
      paddle.add(handle);
    }
  }
  return paddle;
}

/** 把圓柱手臂拉伸成從 from 到 to（世界座標）。 */
export function stretchArm(arm, from, to) {
  const d = new THREE.Vector3().subVectors(to, from);
  const len = Math.max(0.01, d.length());
  arm.position.copy(from).addScaledVector(d, 0.5);
  arm.scale.set(1, len, 1);
  arm.quaternion.setFromUnitVectors(UP, d.normalize());
}

// 可調參數的範圍（編輯器滑桿與存檔驗證共用）：[最小, 最大, 步進, 顯示名稱]
export const RANGES = {
  headScale: [1.0, 2.2, 0.01, '頭大小'],
  eyeSize: [0.04, 0.16, 0.005, '眼睛大小'],
  eyeGap: [0.06, 0.24, 0.005, '眼距'],
  eyeAsym: [0.5, 2.0, 0.01, '大小眼'],
  mouthW: [0.06, 0.28, 0.005, '嘴巴寬度'],
};

export const COLOR_KEYS = {
  skin: ['膚色', ['#ffd9b3', '#f1c27d', '#c68642', '#8d5524', '#b5e8a8', '#a8d8ff', '#e8a8ff', '#ffb3b3']],
  shirt: ['上衣', ['#ff4f8b', '#4cc9f0', '#7bd389', '#ff9f1c', '#9b5de5', '#ffffff', '#222222', '#e63946']],
  pants: ['褲子', ['#2b2d6e', '#222222', '#6b2b2b', '#0b5d4b', '#8d99ae', '#f4a261', '#7209b7', '#ffffff']],
  hair: ['頭髮', ['#2a1a12', '#e0b050', '#cc3333', '#3a3aff', '#222222', '#ffffff', '#00c896', '#ff69b4']],
  band: ['頭帶', ['#ffd23f', '#ffffff', '#00e5a0', '#ff4f8b', '#4cc9f0', '#222222', '#9b5de5', '#ff6b35']],
  paddleColor: ['球拍', ['#d62828', '#2a9d8f', '#e76f51', '#264653', '#8338ec', '#ffd23f', '#222222', '#ff69b4']],
};

/** 把任意（可能被竄改或過期的）資料整理成合法的角色設定。 */
export function sanitizeConfig(o, base = DEFAULT_CONFIG) {
  const out = { ...base };
  if (!o || typeof o !== 'object') return out;
  for (const k of Object.keys(COLOR_KEYS)) {
    if (typeof o[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(o[k])) out[k] = o[k];
  }
  for (const [k, [min, max]] of Object.entries(RANGES)) {
    const v = Number(o[k]);
    if (Number.isFinite(v)) out[k] = Math.min(max, Math.max(min, v));
  }
  out.mouthOpen = o.mouthOpen ? 1 : 0;
  const oneOf = (list, v, fb) => (list.some(([k]) => k === v) ? v : fb);
  out.hat = oneOf(HATS, o.hat, base.hat ?? 'none');
  out.glasses = oneOf(GLASSES, o.glasses, base.glasses ?? 'none');
  out.shirtStyle = oneOf(SHIRTS, o.shirtStyle, base.shirtStyle ?? 'plain');
  out.racket = typeof o.racket === 'string' && RACKET_LOOKS[o.racket] ? o.racket : (base.racket ?? 'std');
  return out;
}
