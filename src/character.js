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
};

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
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.05 });

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
  [-1, 1].forEach((s) => {
    const er = cfg.eyeSize * (s > 0 ? cfg.eyeAsym : 1) * cfg.headScale * 0.9;
    const ex = s * cfg.eyeGap * cfg.headScale;
    const white = new THREE.Mesh(new THREE.SphereGeometry(er, 14, 12), mat('#ffffff'));
    white.position.set(ex, eyeY, faceZ(headR, ex, eyeY) * 0.97);
    head.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(er * 0.45, 10, 8), mat('#111'));
    pupil.position.set(ex + s * er * 0.1, eyeY, white.position.z + er * 0.75);
    head.add(pupil);
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

  // 一撮呆毛
  const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 8), mat(cfg.hair));
  tuft.position.set(0.04, headR + 0.07, 0);
  tuft.rotation.z = -0.4;
  head.add(tuft);

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

  // 球拍
  const paddle = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.025, 24), mat(cfg.paddleColor));
  face.rotation.x = Math.PI / 2;
  paddle.add(face);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.03), mat('#c8a165'));
  handle.position.y = -0.24;
  paddle.add(handle);

  return { group, body, head, shoulder, arm, paddle, cfg };
}

/** 把圓柱手臂拉伸成從 from 到 to（世界座標）。 */
export function stretchArm(arm, from, to) {
  const d = new THREE.Vector3().subVectors(to, from);
  const len = Math.max(0.01, d.length());
  arm.position.copy(from).addScaledVector(d, 0.5);
  arm.scale.set(1, len, 1);
  arm.quaternion.setFromUnitVectors(UP, d.normalize());
}
