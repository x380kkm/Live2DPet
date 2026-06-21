// audience: internal
// # composer-harmony
// 作曲器的和声层:内置功能和声转移表、三和弦构造、在和声档上随机游走出和弦进行、列出和弦音在梯子上的度数。
// 和声档(转移表加和声节奏)由 harmony-profiles 按风格提供;此处只负责在给定档上走与把和弦落到旋律音阶。
// 不变量:纯逻辑无副作用;随机源由调用方注入。

const { pickWeighted, nearestScalePc } = require('./composer-util');

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

// 各和弦色彩在音阶级上相对根音级的偏移(均为调内音,故旋律与配器仍不离调):平三和弦、七和弦、九和弦、加九、六和弦、挂二、挂四。
const CHORD_QUALITIES = {
  triad: [0, 2, 4],
  7: [0, 2, 4, 6],
  9: [0, 2, 4, 6, 8],
  add9: [0, 2, 4, 8],
  6: [0, 2, 4, 5],
  sus2: [0, 1, 4],
  sus4: [0, 3, 4],
};

//// 在某音阶上以某级为根按色彩叠和弦:返回根音级与各音级(均为 0-11 音级);色彩缺省为平三和弦,扩展音都取自音阶故不离调 [@x380kkm 2026-06-21] ////
function chordAt(scaleSet, degIndex, quality = 'triad') {
  const L = scaleSet.length;
  const offs = CHORD_QUALITIES[quality] || CHORD_QUALITIES.triad;
  const idxs = offs.map((o) => degIndex + o);
  const pcs = idxs.map((i) => (scaleSet[((i % L) + L) % L] + 12 * Math.floor(i / L)) % 12);
  return { root: scaleSet[degIndex % L] % 12, pcs };
}
//// /按色彩叠和弦 ////

//// 在某音阶上以某级为根叠三度成平三和弦：返回根音级与三个音级（均为 0-11 音级） [@x380kkm 2026-06-20] ////
function triad(scaleSet, degIndex) {
  return chordAt(scaleSet, degIndex, 'triad');
}
//// /叠三度成三和弦 ////

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

//// 造目标和弦的副属和弦(其属七和弦,相对主音音级):副属落在目标和弦根音上方五度,作短暂的离调张力再解决到目标,丰富和声色彩 [@x380kkm 2026-06-21] ////
// targetRoot 为目标和弦的根音(相对主音 0-11);返回 { root, pcs } 为相对主音音级,pcs 含离调音(配器奏出色彩,旋律仍吸附回音阶)。
function secondaryDominant(targetRoot) {
  const r = ((targetRoot + 7) % 12 + 12) % 12;
  return { root: r, pcs: [r, (r + 4) % 12, (r + 7) % 12, (r + 10) % 12] };
}
//// /造副属和弦 ////

// 借用和弦(调式互换):大调向平行小调借 bVII、iv、bVI、bIII(摇滚/动漫/影视常用),小调向平行大调借 IV、V(更亮、可作和声小调终止)。均为相对主音音级。
const BORROWED = {
  major: [{ root: 10, pcs: [10, 2, 5] }, { root: 5, pcs: [5, 8, 0] }, { root: 8, pcs: [8, 0, 3] }, { root: 3, pcs: [3, 7, 10] }],
  minor: [{ root: 5, pcs: [5, 9, 0] }, { root: 7, pcs: [7, 11, 2] }],
};

//// 按调式随机取一个借用和弦(调式互换色彩):大调借 bVII/iv/bVI/bIII、小调借 IV/V;离调音进配器,旋律仍吸附回音阶 [@x380kkm 2026-06-21] ////
function borrowedChord(mode, rng) {
  const pool = BORROWED[mode] || BORROWED.major;
  const c = pool[Math.floor(rng() * pool.length)];
  return { root: c.root, pcs: c.pcs.slice() };
}
//// /取借用和弦 ////

//// 列出某和弦在梯子上的和弦音度数（和弦音先吸附到旋律音阶），空则退回整把梯子 [@x380kkm 2026-06-20] ////
function chordDegrees(chord, scaleSet, ladder) {
  const pcs = new Set(chord.pcs.map((pc) => nearestScalePc(((pc % 12) + 12) % 12, scaleSet)));
  const c = ladder.filter((v) => pcs.has(((v % 12) + 12) % 12));
  return c.length ? c : ladder.slice();
}
//// /列出和弦音度数 ////

module.exports = { CHORD_TRANS, CHORD_QUALITIES, triad, chordAt, secondaryDominant, borrowedChord, walkProgression, chordDegrees };
