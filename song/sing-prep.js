// audience: internal
// # sing-prep
// 演唱管线第一步(scratch):按风格档案作曲 → 音节化 → 写出可唱旋律、每句音节预算、人设、MMA 和弦谱与元数据,供歌词 agent 写词、后续渲染。
// 运行:node archive/sing-prep.js <风格名> <种子> <输出前缀>
//   风格名取自 style-profiles 的 GENRES(如 jpop-upbeat、jpop-ballad、janime-emotional、janime-energetic、kpop-dance、musical-theater、children、folk)。
//   风格决定旋律模型、主音(各曲换调)、速度、音域、轮廓形状、和弦池与 groove;种子保证可复现,且不同曲不再撞调撞轮廓。

const fs = require('fs');
const path = require('path');
const { loadModel, SCALES } = require('../src/domain/tts/composer');
const { VOCAL_RANGE } = require('../src/domain/tts/composer-util');
const { composeSong } = require('../src/domain/tts/song-form');
const { resolveGenre, GENRES } = require('../src/domain/tts/style-profiles');
const { syllabify, syllableBudget, addMelisma } = require('./syllabify');
const { pickRecipe } = require('./arrange-recipe');

const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const LEAD_REST_BEATS = 0.25;
const PERSONA_CARD = path.join(__dirname, '..', 'assets', 'prompts', '2bcf3d8a-85e8-47dd-aa07-792fe91cca26.json');

function loadPersona() {
  const card = JSON.parse(fs.readFileSync(PERSONA_CARD, 'utf8')).data;
  return { name: card.name, userTerm: card.userTerm, personality: card.personality, scenario: card.scenario, language: card.language };
}

function seeded(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function chordName(tonic, c) {
  const rootPc = (((tonic + c.root) % 12) + 12) % 12;
  const ivs = c.pcs.map((p) => ((((p - c.root) % 12) + 12) % 12)).sort((a, b) => a - b).join(',');
  const qual = ivs === '0,4,7' ? '' : ivs === '0,3,7' ? 'm' : ivs === '0,3,6' ? 'dim' : ivs === '0,4,8' ? 'aug' : '';
  return PC[rootPc] + qual;
}

const [genre = 'jpop-upbeat', seedArg = '20', prefix = 'archive/sing'] = process.argv.slice(2);
const seed = parseInt(seedArg, 10);
const g = resolveGenre(genre, seeded(seed * 31 + 7));
const scale = loadModel(g.model).scale || 'diatonic';

// 乐句要有结构:不再单段 8 小节,而是主歌-副歌-主歌-副歌-桥段-副歌的曲式,副歌复用(可辨识地重复)、桥段作对比;每段各 2 乐句(4 小节)。
// 各段配一个 groove(从风格 groove 池里挑,主歌/副歌/桥段不同),使配器随段落变化。同一主音,先不转调以保接缝简单。
const pool = GENRES[genre].grooves;
const gPick = (n) => pool[Math.floor(seeded(seed * 17 + n)() * pool.length)];
const gVerse = gPick(1); const gChorus = gPick(2); const gBridge = gPick(3);
const ROLES = [
  { role: 'verse', key: 'verse1', groove: gVerse, seed: seed * 7 + 1 },
  { role: 'chorus', key: 'chorus', groove: gChorus, seed: seed * 7 + 2 },
  { role: 'verse', key: 'verse2', groove: gVerse, seed: seed * 7 + 3 },
  { role: 'chorus', key: 'chorus', groove: gChorus, seed: seed * 7 + 2 },
  { role: 'bridge', key: 'bridge', groove: gBridge, seed: seed * 7 + 4 },
  { role: 'chorus', key: 'chorus', groove: gChorus, seed: seed * 7 + 2 },
];
const sections = ROLES.map((r) => ({
  role: r.role, key: r.key, groove: r.groove, seed: r.seed,
  model: loadModel(g.model), harmony: g.harmony, profile: g.profile, tonicMidi: g.tonicMidi, phrases: 2, barsPerPhrase: 2,
}));
const song = composeSong(sections, seeded, { withCounter: true });

// 音节化后加花腔:把够长的音节(尤其句末)展开成同一音节上的调内拖腔运音,使演唱有花腔而非一字一音;只增音节内音符、不改音节总数,故歌词对齐不变。
const singable = addMelisma(syllabify(song.melody), { scaleSet: SCALES[scale] || SCALES.diatonic, tonicMidi: g.tonicMidi, rng: seeded(seed * 137 + 9), lo: VOCAL_RANGE.lo, hi: VOCAL_RANGE.hi });
fs.writeFileSync(`${prefix}.singable.json`, JSON.stringify({ tempo: g.tempo, leadRestBeats: LEAD_REST_BEATS, tonicMidi: g.tonicMidi, scale, melody: singable }));
// 第二声部作吉他对位线(原始逐音)。
fs.writeFileSync(`${prefix}.lead.json`, JSON.stringify({ tempo: g.tempo, leadRestBeats: LEAD_REST_BEATS, melody: song.counter }));
const budget = syllableBudget(singable);

// MMA 谱:逐段一个 Groove,再铺该段的小节(每小节两个半小节和弦);段落随曲推进、配器随段变化。
const lines = [`Tempo ${g.tempo}`];
let ci = 0;
for (const s of song.layout) {
  lines.push(`Groove ${s.groove}`);
  const spans = s.bars * 2;
  for (let k = 0; k < spans; k += 2) {
    lines.push(`${chordName(song.chords[ci + k].tonic, song.chords[ci + k])} ${chordName(song.chords[ci + k + 1].tonic, song.chords[ci + k + 1])}`);
  }
  ci += spans;
}
fs.writeFileSync(`${prefix}.chart.mma`, lines.join('\n') + '\n');
fs.writeFileSync(`${prefix}.chords.json`, JSON.stringify({ tonicMidi: g.tonicMidi, scale, spans: song.chords }));

const recipe = pickRecipe(g, seeded(seed * 101 + 13));
fs.writeFileSync(`${prefix}.arrange.json`, JSON.stringify(recipe));
// 分段音节预算:每个独一段落音节化求每句音节数(供写词逐句对齐);复用段标 repeatOf 指回首次出现,提示复用同段歌词。
const phrasesOfKey = {};
const seenKey = {};
const sectionBudget = song.layout.map((s, idx) => {
  if (!phrasesOfKey[s.key]) phrasesOfKey[s.key] = syllableBudget(syllabify(song.parts[s.key].melody)).perPhrase.filter((x) => x > 0);
  const phrases = phrasesOfKey[s.key];
  const entry = { index: idx, role: s.role, key: s.key, phrases, sung: phrases.reduce((a, b) => a + b, 0) };
  if (seenKey[s.key] != null) entry.repeatOf = seenKey[s.key]; else seenKey[s.key] = idx;
  return entry;
});
fs.writeFileSync(`${prefix}.budget.json`, JSON.stringify({
  genre, model: g.model, tonicMidi: g.tonicMidi, tempo: g.tempo, singer: g.singer,
  persona: loadPersona(), sections: sectionBudget, total: budget.total,
}, null, 2));
fs.writeFileSync(`${prefix}.meta.json`, JSON.stringify({ tempo: g.tempo, leadRestBeats: LEAD_REST_BEATS, bars: song.totalBars, singer: g.singer }));

console.log(`${genre} 调=${PC[g.tonicMidi % 12]} tempo=${g.tempo} 曲式=${song.layout.map((s) => s.role).join('-')} 共 ${song.totalBars} 小节 groove=[${[gVerse, gChorus, gBridge].join('/')}] -> ${prefix}.*`);
