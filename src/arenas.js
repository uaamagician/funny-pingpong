// 場地主題：純資料。main.js 的 applyArena() 把它套到場景上。
// 之後寶箱可以解鎖更多場地，只要在這裡加一筆資料。
export const ARENAS = {
  gym: {
    name: '訓練館', desc: '簡潔的室內球館（預設）',
    bg: 0x151a21, fog: [10, 26], hemi: [0xe3ebf5, 0x2b3440], sun: 0xffffff, rim: 0x8fa8c8,
    floor: 0x222931, court: 0x2c5a4c, table: 0x1b4f8f, ring: 0x2c5a4c,
    beams: [0xffffff, 0xffffff, 0xffffff, 0xffffff],
    pillar: 0x1a2028, hue: [0.58, 0.62], sat: 0.2, light: 0.08, stars: false,
    decor: { pillars: false, beams: false, ring: false },
    swatch: ['#151a21', '#2c5a4c', '#1b4f8f', '#e3ebf5'],
  },
  ice: {
    name: '冰原', desc: '冰面球館：球落桌後跑得更快',
    bg: 0x0f1d2a, fog: [10, 26], hemi: [0xdaf0ff, 0x203446], sun: 0xeaf6ff, rim: 0x8fd3ff,
    floor: 0x1a2c3d, court: 0x2d4a63, table: 0x1b4f8f, ring: 0x8fd3ff,
    beams: [0xbfe6ff, 0xbfe6ff, 0xbfe6ff, 0xbfe6ff],
    pillar: 0x142230, hue: [0.55, 0.6], sat: 0.3, light: 0.1, stars: false,
    decor: { pillars: false, beams: true, ring: false },
    swatch: ['#0f1d2a', '#2d4a63', '#1b4f8f', '#bfe6ff'],
  },
  neon: {
    name: '紫夜競技場', desc: '霓虹聚光燈的夜間賽場',
    bg: 0x1b1033, fog: [9, 22], hemi: [0xcfd8ff, 0x2a1450], sun: 0xffffff, rim: 0xff4f8b,
    floor: 0x2c1a55, court: 0x4a2f8f, table: 0x1f5fb8, ring: 0xff4f8b,
    beams: [0xff4f8b, 0x4cc9f0, 0xffd23f, 0x9b5de5],
    pillar: 0x120a28, hue: [0, 1], sat: 0.8, light: 0.25, stars: false,
    decor: { pillars: true, beams: true, ring: true },
    swatch: ['#1b1033', '#4a2f8f', '#1f5fb8', '#ff4f8b'],
  },
  beach: {
    name: '夕陽海灘', desc: '橘紅天空、沙地上的球桌',
    bg: 0xff9a62, fog: [10, 26], hemi: [0xfff1d6, 0xc98a5a], sun: 0xffe0b0, rim: 0xff7a3d,
    floor: 0xf0cf94, court: 0x2ba7a0, table: 0x2f8f4e, ring: 0xffffff,
    beams: [0xffd23f, 0xff7a3d, 0xff4f8b, 0xffffff],
    pillar: 0xe9b27a, hue: [0.02, 0.12], sat: 0.7, light: 0.3, stars: false,
    decor: { pillars: false, beams: true, ring: false },
    swatch: ['#ff9a62', '#f0cf94', '#2ba7a0', '#2f8f4e'],
  },
  space: {
    name: '太空站', desc: '漂浮在星空中的訓練艙',
    bg: 0x03030c, fog: [10, 26], hemi: [0x9fb4ff, 0x101030], sun: 0xbfd0ff, rim: 0x7b5cff,
    floor: 0x0d0d2a, court: 0x23235e, table: 0x0aa5c8, ring: 0x4cc9f0,
    beams: [0x4cc9f0, 0x7b5cff, 0x00e5a0, 0x4cc9f0],
    pillar: 0x0a0a1e, hue: [0.5, 0.78], sat: 0.9, light: 0.3, stars: true,
    decor: { pillars: false, beams: true, ring: false },
    swatch: ['#03030c', '#23235e', '#0aa5c8', '#7b5cff'],
  },
};
export const DEFAULT_ARENA = 'gym';
