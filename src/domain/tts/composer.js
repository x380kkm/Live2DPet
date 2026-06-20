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

// 功能和声的转移概率（调内音阶级序号 0 起 → 下一级:权重）：和弦进行不再用固定模板,而是在这张表上随机游走,既守功能习惯又每首不同。
const CHORD_TRANS = {
  major: {
    0: { 3: 3, 4: 3, 5: 2, 1: 1, 2: 1 }, // I → IV V vi ii iii
    1: { 4: 3, 3: 1, 6: 1 }, // ii → V IV vii°
    2: { 5: 2, 3: 1 }, // iii → vi IV
    3: { 4: 3, 0: 2, 1: 1, 5: 1 }, // IV → V I ii vi
    4: { 0: 4, 5: 2 }, // V → I vi
    5: { 3: 2, 1: 2, 4: 1, 2: 1 }, // vi → IV ii V iii
    6: { 0: 3 }, // vii° → I
  },
  minor: {
    0: { 5: 3, 3: 2, 6: 2, 2: 1, 4: 1 }, // i → VI iv VII III v
    1: { 4: 2, 0: 1 }, // ii° → v i
    2: { 5: 2, 6: 1, 3: 1 }, // III → VI VII iv
    3: { 0: 2, 4: 1, 5: 1 }, // iv → i v VI
    4: { 0: 3, 5: 1 }, // v → i VI
    5: { 3: 2, 6: 2, 2: 1 }, // VI → iv VII III
    6: { 0: 2, 2: 2 }, // VII → i III
  },
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
  midLeapW: 0.10,
};
// 旋律取音各项权重:数据(语料二阶转移)是主因,轮廓与跳度是软约束。
const DATA_POW = 1.0; // 语料转移计数的幂:1 即按训练频次正比,越大越死守语料。
const DATA_EPS = 0.05; // 给调内每个候选音的底数:留一点未覆盖音的可能,但很小,让语料(含其大跳)主导而非被平滑磨平。
const REPEAT_PEN = 0.3; // 与上一音同高的惩罚系数:压低原地不动,防「一个调」。
const CONTOUR_SIGMA = 10; // 轮廓软拉的半音容差:放宽,让轮廓只定大致音区,不把语料的大跳拉回级进。
const BIG_LEAP_DEG = 12; // 仅超过八度才算过大跳并指数压制,保留语料里小幅与中等的戏剧性跳进。
const STRONG_CHORD_BONUS = 14; // 强拍落和弦音的加权:足够强使绝大多数强拍是和弦音(和声清晰),仍非硬锁、偶尔容经过音/倚音。
const WEAK_CHORD_BONUS = 1.3; // 弱拍的和弦音加权:很弱,基本由语料自由级进。
const CONSONANCE_PEN = 0.12; // 与同拍另一声部成不协和音程(小二/大二/三全音/七度)时的衰减系数:越小越避让,使第二声部不与主旋律撞音。
const COUNTER_SPLIT_PROB = 0.4; // 第二声部把主声部长音(不短于 COUNTER_LONG_BEATS)劈成两半的概率:人声持续时吉他走动,繁简法里第二声部作「繁」。
const COUNTER_MERGE_PROB = 0.35; // 第二声部把主声部相邻短音(不长于 COUNTER_SHORT_BEATS)并成一个的概率:人声密集时吉他持续,繁简法里第二声部作「简」。
const COUNTER_LONG_BEATS = 1.5; // 视为「长音」可劈的下限拍数。
const COUNTER_SHORT_BEATS = 0.5; // 视为「短音」可并的上限拍数。
// 曲式候选:按句数取一组,每首随机选一种,不再永远 AABA;重复字母表示同一动机的再现(本作曲器做变奏式再现,非逐音照搬)。
const FORMS = {
  2: ['AB', 'AA'],
  3: ['ABA', 'ABC', 'AAB', 'ABB'],
  4: ['AABA', 'ABAB', 'ABAC', 'ABCA', 'ABCB', 'AABB'],
  5: ['AABAB', 'ABACA', 'ABABC', 'ABACD'],
  6: ['AABABA', 'ABACAB', 'ABABCB'],
};
//// 按乐句数随机取一种曲式;无对应表则退回全不同字母(通谱) [@x380kkm 2026-06-20] ////
function pickForm(phrases, rng) {
  const pool = FORMS[phrases];
  if (!pool) return Array.from({ length: phrases }, (_, i) => String.fromCharCode(65 + i)).join('');
  return pool[Math.floor(rng() * pool.length)];
}
//// /随机取一种曲式 ////

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

//// 在和弦转移表上随机游走出一条 n 个和弦的进行(音阶级序号):优先用风格各自的和声档,缺则退回旋律模型的 chordTrans,再缺用内置功能和声表 [@x380kkm 2026-06-21] ////
// spec 一套和声档 { mode, chordTrans, chordStart, holdProb };holdProb 为保持上一和弦的概率,体现各风格的和声节奏(电子换得慢、音乐剧换得快)。
function walkProgression(spec, mode, n, rng) {
  const T = (spec && spec.chordTrans) || CHORD_TRANS[mode] || CHORD_TRANS.major;
  const holdProb = (spec && spec.holdProb) || 0;
  // 起始和弦:有起始分布则按它采样(动漫多起于 I 或 V),否则落主和弦。
  let cur = 0;
  if (spec && spec.chordStart) { const s = pickWeighted(spec.chordStart, rng); if (s != null) cur = parseInt(s, 10); }
  const out = [cur];
  for (let i = 1; i < n; i += 1) {
    // 按和声节奏的保持概率决定本半小节是否沿用上一和弦(持续/踏板),否则在转移表上走一步。
    if (holdProb && rng() < holdProb) { out.push(cur); continue; }
    const nx = pickWeighted(T[cur] || { 0: 1 }, rng);
    cur = nx != null ? parseInt(nx, 10) : 0;
    out.push(cur);
  }
  return out;
}
//// /随机游走出一条和弦进行 ////

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

// 与某度数成不协和音程(同度0也算撞、小二1、大二2、三全音6、七度10/11)时该衰减,用于第二声部避让主旋律。
const DISSONANT_INTERVALS = new Set([0, 1, 2, 6, 10, 11]);

//// 取下一个度数：以语料二阶转移 pitch2 为主因加权,叠轮廓软拉、抑同音与过大跳,和弦音按 chordBonus 软偏置;avoid 给定则避让与之不协和的音程 [@x380kkm 2026-06-20] ////
// 候选始终是整把梯子;chordSet 为本拍和弦音集合,chordBonus 越大越偏向落和弦音;avoid 为同拍另一声部度数(第二声部用,避免撞音)。
function pickNextDegree(model, d2, d1, ladder, chordSet, chordBonus, target, midLeapW, rng, avoid) {
  const trans = (model && model.pitch2 && model.pitch2[`${d2},${d1}`]) || null;
  // 把语料转移按落点吸附到梯子,累加成各候选的数据权重。
  const dataW = {};
  if (trans) {
    for (const k in trans) { const g = nearestIn(ladder, parseInt(k, 10)); dataW[g] = (dataW[g] || 0) + trans[k]; }
  }
  const w = {};
  let total = 0;
  for (const g of ladder) {
    const base = (dataW[g] || 0) + DATA_EPS;
    const contour = Math.exp(-((g - target) * (g - target)) / (2 * CONTOUR_SIGMA * CONTOUR_SIGMA));
    const leapAbs = Math.abs(g - d1);
    // 只对中等以上跳进按风格轻度抑制(midLeapW 小则更敢跳),八度以上才强压;让语料的戏剧性大跳保留下来。
    const leap = Math.exp(-Math.max(0, leapAbs - 4) * midLeapW) * (leapAbs > BIG_LEAP_DEG ? Math.exp(-(leapAbs - BIG_LEAP_DEG) * 0.5) : 1);
    const rep = g === d1 ? REPEAT_PEN : 1;
    const harm = chordSet.has(g) ? chordBonus : 1;
    // 与主旋律同拍音的音程不协和则衰减(第二声部避让撞音);协和(三六度等)不罚。
    const cons = (avoid != null && DISSONANT_INTERVALS.has(((g - avoid) % 12 + 12) % 12)) ? CONSONANCE_PEN : 1;
    w[g] = (base ** DATA_POW) * contour * leap * rep * harm * cons;
    total += w[g];
  }
  let r = rng() * total;
  for (const g of ladder) { r -= w[g]; if (r < 0) return g; }
  return ladder[ladder.length - 1];
}
//// /取下一个度数 ////

//// 造一个乐句的节奏骨架:逐小节用语料时值转移取节奏型,记下每音的时值、小节内起拍与是否强拍(第 1、3 拍) [@x380kkm 2026-06-20] ////
// 节奏骨架与音高分离:重复乐句复用同一骨架但重采音高,做变奏式再现而非逐音照搬。
function buildBlueprint(model, bars, rng) {
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
  return slots;
}
//// /造节奏骨架 ////

//// 在每小节内对一串时值做繁简变形:长音劈半、相邻短音并一,产出与原节奏相近但互补的时值序列 [@x380kkm 2026-06-21] ////
// 用于第二声部:人声持续(长音)时吉他走动,人声密集(短音连排)时吉他持续;每小节总拍不变,故不破坏小节对齐。
function varyDurs(durs, rng) {
  const out = [];
  for (let i = 0; i < durs.length; i += 1) {
    const d = durs[i];
    if (d >= COUNTER_LONG_BEATS && rng() < COUNTER_SPLIT_PROB) { out.push(d / 2, d / 2); continue; }
    if (d <= COUNTER_SHORT_BEATS && i + 1 < durs.length && durs[i + 1] <= COUNTER_SHORT_BEATS && rng() < COUNTER_MERGE_PROB) {
      out.push(d + durs[i + 1]); i += 1; continue;
    }
    out.push(d);
  }
  return out;
}
//// /对一串时值做繁简变形 ////

//// 由主声部节奏骨架派生第二声部的互补骨架:逐小节做繁简变形后重排出带 bar/onset/strong 的新槽位 [@x380kkm 2026-06-21] ////
// 在每小节内变形并保持小节总拍不变,使第二声部与主声部节奏相近而不同、彼此呼应,且仍逐小节与伴奏对齐。
function varyRhythm(slots, rng) {
  const byBar = new Map();
  for (const s of slots) { if (!byBar.has(s.bar)) byBar.set(s.bar, []); byBar.get(s.bar).push(s.beats); }
  const out = [];
  for (const bar of [...byBar.keys()].sort((a, b) => a - b)) {
    let pos = 0;
    for (const dur of varyDurs(byBar.get(bar), rng)) {
      const strong = Math.abs(pos - 0) < 1e-9 || Math.abs(pos - 2) < 1e-9;
      out.push({ beats: dur, bar, onset: pos, strong });
      pos += dur;
    }
  }
  return out;
}
//// /派生第二声部的互补骨架 ////

//// 在节奏骨架上实现音高:从语料起始度数出发逐音用语料转移取下一音,强拍软偏置落和弦音,轮廓软拉音区 [@x380kkm 2026-06-20] ////
// slots 节奏骨架,chords 半小节和弦序列;每次调用用新的 rng 取样,故同骨架多次实现得到不同旋律(变奏)。
// against 给定则是同骨架另一声部各拍的度数,逐拍避让与之不协和的音程(第二声部据此避开撞人声)。
function realizePhrase(slots, chords, scaleSet, ladder, model, rng, profile, shape, against) {
  const chordOf = (slot) => chords[slot.bar * 2 + (slot.onset >= 2 ? 1 : 0)];
  let [d2, d1] = sampleStart(model, ladder, rng);
  return slots.map((slot, i) => {
    const frac = slots.length > 1 ? i / (slots.length - 1) : 0;
    const target = contourTarget(frac, rng, profile, shape);
    const chordSet = new Set(chordDegrees(chordOf(slot), scaleSet, ladder));
    const bonus = slot.strong ? STRONG_CHORD_BONUS : WEAK_CHORD_BONUS;
    const avoid = against ? against[i] : null;
    const g = pickNextDegree(model, d2, d1, ladder, chordSet, bonus, target, profile.midLeapW, rng, avoid);
    d2 = d1;
    d1 = g;
    return { pitch: g, beats: slot.beats };
  });
}
//// /在节奏骨架上实现音高 ////

//// 离线随机作曲：和弦骨架 + 节奏 + 和声约束下的旋律，按曲式做动机重复，返回旋律与对齐的和弦跨度 [@x380kkm 2026-06-20] ////
// options:style 风格（缺省 folk）或 model 直接给模型，rng 随机源，tonicMidi 主音（缺省 60=C4），
//   form 曲式字母串（缺省按句数取 AABA/ABA），barsPerPhrase 每句小节数（缺省 2），phrases 句数（缺省 4），
//   breathAtEnd 末句也收主音并刻气口（缺省 false）：用于把本段当作长曲的一段、与后段严格按小节拼接时留出段间换气，
//   profile 风格档案（缺省 DEFAULT_PROFILE）：给音域、走向基线/振幅/抖动、可选轮廓形状集、中跳抑制，是拉开风格差异的旋律侧旋钮。
//   和弦进行不用固定模板,而在功能和声转移表上随机游走;曲式不固定 AABA,按句数从候选里随机取并做变奏式再现。
//   withCounter 另出一条第二声部(给吉他):同一套和弦与节奏骨架上走一条独立的马尔可夫线,坐在更高音区,与人声相似但不同、彼此呼应;
//   counterRegisterShift 第二声部相对主声部上移的半音数(缺省 7)。
function compose(options = {}) {
  const model = options.model || loadModel(options.style || 'folk');
  const scale = model.scale || 'pentatonic';
  const rng = options.rng || Math.random;
  const tonic = options.tonicMidi != null ? options.tonicMidi : 60;
  const bars = options.barsPerPhrase || 2;
  const phrases = options.phrases || 4;
  const form = options.form || pickForm(phrases, rng);
  const breathAtEnd = options.breathAtEnd || false;
  const profile = Object.assign({}, DEFAULT_PROFILE, options.profile);
  const shapes = (profile.shapes && profile.shapes.length) ? profile.shapes : DEFAULT_PROFILE.shapes;
  const withCounter = options.withCounter || false;
  const counterShift = options.counterRegisterShift != null ? options.counterRegisterShift : 7;
  // 和声档:优先用风格各自传入的和声档(各风格语汇不同);缺则退回旋律模型自带的和弦字段;再缺由 walkProgression 用内置功能和声表。
  const harmony = options.harmony
    || (model.chordTrans ? { chordTrans: model.chordTrans, chordStart: model.chordStart, holdProb: 0 } : null);

  const melodyScale = SCALES[scale] || SCALES.pentatonic;
  // 五声调式的和声借用其母大调，使和弦功能成立，旋律仍吸附回五声。
  const mode = scale === 'minor' ? 'minor' : 'major';
  const harmonyScale = scale === 'minor' ? SCALES.minor : SCALES.diatonic;
  const ladder = buildLadder(melodyScale, profile.register);
  // 第二声部的「梯子」整体上移,使吉他线坐在人声上方、与人声错开音区。
  const counterLadder = buildLadder(melodyScale, { lo: profile.register.lo + counterShift, hi: profile.register.hi + counterShift });

  // 为曲式里每个字母各造一份「蓝图」:和弦进行（功能和声随机游走）、节奏骨架、主声部与第二声部各自的轮廓形状;重复字母复用同一蓝图。
  const blueprintOf = {};
  let shapeNo = 0;
  for (const letter of form) {
    if (blueprintOf[letter]) continue;
    // 每半小节一个和弦:游走出 bars*2 个,和声按风格各自的和声档走动(转移表与和声节奏均按风格不同)。
    const progDeg = walkProgression(harmony, mode, bars * 2, rng);
    const chords = progDeg.map((d) => triad(harmonyScale, d));
    const shape = shapes[shapeNo % shapes.length];
    const counterShape = shapes[(shapeNo + 1) % shapes.length]; // 第二声部用不同轮廓,走向与主声部分离
    shapeNo += 1;
    blueprintOf[letter] = { chords, slots: buildBlueprint(model, bars, rng), shape, counterShape };
  }

  // 从乐句尾刻出 BREATH 拍作气口(总拍数不变);主、第二声部用同一刻法保持逐拍对齐。
  const carveBreath = (notes) => {
    let need = BREATH;
    while (need > 1e-9 && notes.length) {
      const lastN = notes[notes.length - 1];
      if (lastN.beats > need + 1e-9) { lastN.beats = Number((lastN.beats - need).toFixed(6)); need = 0; }
      else { need = Number((need - lastN.beats).toFixed(6)); notes.pop(); }
    }
  };

  // 第一层与第三层落地为时间轴：逐乐句在蓝图上实现音高（重复字母用同骨架重采音高,做变奏式再现而非逐音照搬），
  // 记和弦跨度；非末句从尾部刻出气口，使每句严格等于 bars*4 拍，整曲严格按 4/4 小节,与伴奏逐拍对齐;末句末音收主音。
  const melody = [];
  const counter = [];
  const chordSpans = [];
  const letters = form.split('');
  let cum = 0;
  letters.forEach((letter, pi) => {
    const bp = blueprintOf[letter];
    const isLast = pi === letters.length - 1;
    bp.chords.forEach((c, h) => {
      chordSpans.push({ startBeat: cum + h * (BEATS_PER_BAR / 2), beats: BEATS_PER_BAR / 2, root: c.root, pcs: c.pcs });
    });
    const breathe = !isLast || breathAtEnd;
    const realized = realizePhrase(bp.slots, bp.chords, melodyScale, ladder, model, rng, profile, bp.shape);
    const notes = realized.map((nt) => ({ key: tonic + nt.pitch, beats: nt.beats }));
    if (isLast) notes[notes.length - 1].key = tonic; // 末句末音收于主音
    if (breathe) carveBreath(notes);
    // 第二声部:在主声部和弦上走另一条独立马尔可夫线(更高音区、不同轮廓),节奏由主声部骨架繁简变形而来——相近而互补、彼此呼应。
    // 关键:第二声部「不」跟着刻气口——人声在句末换气静音时,吉他持续奏满整句(末音延长盖过气口),使乐队不随人声一起断。
    let cnotes = null;
    if (withCounter) {
      const cslots = varyRhythm(bp.slots, rng);
      // 主声部已发声音符的时间线(post-carve、末句已收主音),供第二声部按时间位置避让撞音;气口与空档处无主声部音,不避让。
      const melTL = [];
      let mt = 0;
      for (const nt of notes) { melTL.push({ s: mt, e: mt + nt.beats, deg: nt.key - tonic }); mt += nt.beats; }
      const cAgainst = cslots.map((cs) => {
        const o = cs.bar * BEATS_PER_BAR + cs.onset + 1e-9;
        const m = melTL.find((x) => o >= x.s && o < x.e);
        return m ? m.deg : null;
      });
      const realizedC = realizePhrase(cslots, bp.chords, melodyScale, counterLadder, model, rng, profile, bp.counterShape, cAgainst);
      cnotes = realizedC.map((nt) => ({ key: tonic + nt.pitch, beats: nt.beats }));
    }
    notes.forEach((nt) => { melody.push(nt); cum += nt.beats; });
    if (cnotes) cnotes.forEach((nt) => counter.push(nt)); // 第二声部铺满整句,无句末休止
    if (breathe) { melody.push({ rest: BREATH }); cum += BREATH; }
  });
  const out = { melody, chords: chordSpans, tonicMidi: tonic, scale };
  if (withCounter) out.counter = counter;
  return out;
}
//// /离线随机作曲 ////

module.exports = {
  compose, loadModel, snapToScale, triad, buildLadder, walkProgression, pickForm,
  SCALES, BAR_PATTERNS, CHORD_TRANS, CONTOUR_SHAPES, DEFAULT_PROFILE,
};
