// audience: internal
// # melody-generator
// 离线随机生成多风格旋律:音高从各风格语料训出的二阶马尔可夫采样,节奏用对齐拍格的小节节奏型,曲式按乐句做动机重复(如 AABA),保证结构内聚、不撕裂。
// 风格模型存为 melody-model-<风格>.json(可含按音区聚类的子库 -c0、-c1 等),内含音阶类型 scale:pentatonic 五声、diatonic 七声大调、minor 七声小调;各库按自身 scale 把度数吸附到音阶。
// 输出与 song-score 的旋律格式一致:发声音符 { key:MIDI, beats:拍数 },句间换气为 { rest:拍数 },可直接交 hummingScore 或 buildScore。
// 不变量:纯逻辑;随机源经 options.rng 注入(缺省 Math.random),便于测试可重复。

// 各音阶相对主音的半音度数:pentatonic 宫调五声(do re mi sol la),diatonic 自然大调七声,minor 自然小调七声。
const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  diatonic: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

// 4/4 小节的节奏型:各型时值之和为 4 拍、且都落在半拍格上,保证节奏对齐;权重偏向均匀与常见 pop 切分。
const BAR_PATTERNS = [
  { pat: [1, 1, 1, 1], w: 3 },
  { pat: [2, 1, 1], w: 2 },
  { pat: [1, 1, 2], w: 2 },
  { pat: [2, 2], w: 1 },
  { pat: [1, 0.5, 0.5, 1, 1], w: 2 },
  { pat: [0.5, 0.5, 1, 1, 1], w: 2 },
  { pat: [1, 1, 0.5, 0.5, 1], w: 1.5 },
  { pat: [1.5, 0.5, 1, 1], w: 1.5 },
  { pat: [1, 1, 1, 0.5, 0.5], w: 1.5 },
  { pat: [0.5, 0.5, 0.5, 0.5, 1, 1], w: 1 },
];
const BEATS_PER_BAR = 4;
// 音高马尔可夫采样时的级进偏好:转移概率再乘 exp(-|音程|/STEP_BIAS),压低大跳、提高级进。
const STEP_BIAS = 3.5;

//// 按风格加载对应模型文件 [@x380kkm 2026-06-20] ////
function loadModel(style) {
  return require(`./melody-model-${style}.json`);
}
//// /按风格加载对应模型文件 ////

//// 把相对主音的半音度数吸附到最近的音阶度数(跨八度);无音阶则原样返回 [@x380kkm 2026-06-20] ////
function snapToScale(deg, scale) {
  const set = SCALES[scale];
  if (!set) return deg;
  let best = deg;
  let bestDist = Infinity;
  for (let oct = -2; oct <= 3; oct += 1) {
    for (const p of set) {
      const cand = p + 12 * oct;
      const dist = Math.abs(cand - deg);
      if (dist < bestDist) { bestDist = dist; best = cand; }
    }
  }
  return best;
}
//// /把度数吸附到最近的音阶度数 ////

//// 按计数权重从 { 键: 次数 } 里随机取一个键,空表回 null [@x380kkm 2026-06-20] ////
function pickWeighted(counts, rng) {
  let total = 0;
  for (const k in counts) total += counts[k];
  if (total <= 0) return null;
  let r = rng() * total;
  for (const k in counts) { r -= counts[k]; if (r < 0) return k; }
  return Object.keys(counts)[0];
}
//// /按计数权重随机取一个键 ////

//// 取下一个音高度数:二阶转移再乘级进偏好(压大跳),缺失则小步随机 [@x380kkm 2026-06-20] ////
function nextDegree(model, d2, d1, rng) {
  const trans = model.pitch2[`${d2},${d1}`];
  if (trans) {
    const weighted = {};
    for (const k in trans) {
      const leap = Math.abs(parseInt(k, 10) - d1);
      weighted[k] = trans[k] * Math.exp(-leap / STEP_BIAS);
    }
    const pick = pickWeighted(weighted, rng);
    if (pick != null) return parseInt(pick, 10);
  }
  const steps = [-2, -1, 0, 2];
  return d1 + steps[Math.floor(rng() * steps.length)];
}
//// /取下一个音高度数 ////

//// 取一个小节节奏型(对齐拍格、和为 4 拍) [@x380kkm 2026-06-20] ////
function pickBarPattern(rng) {
  const counts = {};
  BAR_PATTERNS.forEach((b, i) => { counts[i] = b.w; });
  return BAR_PATTERNS[parseInt(pickWeighted(counts, rng), 10)].pat;
}
//// /取一个小节节奏型 ////

//// 生成一个乐句:若干小节,每小节取一节奏型、逐音用马尔可夫采度数;返回 [{deg, beats}] 与续走的状态 [@x380kkm 2026-06-20] ////
function generatePhrase(model, state, bars, rng) {
  const notes = [];
  for (let b = 0; b < bars; b += 1) {
    for (const dur of pickBarPattern(rng)) {
      const deg = nextDegree(model, state.d2, state.d1, rng);
      notes.push({ deg, beats: dur });
      state.d2 = state.d1;
      state.d1 = deg;
    }
  }
  return notes;
}
//// /生成一个乐句 ////

//// 离线随机生成一段旋律:乐句内马尔可夫加小节节奏型,曲式按动机重复编排,末句收于主音 [@x380kkm 2026-06-20] ////
// options:style 风格(缺省 folk)或 model 直接给模型,rng 随机源,tonicMidi 主音(缺省 60=C4),form 曲式字母串(缺省按句数取 AABA/ABA),barsPerPhrase 每句小节数。
function generateMelody(options = {}) {
  const model = options.model || loadModel(options.style || 'folk');
  const scale = model.scale || 'pentatonic';
  const rng = options.rng || Math.random;
  const tonic = options.tonicMidi != null ? options.tonicMidi : 60;
  const barsPerPhrase = options.barsPerPhrase || 2;
  const phrases = options.phrases || 4;
  const form = options.form || (phrases <= 3 ? 'ABA' : 'AABA');

  // 为曲式里出现的每个字母各生成一个乐句(度数序列),重复的字母复用同一乐句以形成动机重复。
  const state = { d2: 0, d1: 0 };
  const startPair = (pickWeighted(model.starts, rng) || '0,2').split(',').map((x) => parseInt(x, 10));
  state.d2 = startPair[0];
  state.d1 = startPair[1];
  const phraseOf = {};
  for (const letter of form) {
    if (!phraseOf[letter]) phraseOf[letter] = generatePhrase(model, state, barsPerPhrase, rng);
  }

  const melody = [];
  const letters = form.split('');
  letters.forEach((letter, pi) => {
    const phrase = phraseOf[letter];
    phrase.forEach((note, ni) => {
      const isFinal = pi === letters.length - 1 && ni === phrase.length - 1;
      const deg = isFinal ? 0 : note.deg; // 末句末音收于主音
      melody.push({ key: tonic + snapToScale(deg, scale), beats: note.beats });
    });
    if (pi < letters.length - 1) melody.push({ rest: 0.5 }); // 句间换气
  });
  return melody;
}
//// /离线随机生成一段旋律 ////

module.exports = { generateMelody, loadModel, snapToScale, pickWeighted, nextDegree, generatePhrase, SCALES, BAR_PATTERNS };
