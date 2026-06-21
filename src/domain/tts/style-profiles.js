// audience: internal
// # style-profiles
// 各风格(genre)的音乐档案:把「适配多种风格」落成一张可查的单一来源,决定每种风格用哪套旋律词汇、调性区间、音域、走向形状、速度、伴奏 groove 与和弦进行池。
// 解决「每首都差不多」的根因:之前所有曲共用同一主音、同一拱形轮廓、同一模型;这里让不同风格在调性、音区、轮廓、跳度、和声上各走各的。
// resolveGenre(name, rng) 从区间里按随机源定一首歌的具体主音与速度,使同风格不同曲也不撞调;profile 字段直接喂 composer.compose 的 options.profile。
// 和弦进行由 composer 在风格各自的和声档上随机游走产出(和声档见 harmony-profiles),不在此配固定模板。
// 旋律模型 jvocal-major/jvocal-minor:旋律学自 Kiritan(东北きりたん)50 首日语流行歌的人声主旋律(单声部、可唱,大跳约 7%),和声嫁接自 AnimeTAB 吉他谱 chordify 出的动漫和弦进行。取代早先用吉他谱顶音当旋律(大跳 52%、唱不动)的 anime-major/minor;后者仍留作和声来源与测试基准。folk、children 为各自语料,本就可唱。

// 每种风格:model 旋律词汇与音阶、tonics 可选主音(MIDI,按随机源选一个,使各曲换调)、tempo 速度区间、
//   grooves 一组伴奏型(每首随机选一个,拉开配器:不同 groove 的鼓/贝斯/吉他/键盘/弦乐/合成组合各不同)、
//   profile 旋律侧档案(音域、走向基线/振幅/抖动、轮廓形状集、中跳抑制)、singer 歌手样式 id。
// 各 groove 均经渲染验证含完整乐队(至少鼓+贝斯),部分另带弦乐/合成/管风琴等音色,给配器更多层次。
//   harmony 风格的和声档名(见 harmony-profiles):决定和弦语汇与和声节奏,使不同风格的和弦进行各走各的,不再共用一表。
const { getHarmony } = require('./harmony-profiles');

const GENRES = {
  'jpop-upbeat': {
    model: 'jvocal-major', harmony: 'anime-major', tonics: [57, 59, 60], tempo: [126, 138], singer: 3046,
    grooves: ['8BeatPop2', '8BeatPop1', 'PopRock1', 'PopRock2', '8BeatPop3'],
    profile: { register: { lo: -3, hi: 14 }, base: 4, amp: 8, jitter: 1.2, shapes: ['rise', 'arch', 'peakLate'], midLeapW: 0.07 },
  },
  'jpop-ballad': {
    model: 'jvocal-major', harmony: 'anime-major', tonics: [55, 57, 59], tempo: [72, 84], singer: 3046,
    grooves: ['16BeatBallad1', '16BeatBallad2', '8BeatBallad3', 'Ballad1', '68Ballad'],
    profile: { register: { lo: -7, hi: 12 }, base: 2, amp: 6, jitter: 1.0, shapes: ['arch', 'fall', 'wave'], midLeapW: 0.14 },
  },
  'janime-emotional': {
    model: 'jvocal-minor', harmony: 'anime-minor', tonics: [57, 59, 60], tempo: [88, 100], singer: 3046,
    grooves: ['16BeatBallad1', '16BeatBallad3', '8BeatBallad3', 'Ballad', '68Ballad'],
    profile: { register: { lo: -5, hi: 14 }, base: 3, amp: 7, jitter: 1.3, shapes: ['wave', 'valley', 'fall'], midLeapW: 0.09 },
  },
  'janime-energetic': {
    model: 'jvocal-major', harmony: 'anime-major', tonics: [61, 63, 64], tempo: [150, 164], singer: 3046,
    grooves: ['8BeatPop3', 'BasicRock', '60sRock', 'PopRock2', 'PopRock1'],
    profile: { register: { lo: -2, hi: 14 }, base: 5, amp: 9, jitter: 1.5, shapes: ['rise', 'peakLate', 'arch'], midLeapW: 0.04 },
  },
  'kpop-dance': {
    model: 'jvocal-major', harmony: 'kpop', tonics: [58, 60, 61], tempo: [110, 120], singer: 3046,
    grooves: ['DancePop1', 'DancePop3', 'DancePop2', '8BeatDance', 'PopRock2'],
    profile: { register: { lo: -4, hi: 13 }, base: 3, amp: 6, jitter: 1.4, shapes: ['wave', 'valley', 'rise'], midLeapW: 0.08 },
  },
  'musical-theater': {
    model: 'jvocal-major', harmony: 'musical', tonics: [60, 62, 64], tempo: [96, 112], singer: 3046,
    grooves: ['Broadway', '68Swing', '16BeatBallad2', '8BeatPop1', 'Ballad1'],
    profile: { register: { lo: -6, hi: 16 }, base: 3, amp: 9, jitter: 1.2, shapes: ['peakLate', 'arch', 'rise'], midLeapW: 0.07 },
  },
  children: {
    model: 'children', harmony: 'children', tonics: [62, 64, 65], tempo: [116, 126], singer: 3046,
    grooves: ['60sPop', '8BeatPop1', 'PopRock1', '8BeatBallad3'],
    profile: { register: { lo: -3, hi: 11 }, base: 3, amp: 5, jitter: 0.8, shapes: ['arch', 'rise'], midLeapW: 0.25 },
  },
  folk: {
    model: 'folk', harmony: 'folk-major', tonics: [60, 62, 64], tempo: [88, 100], singer: 3046,
    grooves: ['Folk', 'FolkRock', 'BlueFolk', 'BlueGrass', 'CountryBlues'],
    profile: { register: { lo: -5, hi: 12 }, base: 3, amp: 6, jitter: 1.0, shapes: ['arch', 'wave'], midLeapW: 0.18 },
  },
  electronic: {
    model: 'jvocal-major', harmony: 'hard-electronic-major', tonics: [60, 62, 64], tempo: [120, 132], singer: 3046,
    grooves: ['Techno', 'Trance', 'House', 'HipHop', 'DancePop1', '8BeatDance'],
    profile: { register: { lo: -4, hi: 13 }, base: 3, amp: 7, jitter: 1.2, shapes: ['wave', 'rise', 'valley'], midLeapW: 0.10 },
  },
  // 硬核电子三种:trance(高速、锯齿主音、推进)、bigroom(强劲大房间)、dnb(超快、密集鼓)。hard:true 让配方走硬核主奏、亮 pad、加重鼓。
  trance: {
    model: 'jvocal-major', harmony: 'hard-electronic-major', tonics: [58, 60, 62], tempo: [136, 142], singer: 3046, hard: true,
    grooves: ['Trance', 'Trance1', 'Trance2', 'House'],
    profile: { register: { lo: -2, hi: 16 }, base: 4, amp: 9, jitter: 1.3, shapes: ['rise', 'wave', 'peakLate'], midLeapW: 0.07 },
  },
  bigroom: {
    model: 'jvocal-major', harmony: 'hard-electronic-major', tonics: [60, 62, 64], tempo: [126, 132], singer: 3046, hard: true,
    grooves: ['Techno', 'TeamTechno', 'DANCE', '8BeatDance'],
    profile: { register: { lo: -2, hi: 15 }, base: 4, amp: 9, jitter: 1.4, shapes: ['rise', 'peakLate', 'arch'], midLeapW: 0.06 },
  },
  dnb: {
    model: 'jvocal-minor', harmony: 'hard-electronic-minor', tonics: [57, 59, 62], tempo: [168, 176], singer: 3046, hard: true,
    grooves: ['HipHop', 'HipHopPlusPlus', 'HipHopPlus1', 'HipHopPlus2'],
    profile: { register: { lo: -3, hi: 15 }, base: 3, amp: 8, jitter: 1.5, shapes: ['wave', 'valley', 'rise'], midLeapW: 0.05 },
  },
};

//// 从区间里按随机源定一首歌的具体配置:主音、速度、groove 各取一个,其余照搬档案 [@x380kkm 2026-06-20] ////
function resolveGenre(name, rng) {
  const g = GENRES[name];
  if (!g) throw new Error(`未知风格:${name}`);
  const r = rng || Math.random;
  const tonicMidi = g.tonics[Math.floor(r() * g.tonics.length)];
  const tempo = g.tempo[0] + Math.floor(r() * (g.tempo[1] - g.tempo[0] + 1));
  const groove = g.grooves[Math.floor(r() * g.grooves.length)];
  return { name, model: g.model, harmony: getHarmony(g.harmony), tonicMidi, tempo, groove, singer: g.singer, profile: g.profile, hard: !!g.hard };
}
//// /从区间里定一首歌的具体配置 ////

//// 在风格的 groove 池上做带惯性的随机游走,逐乐句给一个 groove:多数乐句沿用上一句,偶尔切换,使配器随曲推进而非整首一个 [@x380kkm 2026-06-20] ////
// n 乐句数,stayProb 沿用上一 groove 的概率(惯性,缺省 0.65,避免每句都换显得碎)。
function walkGrooves(name, n, rng, stayProb = 0.65) {
  const g = GENRES[name];
  if (!g) throw new Error(`未知风格:${name}`);
  const r = rng || Math.random;
  const pool = g.grooves;
  let cur = pool[Math.floor(r() * pool.length)];
  const seq = [cur];
  for (let i = 1; i < n; i += 1) {
    if (r() >= stayProb) {
      const others = pool.filter((x) => x !== cur);
      if (others.length) cur = others[Math.floor(r() * others.length)];
    }
    seq.push(cur);
  }
  return seq;
}
//// /groove 随机游走 ////

module.exports = { GENRES, resolveGenre, walkGrooves };
