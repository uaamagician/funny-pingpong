// 手感與效果的集中調整表。數字越大 = 效果越誇張。
// 旋轉與落點相關的值可以用 `npm run lab` 的實驗結果來調。
export const TUNE = {
  // —— 旋轉物理 ——
  sideA: 4.5,       // 側旋的橫向加速度（飛行弧度）
  topG: 3.0,        // 上旋下墜／下旋飄浮的強度
  bounceKick: 0.5,  // 側旋球落桌後的橫向偏轉
  bounceTopK: 0.18, // 上旋加速／下旋減速的強度
  spinDecay: 0.75,  // 每次落桌後旋轉剩下的比例
  // —— 時機 ——
  idealZ: 1.45,     // 最佳擊球位置（球離網的距離）
  // —— 鏡頭與角色效果 ——
  camRoll: 0.06,    // 強旋球時鏡頭傾斜
  smashFov: -8,     // 殺球時視角收縮
  smashShake: 0.25, // 殺球震動
  smashSlow: 0.35,  // 殺球慢動作秒數
  slowScale: 0.4,   // 慢動作速度
  pointDolly: 0.8,  // 得分後鏡頭推近
  reactJump: 0.2,   // 得分時跳起高度
  reactWobble: 0.2, // 失分時頭部晃動
};
