import { TUNE } from './tuning.js';

// 球的物理與擊球解算。單位：公尺、秒。
// 座標：x 右、y 上、z 朝玩家（玩家在 +z，對手在 -z）。

export const G = 9.8;
export const BALL_R = 0.04; // 比真實大一點，手機上才看得清楚
export const TABLE = { halfW: 0.7625, halfL: 1.37, top: 0.76, netH: 0.1525 };
export const NET_TOP = TABLE.top + TABLE.netH;

export function makeBall() {
  return { pos: { x: 0, y: 1, z: 0 }, vel: { x: 0, y: 0, z: 0 }, spin: { top: 0, side: 0 } };
}

export function stepBall(b, dt) {
  const gEff = G * TUNE.gravity + b.spin.top * TUNE.topG;
  b.vel.y -= gEff * dt;
  b.vel.x += b.spin.side * TUNE.sideA * dt;
  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;
  b.pos.z += b.vel.z * dt;
}

export function bounceOnTable(b) {
  b.pos.y = TABLE.top + BALL_R;
  b.vel.y = -b.vel.y * 0.9;
  // 上旋彈起後加速前進，下旋則減速；側旋讓球彈起後往旁邊跑
  const k = 1 + b.spin.top * TUNE.bounceTopK;
  b.vel.z *= k;
  b.vel.x = b.vel.x * k + b.spin.side * TUNE.bounceKick;
  b.spin.top *= TUNE.spinDecay;
  b.spin.side *= TUNE.spinDecay;
}

/**
 * 解出從 p0 打向 target、飛行 T 秒所需的初速度（已把旋轉造成的加速度補償進去，
 * 所以旋轉會讓軌跡彎曲，但落點仍在目標附近）。若過不了網就拉長飛行時間讓球弧度變高。
 */
export function solveShot(p0, target, T0, spin, clearance = 0.05) {
  const gEff = G * TUNE.gravity + spin.top * TUNE.topG;
  const ax = spin.side * TUNE.sideA;
  let T = T0;
  let res;
  for (let i = 0; i < 24; i++) {
    const vx = (target.x - p0.x) / T - 0.5 * ax * T;
    const vz = (target.z - p0.z) / T;
    const vy = (target.y - p0.y) / T + 0.5 * gEff * T;
    res = { vel: { x: vx, y: vy, z: vz }, T };
    const dz = target.z - p0.z;
    const tn = dz !== 0 ? (T * (0 - p0.z)) / dz : -1;
    if (tn <= 0 || tn >= T) return res; // 不經過球網
    const yNet = p0.y + vy * tn - 0.5 * gEff * tn * tn;
    if (yNet >= NET_TOP + BALL_R + clearance) return res;
    T += 0.04;
    if (T > 1.8) break;
  }
  return res;
}
