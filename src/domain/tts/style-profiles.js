// audience: internal
// # style-profiles
// 各风格的音乐档案,用简单代号(s01、s02……)分类,刻意不用「trance」「kpop」这类流派名——那些名字承诺了具体流派、实际并不严格符合,反而误导。
// 一个代号 = 一套相互搭配的旋钮:旋律模型、和声档、调性区间、速度、伴奏 groove 池、旋律侧档案(走向与跳度)、配器调色板(主奏乐器/对位疏密/弦乐/铺底/钢琴分解),以及 hard 硬核标记。
// 代号众多以求随机内容丰富:风格之间在调性、音区、速度、轮廓、和声色彩、groove 与配器上各走各的;每个代号内部各池仍按种子随机,故同代号不同曲也不同。
// note 字段是一句中文性格描述(非流派承诺,仅帮人记忆该代号大概什么味)。resolveGenre(code, rng) 落一首歌的具体配置并附配器调色板。和弦进行在该风格的和声档上随机游走(见 harmony-profiles)。

const { getHarmony } = require('./harmony-profiles');

// 旋律侧档案:音域(register)现已主要由旋律模型学自语料并经 VOCAL_RANGE 钳制,这里给走向基线/振幅/抖动、轮廓形状集与中跳抑制。
const PROFILES = {
  gentle: { register: { lo: -5, hi: 14 }, base: 2, amp: 6, jitter: 1.0, shapes: ['arch', 'wave', 'fall'], midLeapW: 0.12 },
  flowing: { register: { lo: -4, hi: 15 }, base: 3, amp: 7, jitter: 1.2, shapes: ['arch', 'rise', 'wave'], midLeapW: 0.09 },
  energetic: { register: { lo: -3, hi: 16 }, base: 4, amp: 9, jitter: 1.4, shapes: ['rise', 'peakLate', 'arch'], midLeapW: 0.06 },
  dreamy: { register: { lo: -5, hi: 14 }, base: 3, amp: 6, jitter: 1.0, shapes: ['wave', 'valley', 'arch'], midLeapW: 0.14 },
};

// 伴奏 groove 池(MMA groove 名,均经渲染验证可用):按律动家族分组,各风格引用其一。
const GROOVES = {
  ballad: ['16BeatBallad1', '16BeatBallad2', '16BeatBallad3', '8BeatBallad3', 'Ballad', 'Ballad1', '68Ballad'],
  pop: ['8BeatPop1', '8BeatPop2', '8BeatPop3', 'PopRock1', 'PopRock2', '60sPop'],
  rock: ['BasicRock', '60sRock', 'PopRock2', '8BeatPop3'],
  dance: ['DancePop1', 'DancePop2', 'DancePop3', '8BeatDance'],
  electronic: ['Techno', 'Trance', 'House', '8BeatDance', 'DANCE', 'TeamTechno'],
  hiphop: ['HipHop', 'HipHopPlusPlus', 'HipHopPlus1', 'HipHopPlus2'],
  folk: ['Folk', 'FolkRock', 'BlueFolk', 'BlueGrass', 'CountryBlues'],
  swing: ['Broadway', '68Swing', '60sPop', '8BeatPop1'],
};

// 配器调色板(GM 乐器号):leads 主奏候选、counter 对位疏密模式、strings 弦乐处理、pad 铺底音色、pianoArp 加钢琴分解的概率。
// 民族器(koto 107、shamisen 106、sitar 104、banjo 105、shakuhachi 77)在 MuseScore_General 音色库里音色尚可。
const PALETTES = {
  acoustic: { leads: [0, 24, 27, 11, 73], counter: ['fills', 'active', 'sustained'], strings: ['pad', 'pizz', 'none'], pad: 49, pianoArp: 0.5 },
  piano: { leads: [0, 0, 11, 24], counter: ['sustained', 'fills', 'active'], strings: ['pad', 'pad', 'pizz'], pad: 49, pianoArp: 0.7 },
  bandRock: { leads: [29, 30, 27, 81], counter: ['active', 'fills', 'active'], strings: ['pad', 'none'], pad: 49, pianoArp: 0.2 },
  dancePop: { leads: [80, 81, 82, 87], counter: ['active', 'fills', 'rise'], strings: ['pad', 'pizz', 'none'], pad: 50, pianoArp: 0.3 },
  synthHard: { leads: [81, 80, 87, 62, 38], counter: ['active', 'active', 'rise'], strings: ['pad', 'none'], pad: 50, pianoArp: 0 },
  orchestral: { leads: [48, 49, 40, 73, 71], counter: ['sustained', 'fills', 'active'], strings: ['pad', 'pizz'], pad: 49, pianoArp: 0.3 },
  theatrical: { leads: [0, 56, 57, 60, 48, 73], counter: ['sustained', 'fills', 'active'], strings: ['pad', 'pizz'], pad: 49, pianoArp: 0.4 },
  folkAcoustic: { leads: [24, 25, 105, 22, 11], counter: ['fills', 'sustained', 'active'], strings: ['none', 'pizz'], pad: 48, pianoArp: 0.3 },
  musicbox: { leads: [10, 8, 11, 12, 9], counter: ['fills', 'sustained', 'sustained'], strings: ['pizz', 'none'], pad: 89, pianoArp: 0.5 },
  ethnicJP: { leads: [107, 106, 104, 105, 77], counter: ['fills', 'sustained', 'active'], strings: ['pizz', 'none'], pad: 49, pianoArp: 0.2, sf: 'MuseScore_General.sf2' },
  ambient: { leads: [88, 89, 52, 54, 98], counter: ['sustained', 'rise', 'fills'], strings: ['pad', 'pad'], pad: 89, pianoArp: 0.4 },
};

// 各代号:旋律模型、和声档、可选主音、速度区间、groove 池、旋律档、配器调色板、hard 硬核标记,以及一句中文性格。
const GENRES = {
  s01: { note: '暖慢原声抒情', model: 'pop909-minor', harmony: 'anime-minor', tonics: [57, 59, 60], tempo: [70, 84], grooves: GROOVES.ballad, profile: PROFILES.gentle, palette: PALETTES.acoustic },
  s02: { note: '明亮中速流行', model: 'pop909-major', harmony: 'anime-major', tonics: [58, 60, 62], tempo: [104, 118], grooves: GROOVES.pop, profile: PROFILES.flowing, palette: PALETTES.acoustic },
  s03: { note: '上扬快歌', model: 'pop909-major', harmony: 'anime-major', tonics: [60, 62, 64], tempo: [126, 140], grooves: GROOVES.pop, profile: PROFILES.energetic, palette: PALETTES.bandRock },
  s04: { note: '燃系摇滚', model: 'pop909-major', harmony: 'anime-major', tonics: [61, 63, 64], tempo: [150, 168], grooves: GROOVES.rock, profile: PROFILES.energetic, palette: PALETTES.bandRock },
  s05: { note: '舞曲律动', model: 'pop909-major', harmony: 'kpop', tonics: [58, 60, 61], tempo: [112, 124], grooves: GROOVES.dance, profile: PROFILES.flowing, palette: PALETTES.dancePop },
  s06: { note: '硬合成推进', model: 'pop909-major', harmony: 'hard-electronic-major', tonics: [58, 60, 62], tempo: [128, 140], grooves: GROOVES.electronic, profile: PROFILES.energetic, palette: PALETTES.synthHard, hard: true },
  s07: { note: '暗色超快电子', model: 'pop909-minor', harmony: 'hard-electronic-minor', tonics: [57, 59, 60], tempo: [166, 176], grooves: GROOVES.hiphop, profile: PROFILES.energetic, palette: PALETTES.synthHard, hard: true },
  s08: { note: '强劲大房间电子', model: 'pop909-major', harmony: 'hard-electronic-major', tonics: [58, 60, 62], tempo: [126, 134], grooves: GROOVES.electronic, profile: PROFILES.energetic, palette: PALETTES.synthHard, hard: true },
  s09: { note: '管弦戏剧', model: 'pop909-major', harmony: 'musical', tonics: [57, 59, 60], tempo: [96, 112], grooves: GROOVES.swing, profile: PROFILES.flowing, palette: PALETTES.theatrical },
  s10: { note: '弦乐叙事慢板', model: 'pop909-minor', harmony: 'musical', tonics: [56, 58, 60], tempo: [80, 96], grooves: GROOVES.ballad, profile: PROFILES.gentle, palette: PALETTES.orchestral },
  s11: { note: '民谣弹唱', model: 'folk', harmony: 'folk-major', tonics: [60, 62, 64], tempo: [88, 102], grooves: GROOVES.folk, profile: PROFILES.flowing, palette: PALETTES.folkAcoustic },
  s12: { note: '蓝草轻快', model: 'folk', harmony: 'folk-major', tonics: [60, 62, 64], tempo: [110, 126], grooves: GROOVES.folk, profile: PROFILES.energetic, palette: PALETTES.folkAcoustic },
  s13: { note: '八音盒童谣', model: 'children', harmony: 'children', tonics: [62, 64, 65], tempo: [108, 120], grooves: GROOVES.pop, profile: PROFILES.gentle, palette: PALETTES.musicbox },
  s14: { note: '钢片琴小品', model: 'children', harmony: 'children', tonics: [60, 62, 64], tempo: [96, 112], grooves: GROOVES.ballad, profile: PROFILES.gentle, palette: PALETTES.musicbox },
  s15: { note: '和风筝音慢', model: 'pop909-minor', harmony: 'anime-minor', tonics: [57, 59, 62], tempo: [84, 100], grooves: GROOVES.ballad, profile: PROFILES.gentle, palette: PALETTES.ethnicJP },
  s16: { note: '和风快板', model: 'pop909-major', harmony: 'anime-major', tonics: [59, 60, 62], tempo: [120, 138], grooves: GROOVES.pop, profile: PROFILES.flowing, palette: PALETTES.ethnicJP },
  s17: { note: '梦境氛围慢', model: 'pop909-major', harmony: 'anime-major', tonics: [55, 57, 60], tempo: [72, 88], grooves: GROOVES.ballad, profile: PROFILES.dreamy, palette: PALETTES.ambient },
  s18: { note: '暗潮氛围', model: 'pop909-minor', harmony: 'anime-minor', tonics: [55, 57, 59], tempo: [88, 104], grooves: GROOVES.ballad, profile: PROFILES.dreamy, palette: PALETTES.ambient },
  s19: { note: '钢琴抒情', model: 'pop909-major', harmony: 'anime-major', tonics: [57, 59, 60], tempo: [76, 92], grooves: GROOVES.ballad, profile: PROFILES.gentle, palette: PALETTES.piano },
  s20: { note: '小调流行', model: 'pop909-minor', harmony: 'anime-minor', tonics: [57, 59, 60], tempo: [100, 116], grooves: GROOVES.pop, profile: PROFILES.flowing, palette: PALETTES.acoustic },
  s21: { note: '复古摇摆', model: 'pop909-major', harmony: 'musical', tonics: [58, 60, 62], tempo: [108, 126], grooves: GROOVES.swing, profile: PROFILES.flowing, palette: PALETTES.theatrical },
  s22: { note: '合成流行快', model: 'pop909-major', harmony: 'kpop', tonics: [59, 60, 62], tempo: [124, 138], grooves: GROOVES.dance, profile: PROFILES.energetic, palette: PALETTES.dancePop },
  s23: { note: '民族器叙事', model: 'pop909-minor', harmony: 'anime-minor', tonics: [57, 59, 60], tempo: [92, 108], grooves: GROOVES.ballad, profile: PROFILES.gentle, palette: PALETTES.ethnicJP },
  s24: { note: '轻电子流行', model: 'pop909-major', harmony: 'hard-electronic-major', tonics: [59, 60, 62], tempo: [116, 128], grooves: GROOVES.dance, profile: PROFILES.flowing, palette: PALETTES.dancePop },
  s25: { note: '钢琴小调抒情', model: 'pop909-minor', harmony: 'anime-minor', tonics: [56, 58, 60], tempo: [72, 88], grooves: GROOVES.ballad, profile: PROFILES.gentle, palette: PALETTES.piano },
  s26: { note: '小调民谣', model: 'folk', harmony: 'folk-minor', tonics: [57, 59, 60], tempo: [90, 104], grooves: GROOVES.folk, profile: PROFILES.flowing, palette: PALETTES.folkAcoustic },
  s27: { note: '电影感管弦快板', model: 'pop909-major', harmony: 'musical', tonics: [59, 60, 62], tempo: [120, 136], grooves: GROOVES.rock, profile: PROFILES.energetic, palette: PALETTES.orchestral },
  s28: { note: '暗色八音盒', model: 'pop909-minor', harmony: 'anime-minor', tonics: [57, 59, 60], tempo: [84, 98], grooves: GROOVES.ballad, profile: PROFILES.dreamy, palette: PALETTES.musicbox },
  s29: { note: '氛围流行中速', model: 'pop909-major', harmony: 'anime-major', tonics: [58, 60, 62], tempo: [100, 114], grooves: GROOVES.pop, profile: PROFILES.dreamy, palette: PALETTES.ambient },
  s30: { note: '和风氛围慢', model: 'pop909-minor', harmony: 'anime-minor', tonics: [55, 57, 60], tempo: [72, 88], grooves: GROOVES.ballad, profile: PROFILES.dreamy, palette: PALETTES.ethnicJP },
  s31: { note: '小调摇滚', model: 'pop909-minor', harmony: 'anime-minor', tonics: [57, 59, 60], tempo: [148, 164], grooves: GROOVES.rock, profile: PROFILES.energetic, palette: PALETTES.bandRock },
  s32: { note: '小调舞曲', model: 'pop909-minor', harmony: 'hard-electronic-minor', tonics: [57, 59, 60], tempo: [116, 128], grooves: GROOVES.dance, profile: PROFILES.flowing, palette: PALETTES.dancePop },
  s33: { note: '爵士钢琴摇摆', model: 'pop909-major', harmony: 'musical', tonics: [58, 60, 62], tempo: [100, 118], grooves: GROOVES.swing, profile: PROFILES.flowing, palette: PALETTES.piano },
  s34: { note: '明亮原声快板', model: 'pop909-major', harmony: 'anime-major', tonics: [60, 62, 64], tempo: [132, 146], grooves: GROOVES.pop, profile: PROFILES.energetic, palette: PALETTES.acoustic },
  s35: { note: '史诗管弦慢板', model: 'pop909-minor', harmony: 'musical', tonics: [55, 57, 59], tempo: [78, 94], grooves: GROOVES.ballad, profile: PROFILES.gentle, palette: PALETTES.orchestral },
  s36: { note: '合成波中速', model: 'pop909-major', harmony: 'hard-electronic-major', tonics: [58, 60, 62], tempo: [112, 124], grooves: GROOVES.electronic, profile: PROFILES.flowing, palette: PALETTES.dancePop },
};

//// 从区间里按随机源定一首歌的具体配置:主音、速度、groove 各取一个,附配器调色板,其余照搬档案 [@x380kkm 2026-06-21] ////
function resolveGenre(name, rng) {
  const g = GENRES[name];
  if (!g) throw new Error(`未知风格代号:${name}`);
  const r = rng || Math.random;
  const tonicMidi = g.tonics[Math.floor(r() * g.tonics.length)];
  const tempo = g.tempo[0] + Math.floor(r() * (g.tempo[1] - g.tempo[0] + 1));
  const groove = g.grooves[Math.floor(r() * g.grooves.length)];
  return { name, note: g.note, model: g.model, harmony: getHarmony(g.harmony), tonicMidi, tempo, groove, singer: 3046, profile: g.profile, hard: !!g.hard, palette: g.palette };
}
//// /从区间里定一首歌的具体配置 ////

//// 在风格的 groove 池上做带惯性的随机游走,逐乐句给一个 groove:多数乐句沿用上一句,偶尔切换,使配器随曲推进而非整首一个 [@x380kkm 2026-06-20] ////
function walkGrooves(name, n, rng, stayProb = 0.65) {
  const g = GENRES[name];
  if (!g) throw new Error(`未知风格代号:${name}`);
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

module.exports = { GENRES, resolveGenre, walkGrooves, PALETTES, PROFILES, GROOVES };
