// 場地主題：純資料。main.js 的 applyArena() 把它套到場景上。
// 之後寶箱可以解鎖更多場地，只要在這裡加一筆資料。
export const ARENAS = {
  neon: {
    name: '紫夜競技場', desc: '霓虹聚光燈的夜間賽場',
    bg: 0x1b1033, fog: [9, 22], hemi: [0xcfd8ff, 0x2a1450], sun: 0xffffff, rim: 0xff4f8b,
    floor: 0x2c1a55, court: 0x4a2f8f, table: 0x1f5fb8, ring: 0xff4f8b,
    beams: [0xff4f8b, 0x4cc9f0, 0xffd23f, 0x9b5de5],
    pillar: 0x120a28, hue: [0, 1], sat: 0.8, light: 0.25, stars: false,
    swatch: ['#1b1033', '#4a2f8f', '#1f5fb8', '#ff4f8b'],
  },
  beach: {
    name: '夕陽海灘', desc: '橘紅天空、沙地上的球桌',
    bg: 0xff9a62, fog: [10, 26], hemi: [0xfff1d6, 0xc98a5a], sun: 0xffe0b0, rim: 0xff7a3d,
    floor: 0xf0cf94, court: 0x2ba7a0, table: 0x2f8f4e, ring: 0xffffff,
    beams: [0xffd23f, 0xff7a3d, 0xff4f8b, 0xffffff],
    pillar: 0xe9b27a, hue: [0.02, 0.12], sat: 0.7, light: 0.3, stars: false,
    swatch: ['#ff9a62', '#f0cf94', '#2ba7a0', '#2f8f4e'],
  },
  space: {
    name: '太空站', desc: '漂浮在星空中的訓練艙',
    bg: 0x03030c, fog: [10, 26], hemi: [0x9fb4ff, 0x101030], sun: 0xbfd0ff, rim: 0x7b5cff,
    floor: 0x0d0d2a, court: 0x23235e, table: 0x0aa5c8, ring: 0x4cc9f0,
    beams: [0x4cc9f0, 0x7b5cff, 0x00e5a0, 0x4cc9f0],
    pillar: 0x0a0a1e, hue: [0.5, 0.78], sat: 0.9, light: 0.3, stars: true,
    swatch: ['#03030c', '#23235e', '#0aa5c8', '#7b5cff'],
  },
};
export const DEFAULT_ARENA = 'neon';
