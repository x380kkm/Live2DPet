// audience: internal
// # style-profiles
// 各风格(genre)的音乐档案:把「适配多种风格」落成一张可查的单一来源,决定每种风格用哪套旋律词汇、调性区间、音域、走向形状、速度、伴奏 groove 与和弦进行池。
// 解决「每首都差不多」的根因:之前所有曲共用同一主音、同一拱形轮廓、同一模型;这里让不同风格在调性、音区、轮廓、跳度、和声上各走各的。
// resolveGenre(name, rng) 从区间里按随机源定一首歌的具体主音与速度,使同风格不同曲也不撞调;profile 字段直接喂 composer.compose 的 options.profile。

// 自定义和弦进行池(调内音阶级序号,0 起,配权重);不给则 composer 用其调式内置池。
const PROG_KPOP = [
  { prog: [5, 3, 0, 4], w: 3 }, // vi-IV-I-V 流行循环
  { prog: [0, 4, 5, 3], w: 2 }, // I-V-vi-IV 轴式
  { prog: [3, 0, 4, 5], w: 2 }, // IV-I-V-vi
  { prog: [5, 4, 3, 4], w: 1.5 }, // vi-V-IV-V
];
const PROG_MUSICAL = [
  { prog: [0, 3, 1, 4], w: 2 }, // I-IV-ii-V 走句
  { prog: [0, 5, 3, 4], w: 2 }, // I-vi-IV-V
  { prog: [3, 4, 0, 5], w: 2 }, // IV-V-I-vi
  { prog: [0, 4, 5, 3], w: 1.5 }, // I-V-vi-IV
];

// 每种风格:model 旋律词汇与音阶、tonics 可选主音(MIDI,按随机源选一个,使各曲换调)、tempo 速度区间、groove 伴奏型、
//   profile 旋律侧档案(音域、走向基线/振幅/抖动、轮廓形状集、中跳抑制)、progressions 可选自定义和弦池、singer 歌手样式 id。
const GENRES = {
  'jpop-upbeat': {
    model: 'anime-major', tonics: [64, 65, 67], tempo: [126, 138], groove: '8BeatPop2', singer: 3014,
    profile: { register: { lo: -3, hi: 14 }, base: 4, amp: 8, jitter: 1.2, shapes: ['rise', 'arch', 'peakLate'], midLeapW: 0.10 },
  },
  'jpop-ballad': {
    model: 'anime-major', tonics: [59, 60, 62], tempo: [72, 84], groove: '16BeatBallad1', singer: 3014,
    profile: { register: { lo: -7, hi: 12 }, base: 2, amp: 6, jitter: 1.0, shapes: ['arch', 'fall', 'wave'], midLeapW: 0.22 },
  },
  'janime-emotional': {
    model: 'anime-minor', tonics: [57, 59, 60], tempo: [88, 100], groove: '16BeatBallad1', singer: 3014,
    profile: { register: { lo: -5, hi: 14 }, base: 3, amp: 7, jitter: 1.3, shapes: ['wave', 'valley', 'fall'], midLeapW: 0.15 },
  },
  'janime-energetic': {
    model: 'anime-major', tonics: [64, 66, 67], tempo: [150, 164], groove: '8BeatPop3', singer: 3014,
    profile: { register: { lo: -2, hi: 14 }, base: 5, amp: 9, jitter: 1.5, shapes: ['rise', 'peakLate', 'arch'], midLeapW: 0.06 },
  },
  'kpop-dance': {
    model: 'anime-major', tonics: [61, 63, 64], tempo: [110, 120], groove: 'DancePop1', singer: 3014,
    profile: { register: { lo: -4, hi: 13 }, base: 3, amp: 6, jitter: 1.4, shapes: ['wave', 'valley', 'rise'], midLeapW: 0.12 },
    progressions: PROG_KPOP,
  },
  'musical-theater': {
    model: 'anime-major', tonics: [60, 62, 64], tempo: [96, 112], groove: '8BeatPop1', singer: 3014,
    profile: { register: { lo: -6, hi: 16 }, base: 3, amp: 9, jitter: 1.2, shapes: ['peakLate', 'arch', 'rise'], midLeapW: 0.10 },
    progressions: PROG_MUSICAL,
  },
  children: {
    model: 'children', tonics: [62, 64, 65], tempo: [116, 126], groove: '60sPop', singer: 3014,
    profile: { register: { lo: -3, hi: 11 }, base: 3, amp: 5, jitter: 0.8, shapes: ['arch', 'rise'], midLeapW: 0.25 },
  },
  folk: {
    model: 'folk', tonics: [60, 62, 64], tempo: [88, 100], groove: 'Folk', singer: 3014,
    profile: { register: { lo: -5, hi: 12 }, base: 3, amp: 6, jitter: 1.0, shapes: ['arch', 'wave'], midLeapW: 0.18 },
  },
};

//// 从区间里按随机源定一首歌的具体配置:主音、速度各取一个,其余照搬档案 [@x380kkm 2026-06-20] ////
function resolveGenre(name, rng) {
  const g = GENRES[name];
  if (!g) throw new Error(`未知风格:${name}`);
  const r = rng || Math.random;
  const tonicMidi = g.tonics[Math.floor(r() * g.tonics.length)];
  const tempo = g.tempo[0] + Math.floor(r() * (g.tempo[1] - g.tempo[0] + 1));
  return { name, model: g.model, tonicMidi, tempo, groove: g.groove, singer: g.singer, profile: g.profile, progressions: g.progressions };
}
//// /从区间里定一首歌的具体配置 ////

module.exports = { GENRES, resolveGenre, PROG_KPOP, PROG_MUSICAL };
