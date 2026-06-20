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

// 旋律可唱窗口：相对主音的半音上下界，约一个八度多一点，既不过窄也便于发声。
const LO = -5;
const HI = 16;
// 句间气口拍数：从非末句尾部刻出，留作换气，且保持每句严格等于整小节。
const BREATH = 0.5;
// 旋律走向（乐句内拱形）的基线、振幅与抖动：目标音高随乐句进度先升后降，留出起伏空间。
const CONTOUR = { base: 3, amp: 7, jitter: 1.5 };
// 旋律打分各项权重：与目标走向的贴近、抑制大跳、风格音级偏好的温和加成、softmax 温度。
const TARGET_W = 1.0;
const BIG_LEAP_W = 1.2;
const MID_LEAP_W = 0.15;
const STYLE_W = 0.6;
const TEMP = 1.3;

//// 按风格加载对应模型文件 [@x380kkm 2026-06-20] ////
function loadModel(style) {
  return require(`./melody-model-${style}.json`);
}
//// /按风格加载对应模型文件 ////

//// 把数字夹在闭区间内 [@x380kkm 2026-06-20] ////
function clamp(x, lo, hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}
//// /把数字夹在闭区间内 ////

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

//// 列出旋律音阶在可唱窗口内的全部音高（相对主音、升序），作为级进的「梯子」 [@x380kkm 2026-06-20] ////
function buildLadder(scaleSet) {
  const out = [];
  for (let oct = -1; oct <= 2; oct += 1) {
    for (const p of scaleSet) {
      const v = p + 12 * oct;
      if (v >= LO && v <= HI) out.push(v);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}
//// /列出旋律音阶的梯子 ////

//// 取梯子上最接近某音高的下标 [@x380kkm 2026-06-20] ////
function ladderIndex(ladder, pitch) {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < ladder.length; i += 1) {
    const d = Math.abs(ladder[i] - pitch);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi;
}
//// /取梯子上最近的下标 ////

//// 从模型的音高转移统计出各音级的出现偏好，折成温和的对数加成（注入风格，但不夺和声主导） [@x380kkm 2026-06-20] ////
function degreePrior(model, scaleSet) {
  const pc = {};
  const trans = (model && model.pitch2) || {};
  for (const k in trans) {
    const t = trans[k];
    for (const d in t) { const p = ((parseInt(d, 10) % 12) + 12) % 12; pc[p] = (pc[p] || 0) + t[d]; }
  }
  const total = Object.values(pc).reduce((a, b) => a + b, 0) || 1;
  const bonus = {};
  for (const p of scaleSet) bonus[p] = Math.log((pc[p] || 0.5) / total + 1e-3);
  return bonus;
}
//// /从模型统计音级偏好 ////

//// 取一个小节节奏型（对齐拍格、和为 4 拍） [@x380kkm 2026-06-20] ////
function pickBarPattern(rng) {
  const counts = {};
  BAR_PATTERNS.forEach((b, i) => { counts[i] = b.w; });
  return BAR_PATTERNS[parseInt(pickWeighted(counts, rng), 10)].pat;
}
//// /取一个小节节奏型 ////

//// 选一条和弦进行，按每句小节数裁到合适长度（不足则循环） [@x380kkm 2026-06-20] ////
function pickProgression(mode, bars, rng) {
  const pool = PROGRESSIONS[mode] || PROGRESSIONS.major;
  const counts = {};
  pool.forEach((p, i) => { counts[i] = p.w; });
  const prog = pool[parseInt(pickWeighted(counts, rng), 10)].prog;
  const out = [];
  for (let b = 0; b < bars; b += 1) out.push(prog[b % prog.length]);
  return out;
}
//// /选一条和弦进行 ////

//// 算乐句内某进度的目标音高：拱形先升后降，加随机抖动 [@x380kkm 2026-06-20] ////
function contourTarget(frac, rng) {
  const arch = 4 * frac * (1 - frac);
  return CONTOUR.base + CONTOUR.amp * arch + (rng() * 2 - 1) * CONTOUR.jitter;
}
//// /算乐句内目标音高 ////

//// 列出某和弦在可唱窗口内的全部和弦音音高（和弦音先吸附到旋律音阶），无则退回整把梯子 [@x380kkm 2026-06-20] ////
function anchorCandidates(chord, scaleSet, ladder) {
  const pcs = new Set(chord.pcs.map((pc) => nearestScalePc(((pc % 12) + 12) % 12, scaleSet)));
  const c = ladder.filter((v) => pcs.has(((v % 12) + 12) % 12));
  return c.length ? c : ladder.slice();
}
//// /列出和弦音候选 ////

//// 在候选和弦音里挑强拍锚音：硬性排除上一锚音以保证骨架走动，再贴近目标走向、抑制大跳、带风格偏好，softmax 加权随机 [@x380kkm 2026-06-20] ////
function pickAnchor(cands, target, prev, degBonus, rng) {
  // 上一锚音存在且尚有别的候选时，排除它，保证相邻强拍不停在同一音（消除「一个调」式重复）。
  let pool = cands;
  if (prev != null) { const f = cands.filter((p) => p !== prev); if (f.length) pool = f; }
  const scored = pool.map((p) => {
    let s = -Math.abs(p - target) * TARGET_W;
    if (prev != null) {
      const leap = Math.abs(p - prev);
      if (leap > 7) s -= (leap - 7) * BIG_LEAP_W; // 抑制大跳（>纯五度）
      else if (leap >= 3) s -= (leap - 2) * MID_LEAP_W; // 轻抑中跳，给琶音留余地
    }
    s += STYLE_W * (degBonus[((p % 12) + 12) % 12] != null ? degBonus[((p % 12) + 12) % 12] : -3);
    return { p, s };
  });
  const mx = Math.max(...scored.map((x) => x.s));
  const w = {};
  scored.forEach((x, i) => { w[i] = Math.exp((x.s - mx) / TEMP); });
  return scored[parseInt(pickWeighted(w, rng), 10)].p;
}
//// /挑强拍锚音 ////

//// 用音阶经过音/邻音把两个强拍锚音连起来：同高时上下邻音摆动，异高时沿梯子线性级进，末了去掉相邻同音 [@x380kkm 2026-06-20] ////
function fillBetween(a, b, k, ladder) {
  const ia = ladderIndex(ladder, a);
  const ib = ladderIndex(ladder, b);
  const idxs = [];
  if (ia === ib) {
    for (let j = 1; j <= k; j += 1) idxs.push(clamp(ia + ((j % 2 === 1) ? 1 : -1), 0, ladder.length - 1));
  } else {
    for (let j = 1; j <= k; j += 1) idxs.push(clamp(Math.round(ia + (ib - ia) * j / (k + 1)), 0, ladder.length - 1));
  }
  // 把首尾锚音一并纳入，逐个让填充音既不等于前一音、也不等于后一音（含末锚），挪到离两邻中点最近的合法音阶级。
  const seq = [ia, ...idxs, ib];
  const last = ladder.length - 1;
  for (let i = 1; i < seq.length - 1; i += 1) {
    if (seq[i] !== seq[i - 1] && seq[i] !== seq[i + 1]) continue;
    const mid = (seq[i - 1] + seq[i + 1]) / 2;
    const opts = [seq[i] + 1, seq[i] - 1, seq[i] + 2, seq[i] - 2]
      .filter((c) => c >= 0 && c <= last && c !== seq[i - 1] && c !== seq[i + 1]);
    if (opts.length) { opts.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid)); seq[i] = opts[0]; }
  }
  return seq.slice(1, -1).map((idx) => ladder[idx]);
}
//// /经过音连接两个锚音 ////

//// 生成一个乐句：定节奏型并标强拍 → 强拍落和弦锚音 → 弱拍用经过音填充，返回 [{pitch, beats}] 与各半小节和弦 [@x380kkm 2026-06-20] ////
// chords 为半小节(每 2 拍)一个和弦,长度 bars*2;强拍(第 1、3 拍)各对应本半小节的和弦,使强拍锚音逐个勾勒整条进行。
function composePhrase(chords, scaleSet, ladder, degBonus, bars, rng) {
  // 第二层节奏：逐小节取节奏型，记下每个音的时值、小节内起拍位置与是否强拍（第 1、3 拍）。
  const slots = [];
  for (let b = 0; b < bars; b += 1) {
    let pos = 0;
    for (const dur of pickBarPattern(rng)) {
      const strong = Math.abs(pos - 0) < 1e-9 || Math.abs(pos - 2) < 1e-9;
      slots.push({ beats: dur, bar: b, onset: pos, strong });
      pos += dur;
    }
  }
  // 取某槽位所在半小节的和弦:第 1 拍起属前半,第 3 拍起属后半。
  const chordOf = (slot) => chords[slot.bar * 2 + (slot.onset >= 2 ? 1 : 0)];
  // 第三层旋律（强拍）：强拍按所在半小节的和弦取锚音，沿乐句拱形走向并接续前一锚音。
  const strongIdx = slots.map((s, i) => (s.strong ? i : -1)).filter((i) => i >= 0);
  let prev = null;
  strongIdx.forEach((si, n) => {
    const cands = anchorCandidates(chordOf(slots[si]), scaleSet, ladder);
    const frac = strongIdx.length > 1 ? n / (strongIdx.length - 1) : 0;
    slots[si].pitch = pickAnchor(cands, contourTarget(frac, rng), prev, degBonus, rng);
    prev = slots[si].pitch;
  });
  // 第三层旋律（弱拍）：相邻两强拍之间的弱拍用经过音连；末个强拍之后的尾部弱拍沿梯子缓降。
  for (let n = 0; n < strongIdx.length; n += 1) {
    const from = strongIdx[n];
    const to = n + 1 < strongIdx.length ? strongIdx[n + 1] : slots.length;
    const run = to - from - 1;
    if (run <= 0) continue;
    if (n + 1 < strongIdx.length) {
      const fills = fillBetween(slots[from].pitch, slots[to].pitch, run, ladder);
      for (let j = 0; j < run; j += 1) slots[from + 1 + j].pitch = fills[j];
    } else {
      // 尾部弱拍沿梯子缓降，每步挪一个音阶级；触底则反弹，始终不出现相邻同音。
      let idx = ladderIndex(ladder, slots[from].pitch);
      for (let j = 1; j <= run; j += 1) {
        let nxt = idx - 1;
        if (nxt < 0) nxt = idx + 1;
        slots[from + j].pitch = ladder[nxt];
        idx = nxt;
      }
    }
  }
  return { notes: slots.map((s) => ({ pitch: s.pitch, beats: s.beats })), chords };
}
//// /生成一个乐句 ////

//// 离线随机作曲：和弦骨架 + 节奏 + 和声约束下的旋律，按曲式做动机重复，返回旋律与对齐的和弦跨度 [@x380kkm 2026-06-20] ////
// options:style 风格（缺省 folk）或 model 直接给模型，rng 随机源，tonicMidi 主音（缺省 60=C4），
//   form 曲式字母串（缺省按句数取 AABA/ABA），barsPerPhrase 每句小节数（缺省 2），phrases 句数（缺省 4），
//   breathAtEnd 末句也收主音并刻气口（缺省 false）：用于把本段当作长曲的一段、与后段严格按小节拼接时留出段间换气。
function compose(options = {}) {
  const model = options.model || loadModel(options.style || 'folk');
  const scale = model.scale || 'pentatonic';
  const rng = options.rng || Math.random;
  const tonic = options.tonicMidi != null ? options.tonicMidi : 60;
  const bars = options.barsPerPhrase || 2;
  const phrases = options.phrases || 4;
  const form = options.form || (phrases <= 3 ? 'ABA' : 'AABA');
  const breathAtEnd = options.breathAtEnd || false;

  const melodyScale = SCALES[scale] || SCALES.pentatonic;
  // 五声调式的和声借用其母大调，使和弦功能成立，旋律仍吸附回五声。
  const mode = scale === 'minor' ? 'minor' : 'major';
  const harmonyScale = scale === 'minor' ? SCALES.minor : SCALES.diatonic;
  const ladder = buildLadder(melodyScale);
  const degBonus = degreePrior(model, melodyScale);

  // 为曲式里每个字母各作一个乐句（连同其和弦），重复字母复用同一乐句以成动机重复。
  const phraseOf = {};
  for (const letter of form) {
    if (phraseOf[letter]) continue;
    // 每半小节一个和弦:取 bars*2 个,使每句铺满一整条进行(如 I-V-vi-IV),和声有走动而非停在 I-V。
    const progDeg = pickProgression(mode, bars * 2, rng);
    const chords = progDeg.map((d) => triad(harmonyScale, d));
    phraseOf[letter] = composePhrase(chords, melodyScale, ladder, degBonus, bars, rng);
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
  compose, loadModel, snapToScale, triad, buildLadder, pickProgression, degreePrior,
  SCALES, BAR_PATTERNS, PROGRESSIONS,
};
