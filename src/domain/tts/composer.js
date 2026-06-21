// audience: internal
// # composer
// 离线随机作曲的统一架构：把一段曲子拆成三个相互协调的层并按同一骨架生成，解决「完全一个调」的单调。
// 第一层和声(见 composer-harmony)：在风格各自的和声档上随机游走出和弦进行，每半小节一个调内三和弦，是全曲骨架。
// 第二层节奏(见 composer-rhythm)：每小节取一个对齐半拍格的节奏型，定下各音的时值与起拍位置，区分强拍（第 1、3 拍）与弱拍。
// 第三层旋律(本文件)：在和声约束下生成音高，强拍落和弦音（随和弦更替与琶音产生起伏），弱拍用音阶经过音/邻音把强拍音级进连起来，主旋律因此有走向而非停在一个音。
// 曲式按乐句做动机重复（如 AABA），重复的乐句连同它的和弦一起复用，使旋律与配器始终对齐。
// 输出：melody 与 song-score 旋律格式一致（发声音符 { key:MIDI, beats }、换气 { rest }）；chords 为按时间轴排布的和弦跨度，供 accompaniment 配器复用同一套和声。
// 共享底层在 composer-util,和声在 composer-harmony,节奏在 composer-rhythm;本文件再导出它们的公开符号,外部仍只 require 本文件。
// 不变量：纯逻辑无副作用；随机源经 options.rng 注入（缺省 Math.random），便于测试可重复。

const { SCALES, BEATS_PER_BAR, BREATH, DEFAULT_PROFILE, VOCAL_RANGE, loadModel, snapToScale, buildLadder, nearestIn, pickWeighted } = require('./composer-util');
const { CHORD_TRANS, triad, chordAt, secondaryDominant, borrowedChord, walkProgression, chordDegrees } = require('./composer-harmony');
const { BAR_PATTERNS, buildBlueprint, varyRhythm } = require('./composer-rhythm');

// 乐句内的走向形状：把乐句进度 frac(0..1)映成目标音高的相对高低(0..1),不同形状给出不同旋律线,是消除「每句一个拱」雷同的关键。
const CONTOUR_SHAPES = {
  arch: (f) => 4 * f * (1 - f), // 拱形:中间高、两头低
  rise: (f) => f, // 上行
  fall: (f) => 1 - f, // 下行
  valley: (f) => 1 - 4 * f * (1 - f), // 谷形:两头高、中间低
  wave: (f) => 0.5 - 0.5 * Math.cos(4 * Math.PI * f), // 起伏:两个波峰
  peakLate: (f) => (f < 0.75 ? f / 0.75 : 1 - (f - 0.75) / 0.25), // 后段冲高再回落
};
// 旋律取音各项权重:数据(语料二阶转移)是主因,轮廓与跳度是软约束。
// 人声旋律以「严格遵循学到的语料」为准:各项人工约束都尽量轻,让 pop909 学到的二阶转移主导,复杂度放到配器而非改人声。
const DATA_POW = 1.0; // 语料转移计数的幂:1 即按训练频次正比。
const DATA_EPS = 0.03; // 给调内每个候选音的底数:很小,让语料主导、几乎不引入语料外的音。
const REPEAT_PEN = 0.6; // 与上一音同高的惩罚系数:适度压同音,使重复同音率接近语料(约 19%、语料 pop909 约 23%),又防高重复语料(如儿歌)塌成一个音(全风格单音占比 <0.4)。
const CONTOUR_SIGMA = 16; // 轮廓软拉的半音容差:很宽,轮廓几乎不改语料走向,只极轻地把音区往中间收。
const BIG_LEAP_DEG = 12; // 仅超过八度才算过大跳并指数压制,其余跳进全照语料。
const STRONG_CHORD_BONUS = 2.0; // 强拍落和弦音的加权:很轻,只作和声的轻微吸引,不强拉旋律上和弦音(强拉会逼出语料没有的跳进、听着怪)。
const WEAK_CHORD_BONUS = 1.0; // 弱拍不加和弦偏置,完全由语料决定。
const CONSONANCE_PEN = 0.12; // 与同拍另一声部成不协和音程(小二/大二/三全音/七度)时的衰减系数:越小越避让,使第二声部不与主旋律撞音。
// 与某度数成不协和音程(同度0也算撞、小二1、大二2、三全音6、七度10/11)时该衰减,用于第二声部避让主旋律。
const DISSONANT_INTERVALS = new Set([0, 1, 2, 6, 10, 11]);
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

//// 算乐句内某进度的目标音高：按所选轮廓形状给出相对高低,叠基线、振幅与随机抖动 [@x380kkm 2026-06-20] ////
function contourTarget(frac, rng, profile, shapeName) {
  const shape = CONTOUR_SHAPES[shapeName] || CONTOUR_SHAPES.arch;
  return profile.base + profile.amp * shape(frac) + (rng() * 2 - 1) * profile.jitter;
}
//// /算乐句内目标音高 ////

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
//   harmony 风格的和声档（见 harmony-profiles，缺省退回旋律模型自带和弦字段、再退内置功能和声表），
//   form 曲式字母串（缺省按句数取 AABA/ABA），barsPerPhrase 每句小节数（缺省 2），phrases 句数（缺省 4），
//   breathAtEnd 末句也收主音并刻气口（缺省 false）：用于把本段当作长曲的一段、与后段严格按小节拼接时留出段间换气，
//   profile 风格档案（缺省 DEFAULT_PROFILE）：给音域、走向基线/振幅/抖动、可选轮廓形状集、中跳抑制，是拉开风格差异的旋律侧旋钮。
//   和弦进行不用固定模板,而在和声档上随机游走;曲式不固定 AABA,按句数从候选里随机取并做变奏式再现。
//   withCounter 另出一条第二声部(给吉他):同一套和弦上走一条独立的马尔可夫线,坐在更高音区,节奏由主声部骨架繁简变形而来、与人声相似但不同、彼此呼应;
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
  // 音域以语料学到的相对窗口为准(切蒲英 50 首训练出 model.register),再与绝对音域硬界相交,使旋律落在源歌手实际唱过的音区、不被移调推高。
  const baseReg = model.register || profile.register;
  const reg = { lo: Math.max(baseReg.lo, VOCAL_RANGE.lo - tonic), hi: Math.min(baseReg.hi, VOCAL_RANGE.hi - tonic) };
  const ladder = buildLadder(melodyScale, reg);
  // 第二声部(吉他)坐在人声上方、与人声错开音区,但同样设绝对上界(留比人声高一点的器乐余量),避免被推到极高。
  const counterReg = {
    lo: Math.max(baseReg.lo + counterShift, VOCAL_RANGE.lo - tonic),
    hi: Math.min(baseReg.hi + counterShift, (VOCAL_RANGE.hi + 7) - tonic),
  };
  const counterLadder = buildLadder(melodyScale, counterReg);

  // 为曲式里每个字母各造一份「蓝图」:和弦进行（功能和声随机游走）、节奏骨架、主声部与第二声部各自的轮廓形状;重复字母复用同一蓝图。
  const blueprintOf = {};
  let shapeNo = 0;
  for (const letter of form) {
    if (blueprintOf[letter]) continue;
    // 每半小节一个和弦:游走出 bars*2 个,和声按风格各自的和声档走动(转移表与和声节奏均按风格不同),并按风格的色彩权重给每个和弦随机叠色彩(七/九/挂留等,均取自调内)。
    const progDeg = walkProgression(harmony, mode, bars * 2, rng);
    const colors = (harmony && harmony.colors) || { triad: 1 };
    const chords = progDeg.map((d) => chordAt(harmonyScale, d, pickWeighted(colors, rng) || 'triad'));
    // 副属和弦:按风格概率把某半小节换成下一和弦的属七(短暂离调张力,解决到下一和弦),丰富和声;不动末和弦(无下一个)。
    const secDom = (harmony && harmony.secDom) || 0;
    if (secDom) for (let i = 0; i < chords.length - 1; i += 1) if (rng() < secDom) chords[i] = secondaryDominant(chords[i + 1].root);
    // 借用和弦:按风格概率把某半小节换成调式互换借色和弦(大调借 bVII/iv 等),给摇滚/动漫/影视常见的模态色彩。
    const borrow = (harmony && harmony.borrow) || 0;
    if (borrow) for (let i = 0; i < chords.length; i += 1) if (rng() < borrow) chords[i] = borrowedChord(mode, rng);
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

// 公开接口:外部仍只 require 本文件;和声、节奏、底层的公开符号在此一并再导出,保持调用方不变。
module.exports = {
  compose, loadModel, snapToScale, triad, buildLadder, walkProgression, pickForm,
  SCALES, BAR_PATTERNS, CHORD_TRANS, CONTOUR_SHAPES, DEFAULT_PROFILE,
};
