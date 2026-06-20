// audience: internal
// # composer
// 离线随机作曲的统一架构：把一段曲子拆成三个相互协调的层并按同一骨架生成，解决「完全一个调」的单调。
// 第一层和声：按调式选一条和弦进行（如大调王道 IV-V-iii-vi、小调 i-VI-III-VII），每小节一个调内三和弦，是全曲骨架。
// 第二层节奏：每小节取一个对齐半拍格的节奏型，定下各音的时值与起拍位置，区分强拍（第 1、3 拍）与弱拍。
// 第三层旋律：在和声约束下生成音高，强拍落和弦音（随和弦更替与琶音产生起伏），弱拍用音阶经过音/邻音把强拍音级进连起来，主旋律因此有走向而非停在一个音。
// 曲式按乐句做动机重复（如 AABA），重复的乐句连同它的和弦一起复用，使旋律与配器始终对齐。
// 输出：melody 与 song-score 旋律格式一致（发声音符 { key:MIDI, beats }、换气 { rest }）；chords 为按时间轴排布的和弦跨度，供 accompaniment 配器复用同一套和声。
// 不变量：纯逻辑无副作用；随机源经 options.rng 注入（缺省 Math.random），便于测试可重复。

// 各音阶相对主音的半音度数：pentatonic 宫调五声、diatonic 自然大调七声、minor 自然小调七声。
const SCALES = {
  pentatonic: [0, 2, 4, 7, 9],
  diatonic: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

// 4/4 小节的节奏型：各型时值之和为 4 拍、都落在半拍格上；权重偏向均匀与常见 pop 切分。每型都含落在第 1 拍与第 3 拍的音，以提供强拍锚点。
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

// 各调式的和弦进行候选：元素为调内音阶级序号（0 起），每条配权重。大调含 J-pop 王道与轴式进行，小调含常见自然小调走向。
const PROGRESSIONS = {
  major: [
    { prog: [0, 4, 5, 3], w: 3 }, // I-V-vi-IV 轴式
    { prog: [0, 5, 3, 4], w: 2 }, // I-vi-IV-V 五十年代
    { prog: [5, 3, 0, 4], w: 2 }, // vi-IV-I-V
    { prog: [3, 4, 2, 5], w: 3 }, // IV-V-iii-vi 王道
    { prog: [0, 3, 4, 0], w: 2 }, // I-IV-V-I
    { prog: [0, 4, 5, 4], w: 1 }, // I-V-vi-V
    { prog: [3, 4, 0, 0], w: 1.5 }, // IV-V-I-I
  ],
  minor: [
    { prog: [0, 5, 2, 6], w: 3 }, // i-VI-III-VII
    { prog: [0, 3, 4, 0], w: 2 }, // i-iv-v-i
    { prog: [0, 6, 5, 6], w: 2 }, // i-VII-VI-VII
    { prog: [0, 5, 6, 0], w: 2 }, // i-VI-VII-i
    { prog: [0, 2, 5, 4], w: 1.5 }, // i-III-VI-v
    { prog: [0, 3, 6, 4], w: 1.5 }, // i-iv-VII-v
  ],
};

// 句间气口拍数：从非末句尾部刻出，留作换气，且保持每句严格等于整小节。
const BREATH = 0.5;
// 乐句内的走向形状：把乐句进度 frac(0..1)映成目标音高的相对高低(0..1),不同形状给出不同旋律线,是消除「每句一个拱」雷同的关键。
const CONTOUR_SHAPES = {
  arch: (f) => 4 * f * (1 - f), // 拱形:中间高、两头低
  rise: (f) => f, // 上行
  fall: (f) => 1 - f, // 下行
  valley: (f) => 1 - 4 * f * (1 - f), // 谷形:两头高、中间低
  wave: (f) => 0.5 - 0.5 * Math.cos(4 * Math.PI * f), // 起伏:两个波峰
  peakLate: (f) => (f < 0.75 ? f / 0.75 : 1 - (f - 0.75) / 0.25), // 后段冲高再回落
};
// 默认风格档案:旋律可唱窗口(相对主音半音上下界)、走向基线/振幅/抖动、可选轮廓形状、中跳抑制权重;缺省即既有行为。
const DEFAULT_PROFILE = {
  register: { lo: -5, hi: 16 },
  base: 3,
  amp: 7,
  jitter: 1.5,
  shapes: ['arch'],
  midLeapW: 0.15,
};
// 旋律取音各项权重:数据(语料二阶转移)是主因,轮廓与跳度是软约束。
const DATA_POW = 1.0; // 语料转移计数的幂:1 即按训练频次正比,越大越死守语料。
const DATA_EPS = 0.2; // 给调内每个候选音的底数:即便语料没覆盖也留一点可能,避免走死、并稍作平滑。
const REPEAT_PEN = 0.3; // 与上一音同高的惩罚系数:压低原地不动,防「一个调」。
const BIG_LEAP_DEG = 9; // 超过此半音差视为过大跳,额外指数压制。

//// 按风格加载对应模型文件 [@x380kkm 2026-06-20] ////
function loadModel(style) {
  return require(`./melody-model-${style}.json`);
}
//// /按风格加载对应模型文件 ////

//// 按计数权重从 { 键： 次数 } 里随机取一个键，空表回 null [@x380kkm 2026-06-20] ////
function pickWeighted(counts, rng) {
  let total = 0;
  for (const k in counts) total += counts[k];
  if (total <= 0) return null;
  let r = rng() * total;
  for (const k in counts) { r -= counts[k]; if (r < 0) return k; }
  return Object.keys(counts)[0];
}
//// /按计数权重随机取一个键 ////

//// 把相对主音的半音度数吸附到最近的音阶度数（跨八度）；无音阶则原样返回 [@x380kkm 2026-06-20] ////
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

//// 取一个音级（0-11）在音阶里最近的音级，用于把和弦音吸附到旋律音阶（如五声） [@x380kkm 2026-06-20] ////
function nearestScalePc(pc, scaleSet) {
  let best = scaleSet[0];
  let bestDist = 99;
  for (const s of scaleSet) {
    const d = Math.min(((pc - s) % 12 + 12) % 12, ((s - pc) % 12 + 12) % 12);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best;
}
//// /取音阶里最近的音级 ////

//// 在某音阶上以某级为根叠三度成三和弦：返回根音级与三个音级（均为 0-11 音级） [@x380kkm 2026-06-20] ////
function triad(scaleSet, degIndex) {
  const L = scaleSet.length;
  const idxs = [degIndex, degIndex + 2, degIndex + 4];
  const pcs = idxs.map((i) => (scaleSet[i % L] + 12 * Math.floor(i / L)) % 12);
  return { root: scaleSet[degIndex % L] % 12, pcs };
}
//// /叠三度成三和弦 ////

//// 列出旋律音阶在可唱窗口内的全部音高（相对主音、升序），作为级进的「梯子」；register 给上下界 [@x380kkm 2026-06-20] ////
function buildLadder(scaleSet, register = DEFAULT_PROFILE.register) {
  const out = [];
  for (let oct = -1; oct <= 2; oct += 1) {
    for (const p of scaleSet) {
      const v = p + 12 * oct;
      if (v >= register.lo && v <= register.hi) out.push(v);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}
//// /列出旋律音阶的梯子 ////

//// 取数组里最接近某值的元素 [@x380kkm 2026-06-20] ////
function nearestIn(arr, x) {
  let best = arr[0];
  let bd = Infinity;
  for (const v of arr) { const d = Math.abs(v - x); if (d < bd) { bd = d; best = v; } }
  return best;
}
//// /取数组里最接近的元素 ////

//// 把时值吸附到半拍格(最小 0.5),并格式化成 dur1 表的键(整数补 .0) [@x380kkm 2026-06-20] ////
function snapDur(d) {
  const s = Math.max(0.5, Math.round(d * 2) / 2);
  return s;
}
function durKey(d) {
  return Number.isInteger(d) ? d.toFixed(1) : String(d);
}
//// /时值吸附与键格式化 ////

//// 取一个小节节奏型:优先用语料训练的时值转移 dur1 采样并填满 4 拍,无 dur 数据时退回内置型 [@x380kkm 2026-06-20] ////
function pickBarPattern(rng, model, state) {
  const hasDur = model && model.dur1 && model.durStart && Object.keys(model.durStart).length > 0;
  if (!hasDur) {
    const counts = {};
    BAR_PATTERNS.forEach((b, i) => { counts[i] = b.w; });
    return BAR_PATTERNS[parseInt(pickWeighted(counts, rng), 10)].pat;
  }
  const out = [];
  let rem = BEATS_PER_BAR;
  while (rem > 1e-9) {
    const tbl = (state.prev != null && model.dur1[durKey(state.prev)]) || model.durStart;
    let d = snapDur(parseFloat(pickWeighted(tbl, rng)));
    if (d > rem) d = rem; // 末尾截到正好填满整小节
    out.push(d);
    rem -= d;
    state.prev = d;
  }
  return out;
}
//// /取一个小节节奏型 ////

//// 取乐句起始的两个度数:用语料的 starts 分布,吸附到调内梯子;无则居中起 [@x380kkm 2026-06-20] ////
function sampleStart(model, ladder, rng) {
  if (model && model.starts) {
    const pair = pickWeighted(model.starts, rng);
    if (pair) {
      const [a, b] = pair.split(',').map((x) => parseInt(x, 10));
      return [nearestIn(ladder, a), nearestIn(ladder, b)];
    }
  }
  return [0, ladder[Math.floor(ladder.length / 2)]];
}
//// /取乐句起始度数 ////

//// 选一条和弦进行，按每句小节数裁到合适长度（不足则循环）；pool 缺省按调式取内置池 [@x380kkm 2026-06-20] ////
function pickProgression(mode, bars, rng, pool) {
  const p = pool || PROGRESSIONS[mode] || PROGRESSIONS.major;
  const counts = {};
  p.forEach((x, i) => { counts[i] = x.w; });
  const prog = p[parseInt(pickWeighted(counts, rng), 10)].prog;
  const out = [];
  for (let b = 0; b < bars; b += 1) out.push(prog[b % prog.length]);
  return out;
}
//// /选一条和弦进行 ////

//// 算乐句内某进度的目标音高：按所选轮廓形状给出相对高低,叠基线、振幅与随机抖动 [@x380kkm 2026-06-20] ////
function contourTarget(frac, rng, profile, shapeName) {
  const shape = CONTOUR_SHAPES[shapeName] || CONTOUR_SHAPES.arch;
  return profile.base + profile.amp * shape(frac) + (rng() * 2 - 1) * profile.jitter;
}
//// /算乐句内目标音高 ////

//// 列出某和弦在梯子上的和弦音度数（和弦音先吸附到旋律音阶），空则退回整把梯子 [@x380kkm 2026-06-20] ////
function chordDegrees(chord, scaleSet, ladder) {
  const pcs = new Set(chord.pcs.map((pc) => nearestScalePc(((pc % 12) + 12) % 12, scaleSet)));
  const c = ladder.filter((v) => pcs.has(((v % 12) + 12) % 12));
  return c.length ? c : ladder.slice();
}
//// /列出和弦音度数 ////

//// 取下一个度数：以语料二阶转移 pitch2 为主因加权,叠轮廓软拉、抑同音与过大跳;强拍限定在和弦音里 [@x380kkm 2026-06-20] ////
// universe 为可选音集(强拍传和弦音、弱拍传整把梯子);d2,d1 为前两音度数;target 为本拍轮廓目标音高;midLeapW 越大越偏级进。
function pickNextDegree(model, d2, d1, universe, target, midLeapW, rng) {
  const trans = (model && model.pitch2 && model.pitch2[`${d2},${d1}`]) || null;
  // 把语料转移按落点吸附到 universe,累加成各候选的数据权重。
  const dataW = {};
  if (trans) {
    for (const k in trans) { const g = nearestIn(universe, parseInt(k, 10)); dataW[g] = (dataW[g] || 0) + trans[k]; }
  }
  const sigma = 4; // 轮廓软拉的半音容差:越大越松,让数据主导音高、轮廓只管大致音区。
  const w = {};
  let total = 0;
  for (const g of universe) {
    const base = (dataW[g] || 0) + DATA_EPS;
    const contour = Math.exp(-((g - target) * (g - target)) / (2 * sigma * sigma));
    const leapAbs = Math.abs(g - d1);
    const leap = Math.exp(-Math.max(0, leapAbs - 2) * midLeapW) * (leapAbs > BIG_LEAP_DEG ? Math.exp(-(leapAbs - BIG_LEAP_DEG) * 0.6) : 1);
    const rep = g === d1 ? REPEAT_PEN : 1;
    w[g] = (base ** DATA_POW) * contour * leap * rep;
    total += w[g];
  }
  let r = rng() * total;
  for (const g of universe) { r -= w[g]; if (r < 0) return g; }
  return universe[universe.length - 1];
}
//// /取下一个度数 ////

//// 生成一个乐句:节奏取自语料 dur1、音高从语料 pitch2 左到右取,强拍限在和弦音(和声骨架)、弱拍自由级进,轮廓软拉音区 [@x380kkm 2026-06-20] ////
// chords 为半小节(每 2 拍)一个和弦,长度 bars*2;profile 给音域、走向与跳度;shape 为本句轮廓形状名;model 提供语料分布。
function composePhrase(chords, scaleSet, ladder, model, bars, rng, profile, shape) {
  // 第二层节奏:逐小节用语料时值转移取节奏型,记下每音的时值、小节内起拍与是否强拍(第 1、3 拍)。
  const slots = [];
  const durState = { prev: null };
  for (let b = 0; b < bars; b += 1) {
    let pos = 0;
    for (const dur of pickBarPattern(rng, model, durState)) {
      const strong = Math.abs(pos - 0) < 1e-9 || Math.abs(pos - 2) < 1e-9;
      slots.push({ beats: dur, bar: b, onset: pos, strong });
      pos += dur;
    }
  }
  // 取某槽位所在半小节的和弦:第 1 拍起属前半,第 3 拍起属后半。
  const chordOf = (slot) => chords[slot.bar * 2 + (slot.onset >= 2 ? 1 : 0)];
  // 第三层旋律:从语料起始度数出发,逐音用语料转移取下一音;强拍限定在所在和弦的和弦音、弱拍可走整把梯子,轮廓软拉音区。
  let [d2, d1] = sampleStart(model, ladder, rng);
  slots.forEach((slot, i) => {
    const frac = slots.length > 1 ? i / (slots.length - 1) : 0;
    const target = contourTarget(frac, rng, profile, shape);
    const universe = slot.strong ? chordDegrees(chordOf(slot), scaleSet, ladder) : ladder;
    const g = pickNextDegree(model, d2, d1, universe, target, profile.midLeapW, rng);
    slot.pitch = g;
    d2 = d1;
    d1 = g;
  });
  return { notes: slots.map((s) => ({ pitch: s.pitch, beats: s.beats })), chords };
}
//// /生成一个乐句 ////

//// 离线随机作曲：和弦骨架 + 节奏 + 和声约束下的旋律，按曲式做动机重复，返回旋律与对齐的和弦跨度 [@x380kkm 2026-06-20] ////
// options:style 风格（缺省 folk）或 model 直接给模型，rng 随机源，tonicMidi 主音（缺省 60=C4），
//   form 曲式字母串（缺省按句数取 AABA/ABA），barsPerPhrase 每句小节数（缺省 2），phrases 句数（缺省 4），
//   breathAtEnd 末句也收主音并刻气口（缺省 false）：用于把本段当作长曲的一段、与后段严格按小节拼接时留出段间换气，
//   profile 风格档案（缺省 DEFAULT_PROFILE）：给音域、走向基线/振幅/抖动、可选轮廓形状集、中跳抑制，是拉开风格差异的旋律侧旋钮，
//   progressions 自定义和弦进行池（缺省按调式取内置池）。
function compose(options = {}) {
  const model = options.model || loadModel(options.style || 'folk');
  const scale = model.scale || 'pentatonic';
  const rng = options.rng || Math.random;
  const tonic = options.tonicMidi != null ? options.tonicMidi : 60;
  const bars = options.barsPerPhrase || 2;
  const phrases = options.phrases || 4;
  const form = options.form || (phrases <= 3 ? 'ABA' : 'AABA');
  const breathAtEnd = options.breathAtEnd || false;
  const profile = Object.assign({}, DEFAULT_PROFILE, options.profile);
  const shapes = (profile.shapes && profile.shapes.length) ? profile.shapes : DEFAULT_PROFILE.shapes;

  const melodyScale = SCALES[scale] || SCALES.pentatonic;
  // 五声调式的和声借用其母大调，使和弦功能成立，旋律仍吸附回五声。
  const mode = scale === 'minor' ? 'minor' : 'major';
  const harmonyScale = scale === 'minor' ? SCALES.minor : SCALES.diatonic;
  const ladder = buildLadder(melodyScale, profile.register);

  // 为曲式里每个字母各作一个乐句（连同其和弦），重复字母复用同一乐句以成动机重复；不同字母用档案里不同的轮廓形状,拉开句间走向。
  const phraseOf = {};
  let shapeNo = 0;
  for (const letter of form) {
    if (phraseOf[letter]) continue;
    // 每半小节一个和弦:取 bars*2 个,使每句铺满一整条进行(如 I-V-vi-IV),和声有走动而非停在 I-V。
    const progDeg = pickProgression(mode, bars * 2, rng, options.progressions);
    const chords = progDeg.map((d) => triad(harmonyScale, d));
    const shape = shapes[shapeNo % shapes.length];
    shapeNo += 1;
    phraseOf[letter] = composePhrase(chords, melodyScale, ladder, model, bars, rng, profile, shape);
  }

  // 第一层与第三层落地为时间轴：逐乐句铺音符并记和弦跨度；非末句从尾部刻出气口，使每句严格等于 bars*4 拍，
  // 整曲严格按 4/4 小节，便于与伴奏（MMA 等严格小节）逐拍对齐、不漂移；末句末音收于主音。
  const melody = [];
  const chordSpans = [];
  const letters = form.split('');
  let cum = 0;
  letters.forEach((letter, pi) => {
    const phrase = phraseOf[letter];
    const isLast = pi === letters.length - 1;
    phrase.chords.forEach((c, h) => {
      chordSpans.push({ startBeat: cum + h * (BEATS_PER_BAR / 2), beats: BEATS_PER_BAR / 2, root: c.root, pcs: c.pcs });
    });
    const notes = phrase.notes.map((nt) => ({ key: tonic + nt.pitch, beats: nt.beats }));
    // 末句收主音（resolve）；非末句、或末句但要求段尾换气时，从尾部刻出 BREATH 拍作气口（总拍数不变）。
    const breathe = !isLast || breathAtEnd;
    if (isLast) notes[notes.length - 1].key = tonic;
    if (breathe) {
      let need = BREATH;
      while (need > 1e-9 && notes.length) {
        const lastN = notes[notes.length - 1];
        if (lastN.beats > need + 1e-9) { lastN.beats = Number((lastN.beats - need).toFixed(6)); need = 0; }
        else { need = Number((need - lastN.beats).toFixed(6)); notes.pop(); }
      }
    }
    notes.forEach((nt) => { melody.push(nt); cum += nt.beats; });
    if (breathe) { melody.push({ rest: BREATH }); cum += BREATH; }
  });
  return { melody, chords: chordSpans, tonicMidi: tonic, scale };
}
//// /离线随机作曲 ////

module.exports = {
  compose, loadModel, snapToScale, triad, buildLadder, pickProgression,
  SCALES, BAR_PATTERNS, PROGRESSIONS, CONTOUR_SHAPES, DEFAULT_PROFILE,
};
